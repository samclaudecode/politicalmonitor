import Link from "next/link";
import {
  queryEmails,
  listSources,
  listUsedTopics,
  listUsedTypes,
  stats,
  type EmailListItem,
} from "@/lib/db";
import { PARTIES, emailTypeLabel } from "@/lib/taxonomy";
import DbSetupNotice from "./components/DbSetupNotice";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildQuery(
  params: Record<string, string>,
  overrides: Record<string, string>
): string {
  const merged = { ...params, ...overrides };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

function EmailCard({ email }: { email: EmailListItem }) {
  const senderLine = [
    email.candidate || email.source_name,
    email.office,
    email.state,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="email-card">
      <div className="email-card-top">
        <h2 className="email-subject">
          <Link href={`/email/${email.id}`}>{email.subject}</Link>
        </h2>
        <span className="email-date">{formatDate(email.received_at)}</span>
      </div>
      <p className="email-sender">
        <span className={`party-badge party-${email.party}`}>
          {email.party === "Unknown" ? "?" : email.party.slice(0, 3).toUpperCase()}
        </span>{" "}
        {senderLine}
        {email.sender_email ? (
          <span style={{ color: "var(--ink-faint)" }}> · {email.sender_email}</span>
        ) : null}
      </p>
      {email.summary ? <p className="email-summary">{email.summary}</p> : null}
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
          <Link key={t} className="chip" href={`/?topic=${encodeURIComponent(t)}`}>
            {t}
          </Link>
        ))}
      </div>
    </article>
  );
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filters = {
    q: first(sp.q),
    topic: first(sp.topic),
    type: first(sp.type),
    party: first(sp.party),
    source: first(sp.source),
    sort: first(sp.sort) === "oldest" ? ("oldest" as const) : ("newest" as const),
    page: Math.max(1, parseInt(first(sp.page) || "1", 10) || 1),
  };

  let items, total, page, pageCount, sources, topics, types, s;
  try {
    ({ items, total, page, pageCount } = await queryEmails({
      q: filters.q || undefined,
      topic: filters.topic || undefined,
      type: filters.type || undefined,
      party: filters.party || undefined,
      source: filters.source ? parseInt(filters.source, 10) : undefined,
      sort: filters.sort,
      page: filters.page,
    }));
    [sources, topics, types, s] = await Promise.all([
      listSources(),
      listUsedTopics(),
      listUsedTypes(),
      stats(),
    ]);
  } catch (err) {
    console.error("Feed page: database error:", err);
    return <DbSetupNotice error={err} />;
  }

  const currentParams: Record<string, string> = {
    q: filters.q,
    topic: filters.topic,
    type: filters.type,
    party: filters.party,
    source: filters.source,
    sort: filters.sort === "oldest" ? "oldest" : "",
  };

  return (
    <>
      <h1 className="page-title">The Archive</h1>
      <p className="page-sub">
        {s.emails.toLocaleString()} political emails from {s.sources} sources,
        categorized by policy topic.
      </p>

      <form className="filter-bar" method="get" action="/">
        <div className="filter-field">
          <label htmlFor="q">Search</label>
          <input
            type="text"
            id="q"
            name="q"
            placeholder="Subject, body, candidate…"
            defaultValue={filters.q}
          />
        </div>
        <div className="filter-field">
          <label htmlFor="topic">Policy topic</label>
          <select id="topic" name="topic" defaultValue={filters.topic}>
            <option value="">All topics</option>
            {topics.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} ({t.count})
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="type">Email type</label>
          <select id="type" name="type" defaultValue={filters.type}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.email_type} value={t.email_type}>
                {emailTypeLabel(t.email_type)} ({t.count})
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="party">Party</label>
          <select id="party" name="party" defaultValue={filters.party}>
            <option value="">All parties</option>
            {PARTIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="source">Source</label>
          <select id="source" name="source" defaultValue={filters.source}>
            <option value="">All sources</option>
            {sources.map((src) => (
              <option key={src.id} value={src.id}>
                {src.candidate || src.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="sort">Sort</label>
          <select id="sort" name="sort" defaultValue={filters.sort}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
        <div className="filter-actions">
          <button type="submit">Filter</button>
          <Link href="/" className="btn btn-secondary">
            Reset
          </Link>
        </div>
      </form>

      <p className="result-meta">
        {total.toLocaleString()} email{total === 1 ? "" : "s"} match
        {total === 1 ? "es" : ""}
        {filters.topic ? ` topic “${filters.topic}”` : ""}
        {filters.q ? ` search “${filters.q}”` : ""}.
      </p>

      {items.length === 0 ? (
        <div className="empty-state">
          {s.emails === 0 ? (
            <>
              <p>The archive is empty.</p>
              <p>
                <Link href="/sources">Add an ATOM feed source</Link> and run an
                ingest to start collecting emails.
              </p>
            </>
          ) : (
            <p>No emails match these filters.</p>
          )}
        </div>
      ) : (
        <div className="email-list">
          {items.map((email) => (
            <EmailCard key={email.id} email={email} />
          ))}
        </div>
      )}

      {pageCount > 1 ? (
        <nav className="pagination">
          {page > 1 ? (
            <Link
              className="btn btn-secondary btn-small"
              href={buildQuery(currentParams, { page: String(page - 1) })}
            >
              ← Prev
            </Link>
          ) : null}
          <span>
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link
              className="btn btn-secondary btn-small"
              href={buildQuery(currentParams, { page: String(page + 1) })}
            >
              Next →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
