export type IngestTrigger = "started" | "unavailable" | "no-url";

/**
 * Kick off the ingest-background Netlify function. Background functions reply
 * 202 within a fraction of a second and keep running (up to 15 minutes), so
 * the caller returns immediately instead of doing the heavy sync itself —
 * which would blow the short page/function timeout.
 *
 * - "no-url"      not on Netlify (e.g. `npm run dev`) — caller may run inline
 * - "unavailable" the function endpoint 404'd (not deployed)
 * - "started"     accepted (or a network blip we optimistically treat as running)
 */
export async function triggerBackgroundIngest(): Promise<IngestTrigger> {
  const base = (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    ""
  ).replace(/\/$/, "");
  if (!base) return "no-url";

  const headers: Record<string, string> = {};
  if (process.env.INGEST_SECRET) {
    headers.Authorization = `Bearer ${process.env.INGEST_SECRET}`;
  }
  try {
    const res = await fetch(`${base}/.netlify/functions/ingest-background`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 404) return "unavailable";
    return "started";
  } catch (err) {
    // A real background function answers in well under a second; a timeout or
    // transient network error most likely means it's already running async, so
    // don't fall back to a heavy inline sync that would time out the caller.
    console.error("triggerBackgroundIngest:", err);
    return "started";
  }
}
