import { redirect } from "next/navigation";
import { isAdmin, isAuthConfigured } from "@/lib/auth";
import { listDocuments, stats } from "@/lib/db";
import { documentSubtitle } from "@/lib/documents";
import { isRebuttalConfigured } from "@/lib/rebuttal";
import { uploadDocumentAction, deleteDocumentAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };
function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");
  const sp = await searchParams;
  const ok = first(sp.ok);
  const error = first(sp.error);
  const [docs, s] = await Promise.all([listDocuments(), stats()]);

  return (
    <>
      <h1 className="page-title">Grounding Documents</h1>
      <p className="page-sub">
        Upload manifestos, policy papers and briefing notes. AI-drafted
        rebuttals quote and cite directly from these — they are the factual
        backbone of every response.
      </p>

      {ok ? <div className="notice notice-ok">{ok}</div> : null}
      {error ? <div className="notice">{error}</div> : null}
      {!isRebuttalConfigured() ? (
        <div className="notice">
          <strong>OPENROUTER_API_KEY is not set.</strong> Documents will be
          stored and indexed, but rebuttals can&apos;t be generated until you
          add your OpenRouter key.
        </div>
      ) : null}
      {!isAuthConfigured() ? (
        <div className="notice">
          <strong>This page is not password-protected.</strong> Set an{" "}
          <code>ADMIN_PASSWORD</code> environment variable to require sign-in.
        </div>
      ) : null}

      <div className="stat-row">
        <div className="stat">
          <b>{s.documents}</b>
          <span>documents</span>
        </div>
        <div className="stat">
          <b>{s.rebuttals}</b>
          <span>rebuttals drafted</span>
        </div>
      </div>

      <div className="form-card">
        <h2>Upload a document</h2>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.9rem", margin: "4px 0 0" }}>
          PDF (text-based) or markdown / plain text, up to 8&nbsp;MB. Long
          manifestos work best as markdown.
        </p>
        <form action={uploadDocumentAction}>
          <div className="form-grid">
            <div>
              <label htmlFor="title">Title (optional)</label>
              <input id="title" name="title" placeholder="Reform UK Contract 2024" />
            </div>
            <div>
              <label htmlFor="file">File *</label>
              <input id="file" name="file" type="file" accept=".pdf,.md,.markdown,.txt,.text,application/pdf,text/markdown,text/plain" required />
            </div>
          </div>
          <button type="submit">Upload &amp; index</button>
        </form>
      </div>

      {docs.length === 0 ? (
        <div className="empty-state">
          No grounding documents yet — upload a manifesto or policy paper to
          ground your rebuttals.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Indexed</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.title}</strong>
                    {d.filename ? (
                      <>
                        <br />
                        <span style={{ color: "var(--ink-faint)", fontSize: "0.82rem" }}>
                          {d.filename}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className="chip chip-type">{d.kind.toUpperCase()}</span>
                  </td>
                  <td>{documentSubtitle(d)}</td>
                  <td>{new Date(d.created_at).toLocaleDateString()}</td>
                  <td>
                    <form action={deleteDocumentAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <button type="submit" className="btn-danger">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
