import { Pool, types } from "pg";

// timestamptz → ISO string, bigint counts → number
types.setTypeParser(1184, (v: string) => new Date(v).toISOString());
types.setTypeParser(20, (v: string) => parseInt(v, 10));

// Accept the names used by the current Netlify Database (NETLIFY_DB_URL),
// the legacy Neon extension (NETLIFY_DATABASE_URL), and manual/other setups.
export const DB_URL_ENV_VARS = [
  "NETLIFY_DB_URL",
  "NETLIFY_DATABASE_URL",
  "DATABASE_URL",
  "NEON_DATABASE_URL",
  "POSTGRES_URL",
  "NETLIFY_DATABASE_URL_UNPOOLED",
] as const;

function connectionString(): string {
  for (const name of DB_URL_ENV_VARS) {
    const url = process.env[name];
    if (url) return url;
  }
  throw new Error(
    "No database configured. Set NETLIFY_DB_URL (created by Netlify Database), NETLIFY_DATABASE_URL (legacy Neon extension), or DATABASE_URL."
  );
}

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const url = connectionString();
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  pool = new Pool({
    connectionString: url,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    max: 4, // serverless-friendly: Netlify DB's pooled URL sits behind PgBouncer
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

async function db(): Promise<Pool> {
  const p = getPool();
  if (!schemaReady) {
    schemaReady = migrate(p).catch((err) => {
      schemaReady = null; // allow retry on next request
      throw err;
    });
  }
  await schemaReady;
  return p;
}

/** Close the pool — needed so CLI scripts can exit. */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    schemaReady = null;
  }
}

async function migrate(p: Pool): Promise<void> {
  await p.query(`
    CREATE TABLE IF NOT EXISTS sources (
      id SERIAL PRIMARY KEY,
      feed_url TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      candidate TEXT,
      party TEXT NOT NULL DEFAULT 'Unknown',
      office TEXT,
      state TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      last_fetched_at TIMESTAMPTZ,
      last_fetch_status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS emails (
      id SERIAL PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      guid TEXT NOT NULL,
      subject TEXT NOT NULL,
      sender_name TEXT,
      sender_email TEXT,
      received_at TIMESTAMPTZ NOT NULL,
      html_body TEXT,
      text_body TEXT,
      summary TEXT,
      email_type TEXT,
      fundraising_ask BOOLEAN,
      categorized_at TIMESTAMPTZ,
      categorization_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      search_tsv tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
        setweight(to_tsvector('english', left(coalesce(text_body, ''), 100000)), 'C')
      ) STORED,
      UNIQUE (source_id, guid)
    );

    CREATE TABLE IF NOT EXISTS topics (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS email_topics (
      email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      PRIMARY KEY (email_id, topic_id)
    );

    CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails (received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_emails_source ON emails (source_id);
    CREATE INDEX IF NOT EXISTS idx_emails_type ON emails (email_type);
    CREATE INDEX IF NOT EXISTS idx_emails_search ON emails USING GIN (search_tsv);
    CREATE INDEX IF NOT EXISTS idx_email_topics_topic ON email_topics (topic_id);
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
  active: boolean;
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
  fundraising_ask: boolean | null;
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

const EMAIL_COLUMNS = `e.id, e.source_id, e.guid, e.subject, e.sender_name, e.sender_email,
  e.received_at, e.html_body, e.text_body, e.summary, e.email_type,
  e.fundraising_ask, e.categorized_at, e.categorization_error, e.created_at`;

const TOPICS_SUBQUERY = `coalesce(
  (SELECT array_agg(t.name ORDER BY t.name)
   FROM email_topics et JOIN topics t ON t.id = et.topic_id
   WHERE et.email_id = e.id),
  '{}'
) AS topics`;

// ---------- Sources ----------

export async function listSources(): Promise<Source[]> {
  const p = await db();
  const res = await p.query("SELECT * FROM sources ORDER BY lower(name)");
  return res.rows as Source[];
}

export async function getSource(id: number): Promise<Source | undefined> {
  const p = await db();
  const res = await p.query("SELECT * FROM sources WHERE id = $1", [id]);
  return res.rows[0] as Source | undefined;
}

export async function addSource(input: {
  feed_url: string;
  name: string;
  candidate?: string;
  party?: string;
  office?: string;
  state?: string;
}): Promise<number> {
  const p = await db();
  const res = await p.query(
    `INSERT INTO sources (feed_url, name, candidate, party, office, state)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.feed_url,
      input.name,
      input.candidate || null,
      input.party || "Unknown",
      input.office || null,
      input.state || null,
    ]
  );
  return res.rows[0].id as number;
}

export async function deleteSource(id: number): Promise<void> {
  const p = await db();
  await p.query("DELETE FROM sources WHERE id = $1", [id]);
}

export async function setSourceActive(id: number, active: boolean): Promise<void> {
  const p = await db();
  await p.query("UPDATE sources SET active = $1 WHERE id = $2", [active, id]);
}

export async function recordFetch(id: number, status: string): Promise<void> {
  const p = await db();
  await p.query(
    "UPDATE sources SET last_fetched_at = now(), last_fetch_status = $1 WHERE id = $2",
    [status, id]
  );
}

// ---------- Emails ----------

export async function insertEmail(input: {
  source_id: number;
  guid: string;
  subject: string;
  sender_name?: string | null;
  sender_email?: string | null;
  received_at: string;
  html_body?: string | null;
  text_body?: string | null;
}): Promise<number | null> {
  const p = await db();
  const res = await p.query(
    `INSERT INTO emails
       (source_id, guid, subject, sender_name, sender_email, received_at, html_body, text_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source_id, guid) DO NOTHING
     RETURNING id`,
    [
      input.source_id,
      input.guid,
      input.subject,
      input.sender_name ?? null,
      input.sender_email ?? null,
      input.received_at,
      input.html_body ?? null,
      input.text_body ?? null,
    ]
  );
  return res.rows.length ? (res.rows[0].id as number) : null;
}

export async function getEmail(id: number): Promise<EmailListItem | undefined> {
  const p = await db();
  const res = await p.query(
    `SELECT ${EMAIL_COLUMNS}, s.name AS source_name, s.candidate, s.party, s.office, s.state,
            ${TOPICS_SUBQUERY}
     FROM emails e JOIN sources s ON s.id = e.source_id
     WHERE e.id = $1`,
    [id]
  );
  return res.rows[0] as EmailListItem | undefined;
}

export async function saveCategorization(
  emailId: number,
  result: {
    email_type: string;
    summary: string;
    fundraising_ask: boolean;
    topics: string[];
  }
): Promise<void> {
  const p = await db();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE emails
       SET email_type = $1, summary = $2, fundraising_ask = $3,
           categorized_at = now(), categorization_error = NULL
       WHERE id = $4`,
      [result.email_type, result.summary, result.fundraising_ask, emailId]
    );
    await client.query("DELETE FROM email_topics WHERE email_id = $1", [emailId]);
    for (const name of result.topics) {
      await client.query(
        "INSERT INTO topics (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
        [name]
      );
      await client.query(
        `INSERT INTO email_topics (email_id, topic_id)
         SELECT $1, id FROM topics WHERE name = $2
         ON CONFLICT DO NOTHING`,
        [emailId, name]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function saveCategorizationError(
  emailId: number,
  message: string
): Promise<void> {
  const p = await db();
  await p.query("UPDATE emails SET categorization_error = $1 WHERE id = $2", [
    message.slice(0, 500),
    emailId,
  ]);
}

export async function listUncategorizedEmails(limit = 50): Promise<EmailRow[]> {
  const p = await db();
  const res = await p.query(
    `SELECT ${EMAIL_COLUMNS} FROM emails e
     WHERE e.categorized_at IS NULL
     ORDER BY e.received_at DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows as EmailRow[];
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

export async function queryEmails(filters: FeedFilters): Promise<{
  items: EmailListItem[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const p = await db();
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.q) {
    // Full-text search over subject/summary/body, plus substring match on
    // subject and sender so partial names still hit.
    params.push(filters.q);
    const tsParam = `$${params.length}`;
    params.push(`%${filters.q}%`);
    const likeParam = `$${params.length}`;
    where.push(
      `(e.search_tsv @@ websearch_to_tsquery('english', ${tsParam})
        OR e.subject ILIKE ${likeParam}
        OR s.candidate ILIKE ${likeParam}
        OR s.name ILIKE ${likeParam})`
    );
  }
  if (filters.type) {
    params.push(filters.type);
    where.push(`e.email_type = $${params.length}`);
  }
  if (filters.party) {
    params.push(filters.party);
    where.push(`s.party = $${params.length}`);
  }
  if (filters.source) {
    params.push(filters.source);
    where.push(`e.source_id = $${params.length}`);
  }
  if (filters.topic) {
    params.push(filters.topic);
    where.push(
      `e.id IN (SELECT et.email_id FROM email_topics et
                JOIN topics t ON t.id = et.topic_id WHERE t.name = $${params.length})`
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = filters.sort === "oldest" ? "ASC" : "DESC";
  const pageSize = filters.pageSize ?? 25;

  const countRes = await p.query(
    `SELECT COUNT(*) AS n FROM emails e JOIN sources s ON s.id = e.source_id ${whereSql}`,
    params
  );
  const total = countRes.rows[0].n as number;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  const listRes = await p.query(
    `SELECT ${EMAIL_COLUMNS}, s.name AS source_name, s.candidate, s.party, s.office, s.state,
            ${TOPICS_SUBQUERY}
     FROM emails e JOIN sources s ON s.id = e.source_id
     ${whereSql}
     ORDER BY e.received_at ${order}, e.id ${order}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return { items: listRes.rows as EmailListItem[], total, page, pageCount };
}

export async function listUsedTopics(): Promise<{ name: string; count: number }[]> {
  const p = await db();
  const res = await p.query(
    `SELECT t.name, COUNT(*) AS count
     FROM topics t JOIN email_topics et ON et.topic_id = t.id
     GROUP BY t.id ORDER BY count DESC, t.name`
  );
  return res.rows as { name: string; count: number }[];
}

export async function listUsedTypes(): Promise<{ email_type: string; count: number }[]> {
  const p = await db();
  const res = await p.query(
    `SELECT email_type, COUNT(*) AS count FROM emails
     WHERE email_type IS NOT NULL GROUP BY email_type ORDER BY count DESC`
  );
  return res.rows as { email_type: string; count: number }[];
}

export async function stats(): Promise<{
  emails: number;
  sources: number;
  uncategorized: number;
}> {
  const p = await db();
  const res = await p.query(
    `SELECT
       (SELECT COUNT(*) FROM emails) AS emails,
       (SELECT COUNT(*) FROM sources) AS sources,
       (SELECT COUNT(*) FROM emails WHERE categorized_at IS NULL) AS uncategorized`
  );
  return res.rows[0] as { emails: number; sources: number; uncategorized: number };
}
