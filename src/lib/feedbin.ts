// Feedbin API client. Feedbin turns emails sent to your @feedb.in address
// into per-sender feeds inside your account; those are only reachable
// through the API (HTTP Basic auth), not as public ATOM URLs.
// API docs: https://github.com/feedbin/feedbin-api
import type { FeedEntry } from "./atom";
import { stripHtml } from "./atom";
import { addSource, listSources } from "./db";

const DEFAULT_API_URL = "https://api.feedbin.com/v2";

export interface FeedbinSubscription {
  id: number;
  feed_id: number;
  title: string;
  feed_url: string;
  site_url: string;
}

interface FeedbinEntry {
  id: number;
  feed_id: number;
  title: string | null;
  author: string | null;
  content: string | null;
  summary: string | null;
  published: string;
  created_at: string;
}

export function isFeedbinConfigured(): boolean {
  return Boolean(process.env.FEEDBIN_EMAIL && process.env.FEEDBIN_PASSWORD);
}

/** Sources created from Feedbin use "feedbin:<feed_id>" as their feed_url. */
export function feedbinFeedId(feedUrl: string): number | null {
  const m = /^feedbin:(\d+)$/.exec(feedUrl.trim());
  return m ? parseInt(m[1], 10) : null;
}

async function feedbinRequest(path: string): Promise<Response> {
  const email = process.env.FEEDBIN_EMAIL;
  const password = process.env.FEEDBIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Feedbin is not configured. Set FEEDBIN_EMAIL and FEEDBIN_PASSWORD."
    );
  }
  const base = (process.env.FEEDBIN_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString("base64")}`,
      "User-Agent": "PoliticalMonitor/1.0 (+political email archive)",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) {
    throw new Error("Feedbin rejected the credentials (HTTP 401) — check FEEDBIN_EMAIL / FEEDBIN_PASSWORD.");
  }
  if (!res.ok) {
    throw new Error(`Feedbin API error: HTTP ${res.status} on ${path}`);
  }
  return res;
}

export async function listFeedbinSubscriptions(): Promise<FeedbinSubscription[]> {
  const res = await feedbinRequest("/subscriptions.json");
  return (await res.json()) as FeedbinSubscription[];
}

/**
 * Fetch entries for one Feedbin feed, newest first, paginating up to
 * `maxPages` pages of 100. Dedup downstream makes overlapping pages safe.
 */
export async function fetchFeedbinEntries(
  feedId: number,
  maxPages = 10
): Promise<FeedEntry[]> {
  const entries: FeedEntry[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await feedbinRequest(
      `/feeds/${feedId}/entries.json?per_page=100&page=${page}`
    );
    const batch = (await res.json()) as FeedbinEntry[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const e of batch) {
      const html = e.content || null;
      entries.push({
        guid: `feedbin:${e.id}`,
        title: e.title || "(no subject)",
        authorName: e.author || null,
        authorEmail: null,
        publishedAt: new Date(e.published || e.created_at).toISOString(),
        html,
        text: html ? stripHtml(html) : e.summary || null,
      });
    }
    if (batch.length < 100) break;
  }
  return entries;
}

export interface FeedbinImportResult {
  imported: number;
  skipped: number;
  names: string[];
}

/**
 * Create a source for every Feedbin subscription that isn't registered yet.
 * Each email newsletter is its own feed in Feedbin, so each becomes one
 * source here (tag candidate/party afterwards via Edit).
 */
export async function importFeedbinSources(): Promise<FeedbinImportResult> {
  const [subs, sources] = await Promise.all([
    listFeedbinSubscriptions(),
    listSources(),
  ]);
  const existing = new Set(sources.map((s) => s.feed_url));
  const result: FeedbinImportResult = { imported: 0, skipped: 0, names: [] };
  for (const sub of subs) {
    const feedUrl = `feedbin:${sub.feed_id}`;
    if (existing.has(feedUrl)) {
      result.skipped++;
      continue;
    }
    await addSource({ feed_url: feedUrl, name: sub.title || feedUrl });
    result.imported++;
    result.names.push(sub.title || feedUrl);
  }
  return result;
}
