import { XMLParser } from "fast-xml-parser";

export interface FeedEntry {
  guid: string;
  title: string;
  authorName: string | null;
  authorEmail: string | null;
  publishedAt: string; // ISO 8601
  html: string | null;
  text: string | null;
  link: string | null;
}

export interface ParsedFeed {
  title: string | null;
  entries: FeedEntry[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Feed entries with a single item still come back as objects otherwise.
  isArray: (name, jpath) =>
    jpath === "feed.entry" || jpath === "rss.channel.item",
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o["#text"] === "string" || typeof o["#text"] === "number") {
      return String(o["#text"]);
    }
    // CDATA handled by fast-xml-parser as #text already; fall through.
  }
  return "";
}

function atomLink(node: unknown): string | null {
  for (const l of asArray(node)) {
    if (l && typeof l === "object") {
      const o = l as Record<string, unknown>;
      const rel = o["@_rel"];
      if ((!rel || rel === "alternate") && typeof o["@_href"] === "string") {
        return o["@_href"];
      }
    }
  }
  return null;
}

function contentType(node: unknown): string {
  if (node && typeof node === "object") {
    const t = (node as Record<string, unknown>)["@_type"];
    if (typeof t === "string") return t.toLowerCase();
  }
  return "text";
}

function toIso(value: string | undefined, fallback: Date): string {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback.toISOString();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}

/**
 * Parse an ATOM feed (the format produced by email-to-feed bridges like
 * Kill the Newsletter!). Falls back to RSS 2.0 items when given RSS.
 */
export function parseFeed(xml: string): ParsedFeed {
  const doc = parser.parse(xml);
  const now = new Date();

  if (doc.feed) {
    const feed = doc.feed;
    const entries: FeedEntry[] = asArray<Record<string, unknown>>(
      feed.entry
    ).map((entry) => {
      const content = entry.content ?? entry.summary;
      const type = contentType(content);
      const body = textOf(content);
      const isHtml = type.includes("html");
      const author = (entry.author ?? {}) as Record<string, unknown>;
      const title = textOf(entry.title) || "(no subject)";
      const guid =
        textOf(entry.id) ||
        `${title}-${textOf(entry.published) || textOf(entry.updated)}`;
      return {
        guid,
        title,
        authorName: textOf(author.name) || null,
        authorEmail: textOf(author.email) || null,
        publishedAt: toIso(
          textOf(entry.published) || textOf(entry.updated) || undefined,
          now
        ),
        html: isHtml ? body : null,
        text: isHtml ? stripHtml(body) : body || null,
        link: atomLink(entry.link),
      };
    });
    return { title: textOf(feed.title) || null, entries };
  }

  if (doc.rss?.channel) {
    const channel = doc.rss.channel;
    const entries: FeedEntry[] = asArray<Record<string, unknown>>(
      channel.item
    ).map((item) => {
      const body =
        textOf(item["content:encoded"]) || textOf(item.description) || "";
      const title = textOf(item.title) || "(no subject)";
      const guid =
        textOf(item.guid) || textOf(item.link) || `${title}-${textOf(item.pubDate)}`;
      return {
        guid,
        title,
        authorName: textOf(item["dc:creator"]) || null,
        authorEmail: textOf(item.author) || null,
        publishedAt: toIso(textOf(item.pubDate) || undefined, now),
        html: body || null,
        text: body ? stripHtml(body) : null,
        link: textOf(item.link) || null,
      };
    });
    return { title: textOf(channel.title) || null, entries };
  }

  throw new Error("Unrecognized feed format: expected ATOM <feed> or RSS <rss>");
}
