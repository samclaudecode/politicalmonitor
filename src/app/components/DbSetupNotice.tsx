import { DB_URL_ENV_VARS } from "@/lib/db";

/**
 * Rendered instead of a hard crash when the database is missing or
 * unreachable, with the real error and how to fix it.
 */
export default function DbSetupNotice({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const hasDbUrl = DB_URL_ENV_VARS.some((name) => Boolean(process.env[name]));
  // Names only (never values): which database-ish env vars reach the runtime.
  const visibleDbVars = Object.keys(process.env)
    .filter((k) => /DATABASE|NEON|POSTGRES|^PG/i.test(k))
    .sort();

  return (
    <div className="form-card" style={{ marginTop: 28 }}>
      <h2>Database not available</h2>
      <p style={{ color: "var(--ink-soft)" }}>
        The site is running, but it couldn&apos;t reach its Postgres database:
      </p>
      <div className="notice" style={{ wordBreak: "break-word" }}>
        <code>{message}</code>
      </div>
      <p style={{ fontSize: "0.88rem", color: "var(--ink-soft)" }}>
        Database-related environment variables visible to the server:{" "}
        {visibleDbVars.length ? (
          visibleDbVars.map((v) => (
            <span key={v} className="chip" style={{ marginRight: 4 }}>
              {v}
            </span>
          ))
        ) : (
          <strong>none</strong>
        )}
        <br />
        The app connects using the first of these that is set:{" "}
        {DB_URL_ENV_VARS.map((v) => (
          <span key={v} className="chip" style={{ marginRight: 4 }}>
            {v}
          </span>
        ))}
      </p>
      {!hasDbUrl ? (
        <>
          <p>
            <strong>
              The server can&apos;t see a database connection string.
            </strong>{" "}
            If you already created a database, the variable isn&apos;t reaching
            this site&apos;s runtime. Check, in order:
          </p>
          <ol style={{ lineHeight: 2 }}>
            <li>
              <strong>Redeploy after any env change.</strong> Netlify bakes
              environment variables in at deploy time —{" "}
              <strong>Deploys → Trigger deploy → Clear cache and deploy
              site</strong>.
            </li>
            <li>
              <strong>Is the database connected to this site?</strong> A
              Netlify DB / Neon database is linked to one specific site. In the
              dashboard open this site → <strong>Extensions → Neon
              Database</strong> and confirm it&apos;s connected here (not to
              another site).
            </li>
            <li>
              <strong>Does the variable exist with the right scope?</strong>{" "}
              Under <strong>Site configuration → Environment variables</strong>{" "}
              there should be <code>NETLIFY_DATABASE_URL</code> available to
              <em> all scopes</em> (or at least Functions/Runtime) and the
              Production context.
            </li>
            <li>
              <strong>Database created directly in Neon (or elsewhere)?</strong>{" "}
              Copy its pooled connection string and add it yourself as{" "}
              <code>DATABASE_URL</code> in Site configuration → Environment
              variables, then redeploy.
            </li>
          </ol>
        </>
      ) : (
        <p>
          A connection string is configured, so this is a connection problem —
          check that the database is claimed/active in Neon, and see the
          function logs (<strong>Logs → Functions</strong> in the Netlify
          dashboard) for details. The schema is created automatically once the
          connection succeeds; no manual migration is needed.
        </p>
      )}
    </div>
  );
}
