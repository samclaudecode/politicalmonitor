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

const DEFAULT_NITTER_BASE = "https://xcancel.com";

export function nitterBaseUrl(): string {
  return (process.env.NITTER_BASE_URL || DEFAULT_NITTER_BASE).replace(/\/$/, "");
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
 * The URL actually fetched for a twitter source: the stored feed_url only
 * identifies the handle; the request always goes to the currently
 * configured NITTER_BASE_URL. Swapping instances (e.g. when a public one
 * dies) is therefore a single env-var change — no source editing needed.
 */
export function nitterFetchUrl(storedFeedUrl: string): string | null {
  const handle = handleFromNitterUrl(storedFeedUrl);
  return handle ? `${nitterBaseUrl()}/${handle}/rss` : null;
}
