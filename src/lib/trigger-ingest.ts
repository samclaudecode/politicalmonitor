/**
 * Fire-and-forget invocation of the ingest-background Netlify function.
 * Background functions respond 202 immediately and keep running (up to
 * 15 minutes), so callers return fast while the pull happens off-thread.
 *
 * Returns false when the function can't be reached (e.g. running outside
 * Netlify, like `npm run dev`) so callers can fall back to a direct run.
 */
export async function triggerBackgroundIngest(): Promise<boolean> {
  const base = process.env.URL; // set by Netlify (and `netlify dev`)
  if (!base) return false;
  try {
    const headers: Record<string, string> = {};
    if (process.env.INGEST_SECRET) {
      headers.Authorization = `Bearer ${process.env.INGEST_SECRET}`;
    }
    const res = await fetch(`${base}/.netlify/functions/ingest-background`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok || res.status === 202;
  } catch (err) {
    console.error("triggerBackgroundIngest:", err);
    return false;
  }
}
