// Background function (15-minute limit): runs the fact-check pipeline for
// one item — claim triage, Fusion web verification, grounding docs — and
// caches the result. Triggered by the "Run fact-check" button; a Fusion
// panel can take minutes, far beyond the page-function timeout.
import { runFactCheck, markFactCheckError } from "../../src/lib/factcheck";

export default async (req: Request) => {
  const secret = process.env.INGEST_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  let id: number | null = null;
  try {
    const body = (await req.json()) as { id?: unknown };
    id = typeof body.id === "number" ? body.id : parseInt(String(body.id), 10);
  } catch {
    /* fall through */
  }
  if (id === null || Number.isNaN(id)) {
    return new Response("missing id", { status: 400 });
  }

  try {
    const result = await runFactCheck(id);
    console.log(
      `factcheck-background: item ${id} → ${result.status}` +
        (result.bsScore !== null ? ` (BS ${result.bsScore})` : "")
    );
    return new Response(JSON.stringify({ status: result.status }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`factcheck-background: item ${id} failed:`, err);
    await markFactCheckError(id, message).catch(() => {});
    return new Response(message, { status: 500 });
  }
};
