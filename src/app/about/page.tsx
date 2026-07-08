export default function AboutPage() {
  return (
    <div className="prose">
      <h1 className="page-title">About this archive</h1>
      <p>
        PoliticalMonitor is a public archive of emails sent by political
        candidates, campaigns, and office-holders. It preserves fundraising
        appeals, newsletters, event invitations, and attack emails so
        researchers and journalists can study how politicians communicate with
        supporters over time.
      </p>

      <h2>How it works</h2>
      <p>
        <strong>1. Collection.</strong> Each mailing list is subscribed through
        an email-to-feed bridge (such as Kill the Newsletter!), which converts
        incoming emails into an ATOM feed. Those feed URLs are registered on
        the <a href="/sources">Sources</a> page.
      </p>
      <p>
        <strong>2. Ingestion.</strong> The ingester periodically fetches every
        active feed, parses new entries, and stores the full email — subject,
        sender, timestamp, and HTML body — deduplicated by entry ID. Trigger it
        from the Sources page, via <code>POST /api/ingest</code>, or with{" "}
        <code>npm run ingest</code> on a schedule.
      </p>
      <p>
        <strong>3. Categorization.</strong> Each new email is analyzed by
        DeepSeek (via the OpenRouter API), which assigns an email type
        (fundraising, event, get-out-the-vote, …), up to four policy topics
        from a fixed taxonomy (Healthcare, Immigration &amp; Border, Climate
        &amp; Energy, …), a neutral one-line summary, and whether the email
        contains a fundraising ask.
      </p>
      <p>
        <strong>4. Browsing.</strong> The <a href="/">feed</a> can be filtered
        by policy topic, email type, party, and sender, searched by keyword,
        and sorted by date. A JSON API is available at{" "}
        <code>GET /api/emails</code>.
      </p>
    </div>
  );
}
