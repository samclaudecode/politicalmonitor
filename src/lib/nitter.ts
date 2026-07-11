// X/Twitter ingestion via Nitter RSS.
//
// Nitter (https://github.com/zedeus/nitter) exposes any X account's timeline
// as RSS at <instance>/<handle>/rss. In that feed:
//   - the item's dc:creator is the ORIGINAL author of the tweet
//     (for a retweet that's the retweeted account, not the timeline owner)
//   - retweet titles are prefixed  "RT by @owner: ..."
//   - reply titles are prefixed    "R to @someone: ..."
// The archive only wants original tweets by the person, so items failing
// either check are dropped.
import type { FeedEntry } from "./atom";

// Public Nitter instances are flaky and die often, so we keep a fallback
// list and try each until one returns valid RSS. NITTER_BASE_URL (single) or
// NITTER_INSTANCES (comma-separated) override the defaults and take priority.
const DEFAULT_NITTER_INSTANCES = [
  "https://xcancel.com",
  "https://nitter.poast.org",
  "https://lightbrd.com",
  "https://nitter.privacyredirect.com",
];

export function nitterInstances(): string[] {
  const configured = [
    ...(process.env.NITTER_BASE_URL ? [process.env.NITTER_BASE_URL] : []),
    ...(process.env.NITTER_INSTANCES
      ? process.env.NITTER_INSTANCES.split(",")
      : []),
  ]
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const list = configured.length ? configured : DEFAULT_NITTER_INSTANCES;
  // De-duplicate while preserving order.
  return [...new Set(list)];
}

/** Primary instance — used when normalizing user input into a stored URL. */
export function nitterBaseUrl(): string {
  return nitterInstances()[0];
}

/** Extract the account handle from a Nitter RSS URL (…/<handle>/rss). */
export function handleFromNitterUrl(feedUrl: string): string | null {
  try {
    const u = new URL(feedUrl);
    const m = /^\/([A-Za-z0-9_]{1,15})\/rss\/?$/.exec(u.pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Turn user input — "@handle", "handle", an x.com/twitter.com profile URL,
 * or a full Nitter RSS URL — into a Nitter RSS feed URL.
 */
export function normalizeTwitterInput(input: string): string | null {
  const trimmed = input.trim();
  const handleMatch = /^@?([A-Za-z0-9_]{1,15})$/.exec(trimmed);
  if (handleMatch) return `${nitterBaseUrl()}/${handleMatch[1]}/rss`;
  try {
    const u = new URL(trimmed);
    if (/(^|\.)(x\.com|twitter\.com)$/i.test(u.hostname)) {
      const m = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(u.pathname);
      return m ? `${nitterBaseUrl()}/${m[1]}/rss` : null;
    }
    // Assume any other URL is a Nitter instance; ensure it points at /rss.
    if (/^\/[A-Za-z0-9_]{1,15}\/rss\/?$/.test(u.pathname)) return trimmed;
    const m = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(u.pathname);
    if (m) return `${u.origin}/${m[1]}/rss`;
    return null;
  } catch {
    return null;
  }
}

/** True when the entry is an original tweet authored by `handle`. */
export function isOriginalTweet(entry: FeedEntry, handle: string): boolean {
  const title = entry.title.trim();
  if (/^RT by @/i.test(title)) return false; // repost
  if (/^R to @/i.test(title)) return false; // reply
  const creator = (entry.authorName || "").trim().replace(/^@/, "");
  // dc:creator names the original author; a mismatch means repost/quote-RT.
  if (creator && creator.toLowerCase() !== handle.toLowerCase()) return false;
  return true;
}

/** Strip Nitter title prefixes and collapse whitespace for use as a subject. */
export function tweetSubject(entry: FeedEntry): string {
  const text = (entry.text || entry.title || "").replace(/\s+/g, " ").trim();
  return text.length > 300 ? `${text.slice(0, 297)}…` : text || "(tweet)";
}

/** Convert a Nitter status link to the canonical x.com URL. */
export function toXUrl(link: string | null): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    const path = u.pathname.replace(/#.*$/, "");
    if (/^\/[A-Za-z0-9_]{1,15}\/status\/\d+/.test(path)) {
      return `https://x.com${path}`;
    }
    return link;
  } catch {
    return null;
  }
}

/** Filter a parsed Nitter feed down to original tweets by the account. */
export function originalTweets(entries: FeedEntry[], handle: string): FeedEntry[] {
  return entries.filter((e) => isOriginalTweet(e, handle));
}

/**
 * Fetch an account's timeline RSS, trying each configured Nitter instance in
 * turn until one returns a valid feed. The stored feed_url only identifies
 * the handle, so swapping/adding instances is a config change — no source
 * editing needed. Returns the raw XML and which instance served it.
 */
export async function fetchTwitterFeed(
  storedFeedUrl: string
): Promise<{ xml: string; instance: string }> {
  const handle = handleFromNitterUrl(storedFeedUrl);
  if (!handle) {
    throw new Error(
      `Cannot determine X handle from feed URL (expected <nitter>/<handle>/rss): ${storedFeedUrl}`
    );
  }
  const instances = nitterInstances();
  const errors: string[] = [];
  for (const base of instances) {
    try {
      const res = await fetch(`${base}/${handle}/rss`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; PoliticalMonitor/1.0; +political archive)",
          Accept: "application/rss+xml, application/xml, text/xml",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        errors.push(`${hostOf(base)}: HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      // Nitter error pages ("User not found", rate-limit HTML) aren't RSS.
      if (!/<rss[\s>]|<feed[\s>]/i.test(xml)) {
        errors.push(`${hostOf(base)}: not an RSS feed (blocked or rate-limited)`);
        continue;
      }
      return { xml, instance: base };
    } catch (err) {
      const code =
        err instanceof Error
          ? ((err as { cause?: { code?: string } }).cause?.code || err.name)
          : String(err);
      errors.push(`${hostOf(base)}: ${code}`);
    }
  }
  throw new Error(
    `All ${instances.length} Nitter instance(s) failed for @${handle} — ${errors.join("; ")}`
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
