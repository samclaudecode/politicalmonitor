import { listRebuttals, hasDocuments } from "@/lib/db";
import { isRebuttalConfigured, parseCitations } from "@/lib/rebuttal";
import { draftRebuttalAction, deleteRebuttalAction } from "../email/actions";

/**
 * Draft-rebuttal panel shown on an item's detail page (admin only). Lists
 * existing drafts and offers a tone-selectable "Draft rebuttal" action.
 */
export default async function RebuttalPanel({
  emailId,
  error,
}: {
  emailId: number;
  error?: string;
}) {
  const [rebuttals, docsPresent] = await Promise.all([
    listRebuttals(emailId),
    hasDocuments(),
  ]);
  const configured = isRebuttalConfigured();

  return (
    <section className="rebuttal-panel" id="rebuttals">
      <div className="rebuttal-head">
        <span className="label">
          <span aria-hidden>🤖</span> Drafted Rebuttals
        </span>
        {configured ? (
          <form action={draftRebuttalAction} className="tone-select">
            <input type="hidden" name="id" value={emailId} />
            <select name="tone" defaultValue="measured" aria-label="Tone">
              <option value="measured">Measured</option>
              <option value="punchy">Punchy (≤280)</option>
              <option value="detailed">Detailed</option>
            </select>
            <button type="submit">✦ Draft rebuttal</button>
          </form>
        ) : null}
      </div>
      <div className="rebuttal-body">
        {error ? <div className="notice">{error}</div> : null}
        {!configured ? (
          <p className="rebuttal-empty">
            Set <code>OPENROUTER_API_KEY</code> to enable AI-drafted rebuttals.
          </p>
        ) : !docsPresent ? (
          <p className="rebuttal-empty">
            Tip: upload manifestos or policy papers under{" "}
            <a href="/documents">Grounding Docs</a> so rebuttals can cite real
            sources. You can still draft without them.
          </p>
        ) : null}

        {rebuttals.length === 0 ? (
          <p className="rebuttal-empty">No responses drafted yet.</p>
        ) : (
          rebuttals.map((r) => {
            const cites = parseCitations(r.citations);
            const noAttack = r.content.startsWith("NO REBUTTAL RECOMMENDED");
            return (
              <div
                className="rebuttal"
                key={r.id}
                style={noAttack ? { borderLeftColor: "var(--warn)" } : undefined}
              >
                {noAttack ? (
                  <span className="chip chip-type" style={{ marginBottom: 8, display: "inline-block" }}>
                    stand down
                  </span>
                ) : null}
                <div className="rebuttal-text">{r.content}</div>
                <div className="rebuttal-meta">
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                  {cites.length ? (
                    <span>
                      Grounded in:{" "}
                      {[...new Set(cites.map((c) => c.document))].join(", ")}
                    </span>
                  ) : (
                    <span>No document citations</span>
                  )}
                  <form action={deleteRebuttalAction} style={{ marginLeft: "auto" }}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="email_id" value={emailId} />
                    <button type="submit" className="btn-danger btn-small">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
