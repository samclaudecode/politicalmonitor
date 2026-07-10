# PoliticalMonitor — Political Email Archive

A website that ingests ATOM feeds of incoming political emails, categorizes
them with DeepSeek (via OpenRouter), and publishes them as a searchable,
filterable archive of emails from candidates and politicians.

Built for Netlify: the site runs on Netlify's Next.js runtime, the archive is
stored in **Netlify DB** (managed Postgres, powered by Neon) with a full-text
search index, and a Netlify **scheduled function** pulls new emails every
30 minutes.

## How it works

```
campaign mailing list ──► email-to-ATOM bridge ──► ingester ──► Netlify DB ──► web feed
     (subscribe)         (Kill the Newsletter!)      │          (Postgres +
                                                     │           full-text search)
                                                     └──► DeepSeek via OpenRouter
                                                          (email type, policy topics,
                                                           summary, fundraising ask)
```

1. **Subscribe** to a candidate's mailing list using your
   [Feedbin](https://feedbin.com) email address (found in Feedbin settings;
   you can create custom `@feedb.in` addresses per topic). Every sender
   becomes its own feed inside your Feedbin account. (Public ATOM/RSS feed
   URLs, e.g. from Kill the Newsletter!, are also still supported.)
2. **Import** — click "Import feeds from Feedbin" on the **Sources** page to
   create a source per newsletter, then use **Edit** to tag each with
   candidate, party, office, and state.
3. **Ingest** — every 30 minutes (or on demand) the app pulls new entries for
   each active source via the Feedbin API (or by fetching the ATOM/RSS URL),
   deduplicated by entry ID.
4. **Categorize** — each new email is sent to DeepSeek through the OpenRouter
   API, which assigns:
   - an **email type** (fundraising, event, volunteer, survey/petition,
     newsletter, endorsement, attack/contrast, GOTV, merchandise, thank-you)
   - up to four **policy topics** from a fixed 24-topic taxonomy
     (Healthcare, Immigration & Border, Climate & Energy, …)
   - a neutral one-line **summary**
   - a **fundraising-ask** flag
5. **Browse & search** — the public feed supports Postgres full-text search
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
