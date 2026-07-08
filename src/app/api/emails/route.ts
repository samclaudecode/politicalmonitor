import { NextRequest, NextResponse } from "next/server";
import { queryEmails } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/emails — JSON view of the archive.
 * Supports: q, topic, type, party, source, sort (newest|oldest), page, pageSize.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    return await handle(p);
  } catch (err) {
    console.error("/api/emails: database error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "database error" },
      { status: 500 }
    );
  }
}

async function handle(p: URLSearchParams) {
  const result = await queryEmails({
    q: p.get("q") || undefined,
    topic: p.get("topic") || undefined,
    type: p.get("type") || undefined,
    party: p.get("party") || undefined,
    source: p.get("source") ? parseInt(p.get("source")!, 10) : undefined,
    sort: p.get("sort") === "oldest" ? "oldest" : "newest",
    page: p.get("page") ? parseInt(p.get("page")!, 10) : 1,
    pageSize: Math.min(100, p.get("pageSize") ? parseInt(p.get("pageSize")!, 10) : 25),
  });

  // Strip heavy bodies from the list payload.
  const items = result.items.map(({ html_body, text_body, ...rest }) => ({
    ...rest,
    excerpt: (text_body || "").slice(0, 280),
  }));

  return NextResponse.json({ ...result, items });
}
