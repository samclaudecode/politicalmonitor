// Scheduled ingestion: fetches every active ATOM feed and runs DeepSeek
// categorization on new emails. Runs every 30 minutes on Netlify's scheduler.
// Trigger manually with:
//   netlify functions:invoke scheduled-ingest
import type { Config } from "@netlify/functions";
import { runIngest } from "../../src/lib/ingest";

export default async () => {
  const report = await runIngest({ categorizeLimit: 100 });
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

export const config: Config = {
  schedule: "*/30 * * * *",
};
