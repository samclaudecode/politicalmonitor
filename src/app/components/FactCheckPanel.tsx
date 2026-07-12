import { getFactCheck } from "@/lib/db";
import {
  parseClaims,
  parseDocContext,
  bsLabel,
  factCheckDailyCap,
} from "@/lib/factcheck";
import { isRebuttalConfigured } from "@/lib/rebuttal";
import { factCheckAction, deleteFactCheckAction } from "../email/actions";

const VERDICT_CLASS: Record<string, string> = {
  accurate: "verdict-accurate",
  "mostly-true": "verdict-mostly",
  misleading: "verdict-misleading",
  unsupported: "verdict-unsupported",
  false: "verdict-false",
};

function Meter({ score, contested }: { score: number; contested: boolean }) {
  const pos = Math.max(0, Math.min(100, score));
  const band = contested ? 18 : 6; // wider uncertainty band when contested
  return (
    <div className="bs-meter">
      <div className="bs-meter-head">
        <span className="bs-meter-score">{score}</span>
        <span className="bs-meter-label">{bsLabel(score)}</span>
        {contested ? (
          <span className="chip chip-pending">contested — human review</span>
        ) : null}
      </div>
      <div className="bs-track">
        <div
          className="bs-band"
          style={{
            left: `${Math.max(0, pos - band)}%`,
            width: `${Math.min(100, pos + band) - Math.max(0, pos - band)}%`,
          }}
        />
        <div className="bs-needle" style={{ left: `${pos}%` }} />
      </div>
      <div className="bs-scale">
        <span>Grounded</span>
        <span>Spin</span>
        <span>Total Bull</span>
      </div>
    </div>
  );
}

/**
 * On-demand fact-check panel (admin only): claim triage → Fusion web
 * verification → grounding docs, with a cached BS meter and receipts.
 */
export default async function FactCheckPanel({
  emailId,
  error,
}: {
  emailId: number;
  error?: string;
}) {
  const check = await getFactCheck(emailId);
  const configured = isRebuttalConfigured();
  const cap = factCheckDailyCap();
  const claims = check ? parseClaims(check) : [];
  const docs = check ? parseDocContext(check) : [];

  return (
    <section className="rebuttal-panel" id="factcheck">
      <div className="rebuttal-head">
        <span className="label">
          <span aria-hidden>⚖️</span> Fact Check &amp; BS Meter
        </span>
        {configured ? (
          <form action={factCheckAction}>
            <input type="hidden" name="id" value={emailId} />
            <button type="submit">
              {check ? "↻ Re-check" : "⚖ Run fact-check"}
            </button>
          </form>
        ) : null}
      </div>
      <div className="rebuttal-body">
        {error ? <div className="notice">{error}</div> : null}
        {!configured ? (
          <p className="rebuttal-empty">
            Set <code>OPENROUTER_API_KEY</code> to enable fact-checking.
          </p>
        ) : !check ? (
          <p className="rebuttal-empty">
            Not checked yet. Runs claim triage, then verifies against the web
            (OpenRouter Fusion: model panel + search + judge), then compares
            with your grounding docs. On-demand only — a check costs a few
            pence and takes up to a couple of minutes.
            {cap !== null ? ` Daily cap: ${cap}.` : ""}
          </p>
        ) : check.status === "no_claims" ? (
          <p className="rebuttal-empty">
            <strong>No checkable claims</strong> — {check.notes} (
            {new Date(check.created_at).toLocaleString()})
          </p>
        ) : (
          <>
            {check.bs_score !== null ? (
              <Meter score={check.bs_score} contested={check.contested} />
            ) : null}

            <div className="receipts">
              {claims.map((c, i) => (
                <div className="receipt" key={i}>
                  <div className="receipt-top">
                    <span className={`chip ${VERDICT_CLASS[c.verdict] ?? ""}`}>
                      {c.verdict.replace("-", " ")}
                    </span>
                    <span className="receipt-conf">
                      {c.confidence}% confidence
                      {c.contested ? " · contested" : ""}
                    </span>
                  </div>
                  <div className="receipt-claim">“{c.claim}”</div>
                  {c.rationale ? (
                    <div className="receipt-rationale">{c.rationale}</div>
                  ) : null}
                  {c.evidence_quote ? (
                    <blockquote className="receipt-quote">
                      “{c.evidence_quote}”
                      {c.evidence_url ? (
                        <>
                          {" — "}
                          <a
                            href={c.evidence_url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                          >
                            {c.source || "source"} ↗
                          </a>
                        </>
                      ) : c.source ? (
                        <> — {c.source}</>
                      ) : null}
                    </blockquote>
                  ) : null}
                </div>
              ))}
            </div>

            {docs.length > 0 ? (
              <div className="partyline">
                <div className="partyline-label">
                  What our grounding docs say
                </div>
                {docs.map((d, i) => (
                  <div className="partyline-item" key={i}>
                    <strong>{d.document}:</strong> {d.excerpt}…
                  </div>
                ))}
              </div>
            ) : null}

            <div className="rebuttal-meta">
              <span>{new Date(check.created_at).toLocaleString()}</span>
              {check.notes ? <span>{check.notes}</span> : null}
              <span>
                {check.model}
                {check.tokens_used ? ` · ${check.tokens_used.toLocaleString()} tokens` : ""}
                {check.cost_usd ? ` · ~$${check.cost_usd.toFixed(4)}` : ""}
              </span>
              <form action={deleteFactCheckAction} style={{ marginLeft: "auto" }}>
                <input type="hidden" name="id" value={emailId} />
                <button type="submit" className="btn-danger btn-small">
                  Delete
                </button>
              </form>
            </div>
            <p className="fc-disclaimer">
              AI-assisted assessment for internal triage — verify the linked
              sources before publishing anything.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
