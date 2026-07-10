import Link from "next/link";
import { notFound } from "next/navigation";
import sanitizeHtml from "sanitize-html";
import { getEmail } from "@/lib/db";
import { emailTypeLabel } from "@/lib/taxonomy";
import { isAdmin } from "@/lib/auth";
import DbSetupNotice from "../../components/DbSetupNotice";
import { deleteEmailAction } from "../actions";

export const dynamic = "force-dynamic";

function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "center",
      "font",
      "u",
    ]),
    allowedAttributes: {
      "*": ["style", "align", "valign", "width", "height", "bgcolor", "color"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "style"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer nofollow",
      }),
    },
  });
}

export default async function EmailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const emailId = parseInt(id, 10);
  if (Number.isNaN(emailId)) notFound();
  let email;
  try {
    email = await getEmail(emailId);
  } catch (err) {
    console.error("Email page: database error:", err);
    return <DbSetupNotice error={err} />;
  }
  if (!email) notFound();
  const admin = await isAdmin();

  const received = new Date(email.received_at).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });

  return (
    <>
      <div
        style={{
          marginTop: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Link href="/">← Back to feed</Link>
        {admin ? (
          <form action={deleteEmailAction}>
            <input type="hidden" name="id" value={email.id} />
            <button type="submit" className="btn-danger">
              Delete this email
            </button>
          </form>
        ) : null}
      </div>
      <header className="email-detail-header">
        <h1>{email.subject}</h1>
        <p className="email-detail-meta">
          <span className={`party-badge party-${email.party}`}>
            {email.party === "Unknown" ? "?" : email.party}
          </span>{" "}
          From <strong>{email.sender_name || email.source_name}</strong>
          {email.sender_email ? ` <${email.sender_email}>` : ""} · {received}
          {email.office || email.state ? (
            <> · {[email.office, email.state].filter(Boolean).join(", ")}</>
          ) : null}
        </p>
        <div className="chip-row">
          {email.email_type ? (
            <Link className="chip chip-type" href={`/?type=${email.email_type}`}>
              {emailTypeLabel(email.email_type)}
            </Link>
          ) : (
            <span className="chip chip-pending">awaiting categorization</span>
          )}
          {email.fundraising_ask ? (
            <span className="chip chip-money">$ fundraising ask</span>
          ) : null}
          {email.topics.map((t) => (
            <Link
              key={t}
              className="chip"
              href={`/?topic=${encodeURIComponent(t)}`}
            >
              {t}
            </Link>
          ))}
        </div>
        {email.summary ? (
          <div className="summary-box">
            <strong>AI summary:</strong> {email.summary}
          </div>
        ) : null}
        {email.categorization_error ? (
          <div className="summary-box" style={{ borderLeftColor: "#c33" }}>
            <strong>Categorization failed:</strong> {email.categorization_error}
          </div>
        ) : null}
      </header>

      <div className="email-body">
        {email.html_body ? (
          <div
            dangerouslySetInnerHTML={{
              __html: sanitizeEmailHtml(email.html_body),
            }}
          />
        ) : (
          <div className="email-body-text">{email.text_body || "(empty email)"}</div>
        )}
      </div>
    </>
  );
}
