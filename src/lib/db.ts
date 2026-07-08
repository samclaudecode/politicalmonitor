import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH =
  process.env.DATABASE_PATH ||
  path.join(process.cwd(), "data", "politicalmonitor.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_url TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      candidate TEXT,
      party TEXT DEFAULT 'Unknown',
      office TEXT,
      state TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      last_fetched_at TEXT,
      last_fetch_status TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      guid TEXT NOT NULL,
      subject TEXT NOT NULL,
      sender_name TEXT,
      sender_email TEXT,
      received_at TEXT NOT NULL,
      html_body TEXT,
      text_body TEXT,
      summary TEXT,
      email_type TEXT,
      fundraising_ask INTEGER,
      categorized_at TEXT,
      categorization_error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (source_id, guid)
    );

    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS email_topics (
      email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      PRIMARY KEY (email_id, topic_id)
    );

    CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_emails_source ON emails(source_id);
    CREATE INDEX IF NOT EXISTS idx_emails_type ON emails(email_type);
    CREATE INDEX IF NOT EXISTS idx_email_topics_topic ON email_topics(topic_id);
  `);
}

// ---------- Types ----------

export interface Source {
  id: number;
  feed_url: string;
  name: string;
  candidate: string | null;
  party: string;
  office: string | null;
  state: string | null;
  active: number;
  last_fetched_at: string | null;
  last_fetch_status: string | null;
  created_at: string;
}

export interface EmailRow {
  id: number;
  source_id: number;
  guid: string;
  subject: string;
  sender_name: string | null;
  sender_email: string | null;
  received_at: string;
  html_body: string | null;
  text_body: string | null;
  summary: string | null;
  email_type: string | null;
  fundraising_ask: number | null;
  categorized_at: string | null;
  categorization_error: string | null;
  created_at: string;
}

export interface EmailListItem extends EmailRow {
  source_name: string;
  candidate: string | null;
  party: string;
  office: string | null;
  state: string | null;
  topics: string[];
}

// ---------- Sources ----------

export function listSources(): Source[] {
  return getDb()
    .prepare("SELECT * FROM sources ORDER BY name COLLATE NOCASE")
    .all() as Source[];
}

export function getSource(id: number): Source | undefined {
  return getDb().prepare("SELECT * FROM sources WHERE id = ?").get(id) as
    | Source
    | undefined;
}

export function addSource(input: {
  feed_url: string;
  name: string;
  candidate?: string;
  party?: string;
  office?: string;
  state?: string;
}): number {
  const res = getDb()
    .prepare(
      `INSERT INTO sources (feed_url, name, candidate, party, office, state)
       VALUES (@feed_url, @name, @candidate, @party, @office, @state)`
    )
    .run({
      feed_url: input.feed_url,
      name: input.name,
      candidate: input.candidate || null,
      party: input.party || "Unknown",
      office: input.office || null,
      state: input.state || null,
    });
  return Number(res.lastInsertRowid);
}

export function deleteSource(id: number) {
  getDb().prepare("DELETE FROM sources WHERE id = ?").run(id);
}

export function setSourceActive(id: number, active: boolean) {
  getDb()
    .prepare("UPDATE sources SET active = ? WHERE id = ?")
    .run(active ? 1 : 0, id);
}

export function recordFetch(id: number, status: string) {
  getDb()
    .prepare(
      `UPDATE sources
       SET last_fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_fetch_status = ?
       WHERE id = ?`
    )
    .run(status, id);
}

// ---------- Emails ----------

export function insertEmail(input: {
  source_id: number;
  guid: string;
  subject: string;
  sender_name?: string | null;
  sender_email?: string | null;
  received_at: string;
  html_body?: string | null;
  text_body?: string | null;
}): number | null {
  const res = getDb()
    .prepare(
      `INSERT INTO emails
         (source_id, guid, subject, sender_name, sender_email, received_at, html_body, text_body)
       VALUES
         (@source_id, @guid, @subject, @sender_name, @sender_email, @received_at, @html_body, @text_body)
       ON CONFLICT (source_id, guid) DO NOTHING`
    )
    .run({
      source_id: input.source_id,
      guid: input.guid,
      subject: input.subject,
      sender_name: input.sender_name ?? null,
      sender_email: input.sender_email ?? null,
      received_at: input.received_at,
      html_body: input.html_body ?? null,
      text_body: input.text_body ?? null,
    });
  return res.changes > 0 ? Number(res.lastInsertRowid) : null;
}

export function getEmail(id: number): EmailListItem | undefined {
  const row = getDb()
    .prepare(
      `SELECT e.*, s.name AS source_name, s.candidate, s.party, s.office, s.state
       FROM emails e JOIN sources s ON s.id = e.source_id
       WHERE e.id = ?`
    )
    .get(id) as (EmailRow & Omit<EmailListItem, "topics" | keyof EmailRow>) | undefined;
  if (!row) return undefined;
  return { ...row, topics: topicsForEmail(id) };
}

export function topicsForEmail(emailId: number): string[] {
  return (
    getDb()
      .prepare(
        `SELECT t.name FROM email_topics et JOIN topics t ON t.id = et.topic_id
         WHERE et.email_id = ? ORDER BY t.name`
      )
      .all(emailId) as { name: string }[]
  ).map((r) => r.name);
}

export function saveCategorization(
  emailId: number,
  result: {
    email_type: string;
    summary: string;
    fundraising_ask: boolean;
    topics: string[];
  }
) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE emails
       SET email_type = ?, summary = ?, fundraising_ask = ?,
           categorized_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           categorization_error = NULL
       WHERE id = ?`
    ).run(result.email_type, result.summary, result.fundraising_ask ? 1 : 0, emailId);

    db.prepare("DELETE FROM email_topics WHERE email_id = ?").run(emailId);
    const insertTopic = db.prepare(
      "INSERT INTO topics (name) VALUES (?) ON CONFLICT (name) DO NOTHING"
    );
    const getTopic = db.prepare("SELECT id FROM topics WHERE name = ?");
    const link = db.prepare(
      "INSERT OR IGNORE INTO email_topics (email_id, topic_id) VALUES (?, ?)"
    );
    for (const name of result.topics) {
      insertTopic.run(name);
      const t = getTopic.get(name) as { id: number };
      link.run(emailId, t.id);
    }
  });
  tx();
}

export function saveCategorizationError(emailId: number, message: string) {
  getDb()
    .prepare("UPDATE emails SET categorization_error = ? WHERE id = ?")
    .run(message.slice(0, 500), emailId);
}

export function listUncategorizedEmails(limit = 50): EmailRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM emails
       WHERE categorized_at IS NULL
       ORDER BY received_at DESC
       LIMIT ?`
    )
    .all(limit) as EmailRow[];
}

// ---------- Feed queries ----------

export interface FeedFilters {
  q?: string;
  topic?: string;
  type?: string;
  party?: string;
  source?: number;
  sort?: "newest" | "oldest";
  page?: number;
  pageSize?: number;
}

export function queryEmails(filters: FeedFilters): {
  items: EmailListItem[];
  total: number;
  page: number;
  pageCount: number;
} {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.q) {
    where.push(
      "(e.subject LIKE @q OR e.text_body LIKE @q OR e.summary LIKE @q OR s.candidate LIKE @q OR s.name LIKE @q)"
    );
    params.q = `%${filters.q}%`;
  }
  if (filters.type) {
    where.push("e.email_type = @type");
    params.type = filters.type;
  }
  if (filters.party) {
    where.push("s.party = @party");
    params.party = filters.party;
  }
  if (filters.source) {
    where.push("e.source_id = @source");
    params.source = filters.source;
  }
  if (filters.topic) {
    where.push(
      `e.id IN (SELECT et.email_id FROM email_topics et
                JOIN topics t ON t.id = et.topic_id WHERE t.name = @topic)`
    );
    params.topic = filters.topic;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = filters.sort === "oldest" ? "ASC" : "DESC";
  const pageSize = filters.pageSize ?? 25;
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM emails e JOIN sources s ON s.id = e.source_id ${whereSql}`
      )
      .get(params) as { n: number }
  ).n;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  const rows = db
    .prepare(
      `SELECT e.*, s.name AS source_name, s.candidate, s.party, s.office, s.state
       FROM emails e JOIN sources s ON s.id = e.source_id
       ${whereSql}
       ORDER BY e.received_at ${order}, e.id ${order}
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as (EmailRow &
    Omit<EmailListItem, "topics" | keyof EmailRow>)[];

  const items = rows.map((r) => ({ ...r, topics: topicsForEmail(r.id) }));
  return { items, total, page, pageCount };
}

export function listUsedTopics(): { name: string; count: number }[] {
  return getDb()
    .prepare(
      `SELECT t.name, COUNT(*) AS count
       FROM topics t JOIN email_topics et ON et.topic_id = t.id
       GROUP BY t.id ORDER BY count DESC, t.name`
    )
    .all() as { name: string; count: number }[];
}

export function listUsedTypes(): { email_type: string; count: number }[] {
  return getDb()
    .prepare(
      `SELECT email_type, COUNT(*) AS count FROM emails
       WHERE email_type IS NOT NULL GROUP BY email_type ORDER BY count DESC`
    )
    .all() as { email_type: string; count: number }[];
}

export function stats(): {
  emails: number;
  sources: number;
  uncategorized: number;
} {
  const db = getDb();
  return {
    emails: (db.prepare("SELECT COUNT(*) n FROM emails").get() as { n: number }).n,
    sources: (db.prepare("SELECT COUNT(*) n FROM sources").get() as { n: number }).n,
    uncategorized: (
      db
        .prepare("SELECT COUNT(*) n FROM emails WHERE categorized_at IS NULL")
        .get() as { n: number }
    ).n,
  };
}
