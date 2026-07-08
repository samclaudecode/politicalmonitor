import { NextRequest, NextResponse } from "next/server";
import { runIngest } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/ingest — fetch all active feeds and categorize new emails.
 * Intended for cron schedulers. If INGEST_SECRET is set, requires
 * "Authorization: Bearer <secret>".
 *
 * Optional query params:
 *   ?source=<id>   ingest a single source
 */
export async function POST(req: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const sourceParam = req.nextUrl.searchParams.get("source");
  const sourceId = sourceParam ? parseInt(sourceParam, 10) : undefined;

  try {
    const report = await runIngest({
      sourceId: Number.isNaN(sourceId as number) ? undefined : sourceId,
    });
    return NextResponse.json(report);
  } catch (err) {
    console.error("/api/ingest: error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ingest failed" },
      { status: 500 }
    );
  }
}
