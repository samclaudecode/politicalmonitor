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

    ALTER TABLE sources ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'email';
    ALTER TABLE emails ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'email';
    ALTER TABLE emails ADD COLUMN IF NOT EXISTS link_url TEXT;

    -- Grounding / rebuttal documents (uploaded PDFs & markdown) and their
    -- chunks, used to ground AI-drafted rebuttals via full-text retrieval.
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      filename TEXT,
      kind TEXT NOT NULL DEFAULT 'pdf',
      page_count INTEGER,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      char_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      content TEXT NOT NULL,
      search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
    );

    -- On-demand fact-checks: one cached result per archived item.
    CREATE TABLE IF NOT EXISTS fact_checks (
      id SERIAL PRIMARY KEY,
      email_id INTEGER NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
      status TEXT NOT NULL, -- 'checked' | 'no_claims'
      claims TEXT,          -- JSON: per-claim verdicts, evidence, confidence
      doc_context TEXT,     -- JSON: grounding-doc excerpts consulted
      bs_score INTEGER,     -- 0 (grounded) .. 100 (total bull)
      contested BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT,
      model TEXT,
      tokens_used INTEGER,
      cost_usd DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- AI-drafted rebuttals attached to an archived item (tweet or email).
    CREATE TABLE IF NOT EXISTS rebuttals (
      id SERIAL PRIMARY KEY,
      email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      citations TEXT,
      model TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks (document_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_search ON document_chunks USING GIN (search_tsv);
    CREATE INDEX IF NOT EXISTS idx_rebuttals_email ON rebuttals (email_id);
    CREATE INDEX IF NOT EXISTS idx_emails_kind ON emails (kind);
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
  kind: string; // 'email' | 'twitter'
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
  kind: string; // 'email' | 'tweet'
  link_url: string | null;
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

const EMAIL_COLUMNS = `e.id, e.source_id, e.guid, e.kind, e.link_url, e.subject, e.sender_name, e.sender_email,
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
  kind?: string;
  candidate?: string;
  party?: string;
  office?: string;
  state?: string;
}): Promise<number> {
  const p = await db();
  const res = await p.query(
    `INSERT INTO sources (feed_url, kind, name, candidate, party, office, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.feed_url,
      input.kind === "twitter" ? "twitter" : "email",
      input.name,
      input.candidate || null,
      input.party || "Unknown",
      input.office || null,
      input.state || null,
    ]
  );
  return res.rows[0].id as number;
}

export async function updateSource(
  id: number,
  input: {
    name: string;
    feed_url: string;
    kind: string;
    candidate?: string;
    party?: string;
    office?: string;
    state?: string;
  }
): Promise<void> {
  const p = await db();
  await p.query(
    `UPDATE sources
     SET name = $1, feed_url = $2, kind = $3, candidate = $4, party = $5, office = $6, state = $7
     WHERE id = $8`,
    [
      input.name,
      input.feed_url,
      input.kind === "twitter" ? "twitter" : "email",
      input.candidate || null,
      input.party || "Unknown",
      input.office || null,
      input.state || null,
      id,
    ]
  );
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
  kind?: string;
  link_url?: string | null;
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
       (source_id, guid, kind, link_url, subject, sender_name, sender_email, received_at, html_body, text_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (source_id, guid) DO NOTHING
     RETURNING id`,
    [
      input.source_id,
      input.guid,
      input.kind === "tweet" ? "tweet" : "email",
      input.link_url ?? null,
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
    email_type: string | null; // null for tweets — the type chip comes from kind
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

export async function deleteEmail(id: number): Promise<boolean> {
  const p = await db();
  const res = await p.query("DELETE FROM emails WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
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
  kind?: string;
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
  if (filters.kind) {
    params.push(filters.kind);
    where.push(`e.kind = $${params.length}`);
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
  tweets: number;
  sources: number;
  documents: number;
  rebuttals: number;
  uncategorized: number;
}> {
  const p = await db();
  const res = await p.query(
    `SELECT
       (SELECT COUNT(*) FROM emails WHERE kind = 'email') AS emails,
       (SELECT COUNT(*) FROM emails WHERE kind = 'tweet') AS tweets,
       (SELECT COUNT(*) FROM sources) AS sources,
       (SELECT COUNT(*) FROM documents) AS documents,
       (SELECT COUNT(*) FROM rebuttals) AS rebuttals,
       (SELECT COUNT(*) FROM emails WHERE categorized_at IS NULL) AS uncategorized`
  );
  return res.rows[0] as {
    emails: number;
    tweets: number;
    sources: number;
    documents: number;
    rebuttals: number;
    uncategorized: number;
  };
}

// ---------- Documents & chunks ----------

export interface DocumentRow {
  id: number;
  title: string;
  filename: string | null;
  kind: string;
  page_count: number | null;
  chunk_count: number;
  char_count: number;
  created_at: string;
}

export async function listDocuments(): Promise<DocumentRow[]> {
  const p = await db();
  const res = await p.query("SELECT * FROM documents ORDER BY created_at DESC");
  return res.rows as DocumentRow[];
}

export async function insertDocument(
  doc: {
    title: string;
    filename: string | null;
    kind: string;
    page_count: number | null;
    char_count: number;
  },
  chunks: string[]
): Promise<number> {
  const p = await db();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `INSERT INTO documents (title, filename, kind, page_count, chunk_count, char_count)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [doc.title, doc.filename, doc.kind, doc.page_count, chunks.length, doc.char_count]
    );
    const id = res.rows[0].id as number;
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        "INSERT INTO document_chunks (document_id, ordinal, content) VALUES ($1, $2, $3)",
        [id, i, chunks[i]]
      );
    }
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteDocument(id: number): Promise<void> {
  const p = await db();
  await p.query("DELETE FROM documents WHERE id = $1", [id]);
}

export interface RetrievedChunk {
  document_id: number;
  document_title: string;
  ordinal: number;
  content: string;
  rank: number;
}

/**
 * Retrieve the document chunks most relevant to `queryText` via Postgres
 * full-text ranking. Falls back to the earliest chunks (e.g. a manifesto's
 * opening) when the query shares no terms with any document.
 */
export async function retrieveChunks(
  queryText: string,
  limit = 6
): Promise<RetrievedChunk[]> {
  const p = await db();
  const res = await p.query(
    `SELECT c.document_id, d.title AS document_title, c.ordinal, c.content,
            ts_rank(c.search_tsv, websearch_to_tsquery('english', $1)) AS rank
     FROM document_chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.search_tsv @@ websearch_to_tsquery('english', $1)
     ORDER BY rank DESC
     LIMIT $2`,
    [queryText, limit]
  );
  if (res.rows.length > 0) return res.rows as RetrievedChunk[];

  const fallback = await p.query(
    `SELECT c.document_id, d.title AS document_title, c.ordinal, c.content, 0 AS rank
     FROM document_chunks c JOIN documents d ON d.id = c.document_id
     ORDER BY c.document_id, c.ordinal
     LIMIT $1`,
    [limit]
  );
  return fallback.rows as RetrievedChunk[];
}

export async function hasDocuments(): Promise<boolean> {
  const p = await db();
  const res = await p.query("SELECT EXISTS (SELECT 1 FROM documents) AS e");
  return res.rows[0].e as boolean;
}

// ---------- Fact checks ----------

export interface FactCheckRow {
  id: number;
  email_id: number;
  status: string; // 'checked' | 'no_claims'
  claims: string | null;
  doc_context: string | null;
  bs_score: number | null;
  contested: boolean;
  notes: string | null;
  model: string | null;
  tokens_used: number | null;
  cost_usd: number | null;
  created_at: string;
}

export async function getFactCheck(emailId: number): Promise<FactCheckRow | undefined> {
  const p = await db();
  const res = await p.query("SELECT * FROM fact_checks WHERE email_id = $1", [emailId]);
  return res.rows[0] as FactCheckRow | undefined;
}

export async function upsertFactCheck(input: {
  email_id: number;
  status: string;
  claims: string | null;
  doc_context: string | null;
  bs_score: number | null;
  contested: boolean;
  notes: string | null;
  model: string | null;
  tokens_used: number | null;
  cost_usd: number | null;
}): Promise<void> {
  const p = await db();
  await p.query(
    `INSERT INTO fact_checks
       (email_id, status, claims, doc_context, bs_score, contested, notes, model, tokens_used, cost_usd, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (email_id) DO UPDATE SET
       status = EXCLUDED.status, claims = EXCLUDED.claims,
       doc_context = EXCLUDED.doc_context, bs_score = EXCLUDED.bs_score,
       contested = EXCLUDED.contested, notes = EXCLUDED.notes,
       model = EXCLUDED.model, tokens_used = EXCLUDED.tokens_used,
       cost_usd = EXCLUDED.cost_usd, created_at = now()`,
    [
      input.email_id,
      input.status,
      input.claims,
      input.doc_context,
      input.bs_score,
      input.contested,
      input.notes,
      input.model,
      input.tokens_used,
      input.cost_usd,
    ]
  );
}

export async function deleteFactCheck(emailId: number): Promise<void> {
  const p = await db();
  await p.query("DELETE FROM fact_checks WHERE email_id = $1", [emailId]);
}

/** BS-score summaries for feed badges (admin view). */
export async function factCheckSummaries(
  emailIds: number[]
): Promise<Map<number, { bs_score: number | null; status: string; contested: boolean }>> {
  const map = new Map<number, { bs_score: number | null; status: string; contested: boolean }>();
  if (emailIds.length === 0) return map;
  const p = await db();
  const res = await p.query(
    "SELECT email_id, bs_score, status, contested FROM fact_checks WHERE email_id = ANY($1)",
    [emailIds]
  );
  for (const r of res.rows as { email_id: number; bs_score: number | null; status: string; contested: boolean }[]) {
    map.set(r.email_id, { bs_score: r.bs_score, status: r.status, contested: r.contested });
  }
  return map;
}

/** Checks created in the last 24h — for the optional daily budget cap. */
export async function factChecksLastDay(): Promise<number> {
  const p = await db();
  const res = await p.query(
    "SELECT COUNT(*) AS n FROM fact_checks WHERE created_at > now() - interval '1 day'"
  );
  return res.rows[0].n as number;
}

// ---------- Rebuttals ----------

export interface RebuttalRow {
  id: number;
  email_id: number;
  content: string;
  citations: string | null;
  model: string | null;
  created_at: string;
}

export async function insertRebuttal(input: {
  email_id: number;
  content: string;
  citations: string | null;
  model: string | null;
}): Promise<number> {
  const p = await db();
  const res = await p.query(
    `INSERT INTO rebuttals (email_id, content, citations, model)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.email_id, input.content, input.citations, input.model]
  );
  return res.rows[0].id as number;
}

export async function listRebuttals(emailId: number): Promise<RebuttalRow[]> {
  const p = await db();
  const res = await p.query(
    "SELECT * FROM rebuttals WHERE email_id = $1 ORDER BY created_at DESC",
    [emailId]
  );
  return res.rows as RebuttalRow[];
}

export async function deleteRebuttal(id: number): Promise<void> {
  const p = await db();
  await p.query("DELETE FROM rebuttals WHERE id = $1", [id]);
}

export async function rebuttalCounts(
  emailIds: number[]
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (emailIds.length === 0) return map;
  const p = await db();
  const res = await p.query(
    `SELECT email_id, COUNT(*)::int AS n FROM rebuttals
     WHERE email_id = ANY($1) GROUP BY email_id`,
    [emailIds]
  );
  for (const r of res.rows as { email_id: number; n: number }[]) {
    map.set(r.email_id, r.n);
  }
  return map;
}
