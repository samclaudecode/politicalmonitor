// Scheduled trigger (30-second execution limit) — fires every 30 minutes
// and hands the actual work to ingest-background, which has a 15-minute
// limit. Trigger manually with:
//   netlify functions:invoke scheduled-ingest
import type { Config } from "@netlify/functions";
import { triggerBackgroundIngest } from "../../src/lib/trigger-ingest";

export default async () => {
  const triggered = await triggerBackgroundIngest();
  if (!triggered) {
    console.error(
      "scheduled-ingest: could not reach ingest-background (is URL set?)"
    );
    return new Response("failed to trigger background ingest", { status: 500 });
  }
  console.log("scheduled-ingest: background ingest triggered");
  return new Response("triggered");
};

export const config: Config = {
  schedule: "*/30 * * * *",
};
