// CLI entry point for cron-based ingestion: `npm run ingest`
import { runIngest } from "../src/lib/ingest";
import { closeDb } from "../src/lib/db";

runIngest({ categorizeLimit: 100 })
  .then(async (report) => {
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
    await closeDb();
  })
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
