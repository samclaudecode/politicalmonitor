import { focusParty } from "@/lib/taxonomy";

export default function AboutPage() {
  const party = focusParty();
  return (
    <div className="prose">
      <h1 className="page-title">About this archive</h1>
      <p>
        PoliticalMonitor is a public archive of what {party} politicians say
        in the two channels they control directly: their <strong>email
        lists</strong> and their <strong>X (Twitter) accounts</strong>. It
        preserves newsletters, fundraising appeals, and original tweets so
        researchers and journalists can study how the party communicates over
        time.
      </p>

      <h2>How it works</h2>
      <p>
        <strong>1. Emails.</strong> Each politician&apos;s mailing list is
        subscribed through a Feedbin address, which turns every sender into a
        feed readable over the Feedbin API. Public ATOM/RSS feeds work too.
      </p>
      <p>
        <strong>2. Tweets.</strong> Each politician&apos;s X account is read
        through a Nitter instance&apos;s RSS feed. Only <em>original</em>{" "}
        tweets are archived — retweets/reposts, replies, and items authored by
        anyone other than the account holder are filtered out.
      </p>
      <p>
        <strong>3. Ingestion.</strong> Every 30 minutes the ingester pulls
        each active source and stores new items — deduplicated by entry ID —
        with full content and timestamps.
      </p>
      <p>
        <strong>4. Categorization.</strong> Each new item is analyzed by
        DeepSeek (via the OpenRouter API), which assigns up to four UK policy
        topics from a fixed taxonomy (Immigration &amp; Small Boats, Net Zero
        &amp; Energy, NHS &amp; Social Care, Brexit &amp; EU Relations, …), an
        email type for emails, a neutral one-line summary, and whether it
        contains a fundraising ask.
      </p>
      <p>
        <strong>5. Browsing.</strong> The <a href="/">feed</a> can be filtered
        by content type (emails / tweets), policy topic, email type, party,
        and person, searched by keyword, and sorted by date. A JSON API is
        available at <code>GET /api/emails</code>.
      </p>
    </div>
  );
}
