# PoliticalMonitor — Reform UK Emails & Tweets Archive

A website that tracks **UK politicians from a focus party (Reform UK by
default)** across two channels — their **email lists** and their **X/Twitter
accounts** — categorizes everything with DeepSeek (via OpenRouter) against a
UK policy taxonomy, and publishes it as a searchable, filterable archive.

Built for Netlify: the site runs on Netlify's Next.js runtime, the archive is
stored in **Netlify DB** (managed Postgres, powered by Neon) with a full-text
search index, and a Netlify **scheduled function** pulls new content every
30 minutes.

## How it works

```
mailing lists ──► Feedbin (@feedb.in) ─┐
                                       ├──► ingester ──► Netlify DB ──► web feed
X accounts ─────► Nitter RSS ──────────┘       │        (Postgres +
                  (original tweets only)       │         full-text search)
                                               └──► DeepSeek via OpenRouter
                                                    (UK policy topics, email type,
                                                     summary, fundraising ask)
```

1. **Emails** — subscribe to each politician's mailing list using your
   [Feedbin](https://feedbin.com) email address (custom `@feedb.in`
   addresses per person work well). Every sender becomes its own feed in
   Feedbin; click "Import feeds from Feedbin" on the **Sources** page.
   Public ATOM/RSS feed URLs are also supported.
2. **Tweets** — add each politician's X account as a source (just paste
   `@handle` or their x.com URL); the app reads their timeline through a
   [Nitter](https://github.com/zedeus/nitter) instance's RSS.
   **Only original tweets are archived** — retweets/reposts ("RT by …"),
   replies ("R to …"), and items whose author isn't the account holder are
   filtered out.
3. **Tag** each source with person, party (defaults to the focus party),
   role, and constituency via **Edit**.
4. **Ingest** — every 30 minutes (or on demand) the app pulls new entries
   for each active source, deduplicated by entry ID.
5. **Categorize** — each new item is sent to DeepSeek through the OpenRouter
   API, which assigns:
   - up to four **UK policy topics** from a fixed 24-topic taxonomy
     (Immigration & Small Boats, Net Zero & Energy, NHS & Social Care,
     Brexit & EU Relations, …)
   - an **email type** for emails (fundraising, event, survey/petition,
     newsletter, attack/contrast, …) — tweets are labelled as tweets
   - a neutral one-line **summary**
   - a **fundraising-ask** flag
6. **Browse & search** — the public feed supports Postgres full-text search
   (subject, summary, and body, weighted) plus filtering by topic, type,
   party, and source, with newest/oldest sorting and pagination. Full emails
   render with sanitized HTML.

## Deploy to Netlify

```bash
npm install -g netlify-cli
netlify login

# from the repo root:
netlify init      # create/link the Netlify site
netlify db init   # provision Netlify Database (Postgres) — injects NETLIFY_DB_URL

# set the remaining environment variables:
netlify env:set OPENROUTER_API_KEY sk-or-...
netlify env:set ADMIN_PASSWORD "choose-a-strong-password"
netlify env:set FEEDBIN_EMAIL you@example.com
netlify env:set FEEDBIN_PASSWORD "your-feedbin-password"
netlify env:set INGEST_SECRET "$(openssl rand -hex 24)"   # optional but recommended

netlify deploy --prod
```

That's it. The database schema is created automatically on first use, and the
`scheduled-ingest` function starts fetching feeds every 30 minutes. (Netlify DB
databases start unclaimed — claim the database from the site's dashboard to
keep it permanently.)

You can also connect the repo in the Netlify dashboard instead of using the
CLI; add the **Neon database** extension (Netlify DB) and the
`OPENROUTER_API_KEY` env var in site settings.

## Local development

```bash
npm install
cp .env.example .env   # add your OpenRouter key + a Postgres DATABASE_URL
npm run dev            # http://localhost:3000
```

If the site is already linked to Netlify, `netlify dev` runs it with the
production database URL and env vars injected automatically — no `.env`
needed.

Environment variables (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Password for the admin area (managing sources, deleting emails). Unset = admin features are open. |
| `FEEDBIN_EMAIL` / `FEEDBIN_PASSWORD` | Feedbin login, used to import newsletter feeds and ingest their emails via the Feedbin API. |
| `NITTER_BASE_URL` | Nitter instance for X timelines (default `https://nitter.net`; a self-hosted instance is much more reliable). |
| `FOCUS_PARTY` | Party the site focuses on (default `Reform UK`). |
| `NETLIFY_DB_URL` | Postgres connection string, injected by Netlify Database. |
| `NETLIFY_DATABASE_URL` | Same, injected by the legacy Neon extension (also supported). |
| `DATABASE_URL` | Fallback Postgres URL for local dev / other hosts. |
| `OPENROUTER_API_KEY` | OpenRouter key used for DeepSeek categorization. Without it, emails are archived but left uncategorized. |
| `OPENROUTER_MODEL` | Model id, defaults to `deepseek/deepseek-chat-v3-0324`. |
| `INGEST_SECRET` | Optional bearer token protecting `POST /api/ingest`. |

## Running ingestion

Ingestion runs as a two-stage pipeline on Netlify, sized to Netlify's
function limits: `scheduled-ingest` (a scheduled function, 30-second limit)
fires every 30 minutes and triggers `ingest-background` (a background
function, 15-minute limit), which pulls every active source — Feedbin API
and ATOM/RSS — and categorizes new emails with DeepSeek.

Ways to trigger a pull:

- **Automatic**: every 30 minutes via `scheduled-ingest` (edit the cron
  expression in `netlify/functions/scheduled-ingest.mts`).
- Click **"Fetch feeds & categorize now"** on the Sources page (hands off to
  the background function on Netlify; runs inline in local dev).
- `POST https://<site>/.netlify/functions/ingest-background` with
  `Authorization: Bearer $INGEST_SECRET` — for external schedulers.
- `POST /api/ingest` (same auth) — synchronous, returns the full report;
  best for small source counts.
- `npm run ingest` — CLI entry point, or
  `netlify functions:invoke scheduled-ingest` to fire the schedule by hand.

Categorization is retried on the next ingest run for any email that failed
(errors are stored per-email and shown on the email page).

## API

- `GET /api/emails?q=&topic=&type=&party=&source=&sort=&page=&pageSize=` —
  JSON list of archived emails (bodies replaced with a 280-char excerpt).
- `POST /api/ingest?source=<id>` — fetch feeds (optionally one source) and
  categorize pending emails; returns a per-source report.

## Stack

Next.js 15 (App Router, server components + server actions) on Netlify's
Next.js runtime, Netlify DB (Neon Postgres) via node-postgres with a
weighted `tsvector` full-text index, Netlify scheduled functions for
ingestion, fast-xml-parser for ATOM/RSS, sanitize-html for safe email
rendering, DeepSeek via the OpenRouter chat-completions API.
