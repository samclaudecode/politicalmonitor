const HAS_DB_URL = Boolean(
  process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL
);

/**
 * Rendered instead of a hard crash when the database is missing or
 * unreachable, with the real error and how to fix it.
 */
export default function DbSetupNotice({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="form-card" style={{ marginTop: 28 }}>
      <h2>Database not available</h2>
      <p style={{ color: "var(--ink-soft)" }}>
        The site is running, but it couldn&apos;t reach its Postgres database:
      </p>
      <div className="notice" style={{ wordBreak: "break-word" }}>
        <code>{message}</code>
      </div>
      {!HAS_DB_URL ? (
        <>
          <p>
            <strong>
              No <code>NETLIFY_DATABASE_URL</code> (or <code>DATABASE_URL</code>)
              environment variable is set
            </strong>{" "}
            — the database hasn&apos;t been provisioned or linked to this site
            yet. To fix it:
          </p>
          <ol style={{ lineHeight: 2 }}>
            <li>
              From the repo, run <code>netlify link</code> then{" "}
              <code>netlify db init</code> (requires{" "}
              <code>npm i -g netlify-cli</code>) — this provisions Netlify DB
              and adds <code>NETLIFY_DATABASE_URL</code> to the site.
              <br />
              <em>Or</em> in the Netlify dashboard: <strong>Extensions → Neon
              Database</strong> → install and connect it to this site.
            </li>
            <li>
              Confirm the variable exists under{" "}
              <strong>Site configuration → Environment variables</strong>.
            </li>
            <li>
              Redeploy the site (<strong>Deploys → Trigger deploy</strong>) so
              functions pick up the new variable.
            </li>
          </ol>
        </>
      ) : (
        <p>
          A database URL is configured, so this is a connection problem — check
          that the database is claimed/active in Neon, and see the function
          logs (<strong>Logs → Functions</strong> in the Netlify dashboard) for
          details. The schema is created automatically once the connection
          succeeds; no manual migration is needed.
        </p>
      )}
    </div>
  );
}
