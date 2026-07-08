"use client";

// Global safety net so unexpected server errors don't show Next's opaque
// "Application error" page.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="form-card" style={{ marginTop: 28 }}>
      <h2>Something went wrong</h2>
      <p style={{ color: "var(--ink-soft)" }}>
        An unexpected error occurred while rendering this page
        {error.digest ? (
          <>
            {" "}
            (digest <code>{error.digest}</code>)
          </>
        ) : null}
        . The full error is in the Netlify function logs (
        <strong>Logs → Functions</strong> in the dashboard).
      </p>
      <button onClick={() => reset()}>Try again</button>
    </div>
  );
}
