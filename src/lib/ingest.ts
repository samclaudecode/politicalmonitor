import { parseFeed } from "./atom";
import {
  listSources,
  getSource,
  insertEmail,
  recordFetch,
  type Source,
} from "./db";
import { categorizePending, type CategorizeBatchResult } from "./categorize";

export interface SourceIngestResult {
  sourceId: number;
  sourceName: string;
  fetched: boolean;
  newEmails: number;
  error?: string;
}

export interface IngestReport {
  sources: SourceIngestResult[];
  totalNew: number;
  categorization: CategorizeBatchResult;
}

async function ingestSource(source: Source): Promise<SourceIngestResult> {
  const result: SourceIngestResult = {
    sourceId: source.id,
    sourceName: source.name,
    fetched: false,
    newEmails: 0,
  };
  try {
    const res = await fetch(source.feed_url, {
      headers: {
        "User-Agent": "PoliticalMonitor/1.0 (+political email archive)",
        Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching feed`);
    const xml = await res.text();
    const feed = parseFeed(xml);
    result.fetched = true;

    for (const entry of feed.entries) {
      const id = await insertEmail({
        source_id: source.id,
        guid: entry.guid,
        subject: entry.title,
        sender_name: entry.authorName ?? feed.title,
        sender_email: entry.authorEmail,
        received_at: entry.publishedAt,
        html_body: entry.html,
        text_body: entry.text,
      });
      if (id !== null) result.newEmails++;
    }
    await recordFetch(source.id, `ok: ${result.newEmails} new`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = message;
    await recordFetch(source.id, `error: ${message.slice(0, 200)}`);
  }
  return result;
}

/**
 * Fetch every active feed (or one specific source), store new emails,
 * then run DeepSeek categorization over anything still uncategorized.
 */
export async function runIngest(options?: {
  sourceId?: number;
  categorizeLimit?: number;
}): Promise<IngestReport> {
  const sources = options?.sourceId
    ? [await getSource(options.sourceId)].filter((s): s is Source => Boolean(s))
    : (await listSources()).filter((s) => s.active);

  const results: SourceIngestResult[] = [];
  for (const source of sources) {
    results.push(await ingestSource(source));
  }

  const categorization = await categorizePending(options?.categorizeLimit ?? 25);

  return {
    sources: results,
    totalNew: results.reduce((n, r) => n + r.newEmails, 0),
    categorization,
  };
}
