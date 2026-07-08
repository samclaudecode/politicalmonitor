// CLI entry point for cron-based ingestion: `npm run ingest`
import { runIngest } from "../src/lib/ingest";

runIngest({ categorizeLimit: 100 })
  .then((report) => {
    for (const s of report.sources) {
      console.log(
        `[${s.sourceName}] ${s.error ? `ERROR: ${s.error}` : `${s.newEmails} new emails`}`
      );
    }
    const c = report.categorization;
    console.log(
      `Categorization: ${c.succeeded}/${c.attempted} succeeded${
        c.errors.length ? `\n  ${c.errors.join("\n  ")}` : ""
      }`
    );
    console.log(`Done. ${report.totalNew} new emails ingested.`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
