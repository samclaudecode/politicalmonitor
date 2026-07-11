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

// Public Nitter instances are flaky, and several (nitter.net, the main
// xcancel.com host) block or reset connections from datacenter IPs like
// Netlify's — which surfaces as UND_ERR_SOCKET. rss.xcancel.com is a
// dedicated RSS host that answers those requests, so it leads the list.
// NITTER_BASE_URL (single) or NITTER_INSTANCES (comma-separated) override.
const DEFAULT_NITTER_INSTANCES = [
  "https://rss.xcancel.com",
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
 * Turn user input into a stored feed URL for an X source. Accepts:
 *   - "@handle" / "handle"          → <primary instance>/<handle>/rss
 *   - an x.com / twitter.com URL    → <primary instance>/<handle>/rss
 *   - a Nitter instance URL         → normalized to .../<handle>/rss
 *   - ANY other http(s) RSS URL     → used verbatim (bring-your-own bridge:
 *     a self-hosted Nitter, rss.app, or any Twitter-to-RSS service)
 */
export function normalizeTwitterInput(input: string): string | null {
  const trimmed = input.trim();
  const handleMatch = /^@?([A-Za-z0-9_]{1,15})$/.exec(trimmed);
  if (handleMatch) return `${nitterBaseUrl()}/${handleMatch[1]}/rss`;
  try {
    const u = new URL(trimmed);
    if (!/^https?:$/i.test(u.protocol)) return null;
    if (/(^|\.)(x\.com|twitter\.com)$/i.test(u.hostname)) {
      const m = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(u.pathname);
      return m ? `${nitterBaseUrl()}/${m[1]}/rss` : null;
    }
    // A Nitter-style profile path becomes the RSS path…
    if (/^\/[A-Za-z0-9_]{1,15}\/rss\/?$/.test(u.pathname)) {
      return trimmed.replace(/\/$/, "");
    }
    const m = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(u.pathname);
    if (m) return `${u.origin}/${m[1]}/rss`;
    // …otherwise accept any http(s) URL verbatim as a custom RSS feed.
    return trimmed.replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** True when the entry is an original tweet authored by `handle`. */
export function isOriginalTweet(entry: FeedEntry, handle: string | null): boolean {
  const title = entry.title.trim();
  if (/^RT by @/i.test(title)) return false; // repost
  if (/^R to @/i.test(title)) return false; // reply
  const creator = (entry.authorName || "").trim().replace(/^@/, "");
  // dc:creator names the original author; a mismatch means repost/quote-RT.
  // When the handle is unknown (non-standard feed URL), rely on the title
  // prefixes alone.
  if (handle && creator && creator.toLowerCase() !== handle.toLowerCase()) {
    return false;
  }
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
export function originalTweets(
  entries: FeedEntry[],
  handle: string | null
): FeedEntry[] {
  return entries.filter((e) => isOriginalTweet(e, handle));
}

/**
 * Ordered list of RSS URLs to try for a source: the exact stored URL first
 * (so a working endpoint the user pinned is honoured), then the handle
 * against every configured instance. De-duplicated.
 */
export function twitterFeedCandidates(storedFeedUrl: string): string[] {
  const handle = handleFromNitterUrl(storedFeedUrl);
  const urls: string[] = [];
  if (/^https?:\/\//i.test(storedFeedUrl)) urls.push(storedFeedUrl.replace(/\/$/, ""));
  if (handle) {
    for (const base of nitterInstances()) urls.push(`${base}/${handle}/rss`);
  }
  return [...new Set(urls)];
}

function errCode(err: unknown): string {
  if (err instanceof Error) {
    // Network-level failures carry a cause code (UND_ERR_SOCKET, ENOTFOUND…);
    // our own throws carry a message ("HTTP 403", "not an RSS feed…").
    const causeCode = (err as { cause?: { code?: string } }).cause?.code;
    if (causeCode) return causeCode;
    return err.message || err.name;
  }
  return String(err);
}

/**
 * Route the request through a relay if NITTER_PROXY is set. Cloudflare in
 * front of many Nitter instances resets connections from some hosts' IPs/TLS
 * (e.g. Netlify), surfacing as UND_ERR_SOCKET, while other hosts (e.g. Replit)
 * are accepted. A relay whose egress *is* accepted fixes this for every
 * instance at once. Format: a prefix ("https://relay/fetch?url=") or a
 * template containing "{url}"; the target URL is appended/substituted
 * URL-encoded.
 */
export function applyProxy(url: string): string {
  const prefix = process.env.NITTER_PROXY?.trim();
  if (!prefix) return url;
  return prefix.includes("{url}")
    ? prefix.replace("{url}", encodeURIComponent(url))
    : `${prefix}${encodeURIComponent(url)}`;
}

async function fetchRssOnce(url: string): Promise<string> {
  const res = await fetch(applyProxy(url), {
    headers: {
      // Full browser-like header set to get past lighter bot filters.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept:
        "application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.7",
      "Accept-Language": "en-GB,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  // Nitter error pages ("User not found", rate-limit / Cloudflare HTML) aren't RSS.
  if (!/<rss[\s>]|<feed[\s>]/i.test(xml)) {
    const hint = /cloudflare|just a moment|attention required|cf-browser/i.test(xml)
      ? "Cloudflare challenge"
      : "not an RSS feed";
    throw new Error(`${hint} (HTTP ${res.status})`);
  }
  return xml;
}

/**
 * Fetch an account's timeline RSS, trying the stored URL then each configured
 * Nitter instance until one returns a valid feed. Transient socket errors
 * (UND_ERR_SOCKET etc.) are retried once per candidate, since flaky instances
 * often reset the first connection. Returns the raw XML and the URL that served it.
 */
export async function fetchTwitterFeed(
  storedFeedUrl: string
): Promise<{ xml: string; instance: string }> {
  const candidates = twitterFeedCandidates(storedFeedUrl);
  if (candidates.length === 0) {
    throw new Error(
      `Cannot determine an X feed URL from: ${storedFeedUrl} (expected <nitter>/<handle>/rss)`
    );
  }
  const errors: string[] = [];
  for (const url of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const xml = await fetchRssOnce(url);
        return { xml, instance: url };
      } catch (err) {
        const code = errCode(err);
        // Retry once on a transient socket-level failure; give up otherwise.
        const transient = /UND_ERR_SOCKET|ECONNRESET|ETIMEDOUT|EAI_AGAIN|TimeoutError|other side closed/i.test(
          code
        );
        if (transient && attempt === 0) continue;
        errors.push(`${hostOf(url)}: ${code}`);
        break;
      }
    }
  }
  throw new Error(
    `All ${candidates.length} X feed URL(s) failed — ${errors.join("; ")}`
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
