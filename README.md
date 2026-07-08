# PoliticalMonitor — Political Email Archive

A website that ingests ATOM feeds of incoming political emails, categorizes
them with DeepSeek (via OpenRouter), and publishes them as a searchable,
filterable archive of emails from candidates and politicians.

## How it works

```
campaign mailing list ──► email-to-ATOM bridge ──► ingester ──► SQLite ──► web feed
     (subscribe)         (Kill the Newsletter!)      │
                                                     └──► DeepSeek via OpenRouter
                                                          (email type, policy topics,
                                                           summary, fundraising ask)
```

1. **Subscribe** to a candidate's mailing list using an email-to-feed bridge
   such as [Kill the Newsletter!](https://kill-the-newsletter.com) — it gives
   you an inbox address and a matching ATOM feed URL.
2. **Register** that feed URL on the **Sources** page, tagged with candidate,
   party, office, and state.
3. **Ingest** — the app fetches every active feed, parses new entries, and
   stores each email deduplicated by ATOM entry ID (RSS 2.0 feeds also work).
4. **Categorize** — each new email is sent to DeepSeek through the OpenRouter
   API, which assigns:
   - an **email type** (fundraising, event, volunteer, survey/petition,
     newsletter, endorsement, attack/contrast, GOTV, merchandise, thank-you)
   - up to four **policy topics** from a fixed 24-topic taxonomy
     (Healthcare, Immigration & Border, Climate & Energy, …)
   - a neutral one-line **summary**
   - a **fundraising-ask** flag
5. **Browse** — the public feed supports keyword search plus filtering by
   topic, type, party, and source, with newest/oldest sorting and pagination.
   Full emails render with sanitized HTML.

## Setup

```bash
npm install
cp .env.example .env    # add your OpenRouter API key
npm run dev             # http://localhost:3000
```

Environment variables (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter key used for DeepSeek categorization. Without it, emails are archived but left uncategorized. |
| `OPENROUTER_MODEL` | Model id, defaults to `deepseek/deepseek-chat-v3-0324`. |
| `INGEST_SECRET` | Optional bearer token protecting `POST /api/ingest`. |
| `DATABASE_PATH` | SQLite file location, defaults to `./data/politicalmonitor.db`. |

## Running ingestion

Three equivalent ways to pull new emails and categorize them:

- Click **"Fetch feeds & categorize now"** on the Sources page.
- `POST /api/ingest` (add `Authorization: Bearer $INGEST_SECRET` if set) —
  point a cron scheduler at this endpoint.
- `npm run ingest` — CLI entry point for system cron, e.g.
  `*/15 * * * * cd /srv/politicalmonitor && npm run ingest`.

Categorization is retried on the next ingest run for any email that failed
(errors are stored per-email and shown on the email page).

## API

- `GET /api/emails?q=&topic=&type=&party=&source=&sort=&page=&pageSize=` —
  JSON list of archived emails (bodies replaced with a 280-char excerpt).
- `POST /api/ingest?source=<id>` — fetch feeds (optionally one source) and
  categorize pending emails; returns a per-source report.

## Stack

Next.js 15 (App Router, server components + server actions), SQLite via
better-sqlite3, fast-xml-parser for ATOM/RSS, sanitize-html for safe email
rendering, DeepSeek via the OpenRouter chat-completions API.

Note: the database is a local SQLite file, so deploy to a host with a
persistent disk (VPS, Fly.io, Railway volume, etc.) rather than a serverless
platform.
