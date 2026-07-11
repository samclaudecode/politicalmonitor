import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin, isAuthConfigured } from "@/lib/auth";
import { listSources, stats } from "@/lib/db";
import { PARTIES, focusParty, partySlug } from "@/lib/taxonomy";
import { isCategorizationConfigured } from "@/lib/categorize";
import { isFeedbinConfigured, feedbinFeedId } from "@/lib/feedbin";
import DbSetupNotice from "../components/DbSetupNotice";
import {
  addSourceAction,
  deleteSourceAction,
  toggleSourceAction,
  ingestNowAction,
  importFeedbinAction,
} from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");
  const sp = await searchParams;
  const ok = first(sp.ok);
  const error = first(sp.error);
  let sources, s;
  try {
    [sources, s] = await Promise.all([listSources(), stats()]);
  } catch (err) {
    console.error("Sources page: database error:", err);
    return <DbSetupNotice error={err} />;
  }
  const aiReady = isCategorizationConfigured();
  const feedbinReady = isFeedbinConfigured();

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 className="page-title">Feed Sources</h1>
        {isAuthConfigured() ? (
          <form method="post" action="/api/admin/logout">
            <button type="submit" className="btn-secondary btn-small">
              Sign out
            </button>
          </form>
        ) : null}
      </div>
      <p className="page-sub">
        Track each {focusParty()} politician through two kinds of source:
        their <strong>email list</strong> (subscribe with your Feedbin{" "}
        <code>@feedb.in</code> address and import below, or register an
        ATOM/RSS URL) and their <strong>X account</strong> via Nitter — only
        original tweets are archived; reposts and replies are filtered out.
      </p>

      {ok ? <div className="notice notice-ok">{ok}</div> : null}
      {error ? <div className="notice">{error}</div> : null}
      {!isAuthConfigured() ? (
        <div className="notice">
          <strong>This page is not password-protected.</strong> Set an{" "}
          <code>ADMIN_PASSWORD</code> environment variable (and redeploy) to
          require a sign-in for managing sources and deleting emails.
        </div>
      ) : null}
      {!aiReady ? (
        <div className="notice">
          <strong>OPENROUTER_API_KEY is not set.</strong> Emails will be
          ingested but not categorized. Add your OpenRouter key to{" "}
          <code>.env</code> to enable DeepSeek policy-topic categorization.
        </div>
      ) : null}

      <div className="stat-row">
        <div className="stat">
          <b>{s.sources}</b>
          <span>sources</span>
        </div>
        <div className="stat">
          <b>{s.emails.toLocaleString()}</b>
          <span>emails</span>
        </div>
        <div className="stat">
          <b>{s.tweets.toLocaleString()}</b>
          <span>tweets</span>
        </div>
        <div className="stat">
          <b>{s.uncategorized.toLocaleString()}</b>
          <span>uncategorized</span>
        </div>
        <form action={ingestNowAction} style={{ alignSelf: "center" }}>
          <button type="submit">↻ Sync intel now</button>
        </form>
      </div>

      <div className="form-card">
        <h2>Feedbin</h2>
        {feedbinReady ? (
          <>
            <p style={{ color: "var(--ink-soft)", fontSize: "0.92rem" }}>
              Subscribe to campaign mailing lists with your Feedbin email
              address — each sender becomes its own feed in Feedbin. Import
              turns every Feedbin feed into a source here (already-imported
              ones are skipped), then use <strong>Edit</strong> to tag each
              with candidate and party.
            </p>
            <form action={importFeedbinAction}>
              <button type="submit">Import feeds from Feedbin</button>
            </form>
          </>
        ) : (
          <p style={{ color: "var(--ink-soft)", fontSize: "0.92rem" }}>
            Not connected. Set <code>FEEDBIN_EMAIL</code> and{" "}
            <code>FEEDBIN_PASSWORD</code> environment variables (your Feedbin
            login) and redeploy to import newsletter feeds directly from your
            Feedbin account.
          </p>
        )}
      </div>

      <div className="form-card">
        <h2>Add a source manually</h2>
        <form action={addSourceAction}>
          <div className="form-grid">
            <div>
              <label htmlFor="kind">Source type *</label>
              <select id="kind" name="kind" defaultValue="email">
                <option value="email">Email feed (ATOM/RSS or Feedbin)</option>
                <option value="twitter">X / Twitter (via Nitter)</option>
              </select>
            </div>
            <div className="full">
              <label htmlFor="feed_url">
                Feed URL — or X handle / RSS URL for X sources *
              </label>
              <input
                id="feed_url"
                name="feed_url"
                required
                placeholder="@Nigel_Farage · https://rss.xcancel.com/Nigel_Farage/rss · feedbin:123456"
              />
              <div className="dropzone-hint">
                For X sources you can enter a handle (<code>@name</code>), an
                x.com profile URL, or any working RSS URL (a self-hosted
                Nitter, rss.app, etc.). Handles resolve to the configured
                Nitter instance.
              </div>
            </div>
            <div>
              <label htmlFor="name">Source name *</label>
              <input
                id="name"
                name="name"
                required
                placeholder="Nigel Farage — X"
              />
            </div>
            <div>
              <label htmlFor="candidate">Person / MP</label>
              <input id="candidate" name="candidate" placeholder="Nigel Farage" />
            </div>
            <div>
              <label htmlFor="party">Party</label>
              <select id="party" name="party" defaultValue={focusParty()}>
                {PARTIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="office">Role</label>
              <input id="office" name="office" placeholder="MP / Party Leader" />
            </div>
            <div>
              <label htmlFor="state">Constituency</label>
              <input id="state" name="state" placeholder="Clacton" maxLength={40} />
            </div>
          </div>
          <button type="submit">Add source</button>
        </form>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Source</th>
              <th>Party</th>
              <th>Feed URL</th>
              <th>Last fetch</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--ink-faint)" }}>
                  No sources yet — add your first ATOM feed above.
                </td>
              </tr>
            ) : (
              sources.map((src) => (
                <tr key={src.id} style={src.active ? undefined : { opacity: 0.5 }}>
                  <td>
                    <strong>{src.name}</strong>
                    {src.candidate ? (
                      <>
                        <br />
                        <span style={{ color: "var(--ink-faint)" }}>
                          {[src.candidate, src.office, src.state]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className={`party-badge party-${partySlug(src.party)}`}>
                      {src.party}
                    </span>
                  </td>
                  <td style={{ maxWidth: 260, wordBreak: "break-all" }}>
                    {src.kind === "twitter" ? (
                      <>
                        <span className="chip chip-tweet">𝕏 Nitter</span>{" "}
                        <a
                          href={src.feed_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {src.feed_url}
                        </a>
                      </>
                    ) : feedbinFeedId(src.feed_url) !== null ? (
                      <>
                        <span className="chip chip-type">Feedbin</span>{" "}
                        <code style={{ fontSize: "0.8rem" }}>{src.feed_url}</code>
                      </>
                    ) : (
                      <a
                        href={src.feed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {src.feed_url}
                      </a>
                    )}
                  </td>
                  <td>
                    {src.last_fetched_at
                      ? new Date(src.last_fetched_at).toLocaleString()
                      : "never"}
                  </td>
                  <td>{src.last_fetch_status || "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Link
                        href={`/sources/${src.id}/edit`}
                        className="btn btn-secondary btn-small"
                      >
                        Edit
                      </Link>
                      <form action={toggleSourceAction}>
                        <input type="hidden" name="id" value={src.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={src.active ? "0" : "1"}
                        />
                        <button type="submit" className="btn-secondary btn-small">
                          {src.active ? "Pause" : "Resume"}
                        </button>
                      </form>
                      <form action={deleteSourceAction}>
                        <input type="hidden" name="id" value={src.id} />
                        <button type="submit" className="btn-danger">
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
