// Background function (name ends in "-background" → 15 minute execution
// limit): fetches every active source (Feedbin API + ATOM/RSS) and runs
// DeepSeek categorization. Invoked by scheduled-ingest every 30 minutes,
// by the "Fetch feeds & categorize now" button, or manually:
//   curl -X POST https://<site>/.netlify/functions/ingest-background \
//        -H "Authorization: Bearer $INGEST_SECRET"
import { runIngest } from "../../src/lib/ingest";

export default async (req: Request) => {
  const secret = process.env.INGEST_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const report = await runIngest({ categorizeLimit: 200 });
  console.log(
    `Ingest: ${report.totalNew} new emails; categorized ${report.categorization.succeeded}/${report.categorization.attempted}`
  );
  for (const s of report.sources) {
    if (s.error) console.error(`[${s.sourceName}] ${s.error}`);
  }
  for (const e of report.categorization.errors) {
    console.error(`[categorize] ${e}`);
  }
  return new Response(JSON.stringify(report), {
    headers: { "Content-Type": "application/json" },
  });
};
