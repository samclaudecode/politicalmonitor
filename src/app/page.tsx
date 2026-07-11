import Link from "next/link";
import {
  queryEmails,
  listSources,
  listUsedTopics,
  listUsedTypes,
  rebuttalCounts,
  stats,
  type EmailListItem,
} from "@/lib/db";
import { PARTIES, emailTypeLabel, focusParty, partySlug } from "@/lib/taxonomy";
import { isAdmin } from "@/lib/auth";
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

function EmailCard({
  email,
  rebuttals,
  admin,
}: {
  email: EmailListItem;
  rebuttals: number;
  admin: boolean;
}) {
  const isTweet = email.kind === "tweet";
  const who = email.candidate || email.source_name;
  const roleLine = [email.office, email.state].filter(Boolean).join(" · ");
  return (
    <article className="email-card">
      <div className="email-card-top">
        <div className="card-source">
          <span className={`party-badge party-${partySlug(email.party)}`}>
            {email.party === "Unknown" ? "?" : email.party}
          </span>
          {isTweet ? <span aria-hidden style={{ color: "var(--twitter)" }}>𝕏</span> : <span aria-hidden>✉️</span>}
          <span>{who}</span>
          {roleLine ? (
            <span style={{ color: "var(--ink-faint)", fontWeight: 500 }}>
              · {roleLine}
            </span>
          ) : null}
        </div>
        <span className="email-date">{formatDate(email.received_at)}</span>
      </div>

      {isTweet ? (
        <p className="tweet-text">
          <Link href={`/email/${email.id}`} style={{ color: "var(--ink)" }}>
            {email.subject}
          </Link>
        </p>
      ) : (
        <>
          <h2 className="email-subject">
            <Link href={`/email/${email.id}`}>{email.subject}</Link>
          </h2>
          {email.summary ? <p className="email-summary">{email.summary}</p> : null}
        </>
      )}

      <div className="chip-row">
        {isTweet ? (
          <Link className="chip chip-tweet" href="/?kind=tweet">
            𝕏 Tweet
          </Link>
        ) : email.email_type ? (
          <Link className="chip chip-type" href={`/?type=${email.email_type}`}>
            {emailTypeLabel(email.email_type)}
          </Link>
        ) : null}
        {!email.categorized_at ? (
          <span className="chip chip-pending">uncategorized</span>
        ) : null}
        {email.fundraising_ask ? (
          <span className="chip chip-money">£ ask</span>
        ) : null}
        {email.topics.map((t) => (
          <Link key={t} className="chip" href={`/?topic=${encodeURIComponent(t)}`}>
            {t}
          </Link>
        ))}
        {admin ? (
          <Link
            href={`/email/${email.id}#rebuttals`}
            className={rebuttals > 0 ? "chip chip-count" : "chip"}
            style={{ marginLeft: "auto" }}
          >
            {rebuttals > 0
              ? `✦ ${rebuttals} rebuttal${rebuttals === 1 ? "" : "s"}`
              : "✦ Draft rebuttal"}
          </Link>
        ) : null}
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
  const kindParam = first(sp.kind);
  const filters = {
    q: first(sp.q),
    topic: first(sp.topic),
    type: first(sp.type),
    kind: kindParam === "email" || kindParam === "tweet" ? kindParam : "",
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
      kind: filters.kind || undefined,
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

  const admin = await isAdmin();
  const rbCounts = admin
    ? await rebuttalCounts(items.map((i) => i.id))
    : new Map<number, number>();

  const currentParams: Record<string, string> = {
    q: filters.q,
    topic: filters.topic,
    type: filters.type,
    kind: filters.kind,
    party: filters.party,
    source: filters.source,
    sort: filters.sort === "oldest" ? "oldest" : "",
  };

  return (
    <>
      <h1 className="page-title">War Room Feed</h1>
      <p className="page-sub">
        {s.emails.toLocaleString()} emails and {s.tweets.toLocaleString()}{" "}
        original tweets from {s.sources} feeds tracking {focusParty()}{" "}
        politicians — categorized by policy topic, ready to rebut.
      </p>

      <form className="filter-bar" method="get" action="/">
        <div className="filter-field">
          <label htmlFor="q">Search</label>
          <input
            type="text"
            id="q"
            name="q"
            placeholder="Subject, tweet, person…"
            defaultValue={filters.q}
          />
        </div>
        <div className="filter-field">
          <label htmlFor="kind">Content</label>
          <select id="kind" name="kind" defaultValue={filters.kind}>
            <option value="">Emails & tweets</option>
            <option value="email">Emails only</option>
            <option value="tweet">Tweets only</option>
          </select>
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
        {total.toLocaleString()} item{total === 1 ? "" : "s"} match
        {total === 1 ? "es" : ""}
        {filters.topic ? ` topic “${filters.topic}”` : ""}
        {filters.q ? ` search “${filters.q}”` : ""}.
      </p>

      {items.length === 0 ? (
        <div className="empty-state">
          {s.emails === 0 && s.tweets === 0 ? (
            <>
              <p>The war room is quiet.</p>
              <p>
                <Link href="/sources">Add a source</Link> — an email feed or an
                X account — and run a sync to start monitoring.
              </p>
            </>
          ) : (
            <p>Nothing matches these filters.</p>
          )}
        </div>
      ) : (
        <div className="email-list">
          {items.map((email) => (
            <EmailCard
              key={email.id}
              email={email}
              rebuttals={rbCounts.get(email.id) ?? 0}
              admin={admin}
            />
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
