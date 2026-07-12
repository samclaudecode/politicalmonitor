export type IngestTrigger = "started" | "unavailable" | "no-url";

/**
 * Kick off a Netlify background function. They reply 202 within a fraction
 * of a second and keep running (up to 15 minutes), so callers return
 * immediately instead of doing heavy work inside the short page-function
 * timeout.
 *
 * - "no-url"      not on Netlify (e.g. `npm run dev`) — caller may run inline
 * - "unavailable" the function endpoint 404'd (not deployed)
 * - "started"     accepted (or a network blip we optimistically treat as running)
 */
export async function triggerBackgroundFunction(
  name: string,
  body?: unknown
): Promise<IngestTrigger> {
  const base = (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    ""
  ).replace(/\/$/, "");
  if (!base) return "no-url";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.INGEST_SECRET) {
    headers.Authorization = `Bearer ${process.env.INGEST_SECRET}`;
  }
  try {
    const res = await fetch(`${base}/.netlify/functions/${name}`, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 404) return "unavailable";
    return "started";
  } catch (err) {
    // A real background function answers in well under a second; a timeout or
    // transient network error most likely means it's already running async, so
    // don't fall back to heavy inline work that would time out the caller.
    console.error(`triggerBackgroundFunction(${name}):`, err);
    return "started";
  }
}

export function triggerBackgroundIngest(): Promise<IngestTrigger> {
  return triggerBackgroundFunction("ingest-background");
}

export function triggerBackgroundFactCheck(emailId: number): Promise<IngestTrigger> {
  return triggerBackgroundFunction("factcheck-background", { id: emailId });
}
