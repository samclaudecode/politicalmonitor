// On-demand fact-checking pipeline:
//   Stage 0  claim triage (cheap model) — early exit when nothing checkable
//   Stage 1  one verification call: a single cheap model (DeepSeek by
//            default) with OpenRouter's web-search plugin explicitly attached
//   Stage 2  grounding-doc retrieval (local Postgres FTS)
// Results are cached per item in fact_checks; nothing runs automatically.
// Cost: one model pass + a handful of web results, far cheaper than a
// multi-model panel. Tune with FACT_CHECK_MODEL / FACT_CHECK_WEB_RESULTS.
import {
  getEmail,
  retrieveChunks,
  upsertFactCheck,
  factChecksLastDay,
  type FactCheckRow,
} from "./db";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_CLAIM_MODEL = "deepseek/deepseek-chat-v3-0324";
// Verification model — a single cheap (Chinese) model; the web plugin does
// the searching, so the model itself need not be a big Western one.
const DEFAULT_VERIFY_MODEL = "deepseek/deepseek-chat-v3-0324";

function webResults(): number {
  const n = parseInt(process.env.FACT_CHECK_WEB_RESULTS || "", 10);
  return Number.isNaN(n) ? 5 : Math.max(1, Math.min(10, n));
}

export const VERDICTS = [
  "accurate",
  "mostly-true",
  "misleading",
  "unsupported",
  "false",
] as const;
export type Verdict = (typeof VERDICTS)[number];

const VERDICT_WEIGHT: Record<Verdict, number> = {
  accurate: 0,
  "mostly-true": 20,
  misleading: 65,
  unsupported: 75,
  false: 100,
};

export interface CheckedClaim {
  claim: string;
  verdict: Verdict;
  confidence: number; // 0-100
  evidence_quote: string;
  evidence_url: string;
  source: string;
  rationale: string;
  contested: boolean;
}

export interface DocExcerpt {
  document: string;
  excerpt: string;
}

export interface FactCheckResult {
  status: "checked" | "no_claims";
  claims: CheckedClaim[];
  docContext: DocExcerpt[];
  bsScore: number | null;
  contested: boolean;
  notes: string | null;
  model: string | null;
  tokensUsed: number | null;
  costUsd: number | null;
}

interface OpenRouterUsage {
  total_tokens?: number;
  cost?: number;
}

async function callOpenRouter(
  model: string,
  system: string,
  user: string,
  temperature: number,
  opts?: { web?: boolean }
): Promise<{ content: string; usage: OpenRouterUsage; citations: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const body: Record<string, unknown> = {
    model,
    temperature,
    usage: { include: true },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (opts?.web) {
    // OpenRouter web plugin (Exa-powered): runs a live search and injects the
    // results into the model's context. This is what actually gives the model
    // web access — relying on the ":online" suffix or a model's built-in
    // search proved unreliable.
    body.plugins = [{ id: "web", max_results: webResults() }];
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/samclaudecode/politicalmonitor",
      "X-Title": "PoliticalMonitor Fact Check",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status} (${model}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: {
      message?: {
        content?: string;
        annotations?: { type?: string }[];
      };
    }[];
    usage?: OpenRouterUsage;
  };
  const message = data.choices?.[0]?.message;
  const content = message?.content?.trim();
  if (!content) throw new Error(`OpenRouter returned no content (${model})`);
  const citations = (message?.annotations ?? []).filter(
    (a) => a.type === "url_citation"
  ).length;
  return { content, usage: data.usage ?? {}, citations };
}

function extractJson<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = Math.min(
    ...[cleaned.indexOf("{"), cleaned.indexOf("[")].filter((i) => i !== -1)
  );
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (!Number.isFinite(start) || end === -1) {
    throw new Error("Model response contained no JSON");
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

// ---------- Stage 0: claim triage ----------

const TRIAGE_PROMPT = `You extract checkable factual claims from UK political messages for fact-checking.
A checkable claim asserts something specific and verifiable (statistics, costs, counts, events, votes, quotes). Opinions, predictions, values statements and pure rhetoric are NOT checkable.
Respond with ONLY a JSON object: {"claims": ["...", "..."]} — at most 3 claims, most significant first, each rephrased as a standalone testable statement. If nothing is checkable, return {"claims": []}.`;

export async function extractClaims(
  text: string
): Promise<{ claims: string[]; usage: OpenRouterUsage }> {
  const model = process.env.OPENROUTER_MODEL || DEFAULT_CLAIM_MODEL;
  const { content, usage } = await callOpenRouter(
    model,
    TRIAGE_PROMPT,
    text.slice(0, 3000),
    0.1
  );
  const parsed = extractJson<{ claims?: unknown }>(content);
  const claims = Array.isArray(parsed.claims)
    ? parsed.claims.filter((c): c is string => typeof c === "string").slice(0, 3)
    : [];
  return { claims, usage };
}

// ---------- Stage 1: web-grounded verification ----------

const VERIFY_PROMPT = `You are a rigorous fact-checker verifying claims made by UK politicians. Live web search results have been injected into this conversation for you to use — do NOT say you lack web access or tools; use the results provided. Prioritise reliable sources: gov.uk, ons.gov.uk, parliament.uk, obr.uk, fullfact.org, BBC, Reuters, FT. Ignore partisan blogs and social media.
For EACH claim respond with a verdict from exactly: "accurate", "mostly-true", "misleading", "unsupported", "false".
Respond with ONLY a JSON object (no prose, no commentary):
{"claims": [{"claim": "...", "verdict": "...", "confidence": 0-100, "evidence_quote": "short quote from the best source", "evidence_url": "https://...", "source": "publisher name", "rationale": "one sentence", "contested": true/false}], "notes": "one sentence on any disagreement between sources, or null"}
Set "contested" true when reliable sources disagree or evidence is thin. Base evidence_quote and evidence_url ONLY on the provided search results — never invent quotes or URLs. If the results do not cover a claim, use verdict "unsupported" with empty evidence fields (do not editorialise about missing tools).`;

function normalizeClaims(raw: unknown): CheckedClaim[] {
  if (!Array.isArray(raw)) return [];
  const out: CheckedClaim[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const verdict = (VERDICTS as readonly string[]).includes(String(o.verdict))
      ? (String(o.verdict) as Verdict)
      : "unsupported";
    const confidence = Math.max(0, Math.min(100, Number(o.confidence) || 0));
    out.push({
      claim: String(o.claim || "").slice(0, 500),
      verdict,
      confidence,
      evidence_quote: String(o.evidence_quote || "").slice(0, 500),
      evidence_url: /^https?:\/\//.test(String(o.evidence_url || ""))
        ? String(o.evidence_url)
        : "",
      source: String(o.source || "").slice(0, 100),
      rationale: String(o.rationale || "").slice(0, 400),
      contested: o.contested === true,
    });
  }
  return out.slice(0, 3);
}

const STRUCTURE_PROMPT = `You convert a fact-check analysis into strict JSON. Using ONLY information present in the analysis (never invent facts, quotes or URLs), respond with ONLY this JSON shape:
{"claims": [{"claim": "...", "verdict": "accurate|mostly-true|misleading|unsupported|false", "confidence": 0-100, "evidence_quote": "...", "evidence_url": "https://... or empty", "source": "...", "rationale": "...", "contested": true/false}], "notes": "... or null"}
If the analysis gives no verdict for a claim, use "unsupported" with empty evidence fields.`;

async function verifyClaims(
  claims: string[],
  itemContext: string
): Promise<{
  claims: CheckedClaim[];
  notes: string | null;
  model: string;
  usage: OpenRouterUsage;
}> {
  const user = [
    `Context — the message being checked:\n"""${itemContext.slice(0, 1200)}"""`,
    "",
    "Claims to verify:",
    ...claims.map((c, i) => `${i + 1}. ${c}`),
  ].join("\n");

  const primary = process.env.FACT_CHECK_MODEL || DEFAULT_VERIFY_MODEL;
  const fallback = process.env.FACT_CHECK_FALLBACK_MODEL || "";
  let content: string, usage: OpenRouterUsage, citations: number, model = primary;
  let totalTokens = 0;
  let totalCost = 0;
  try {
    ({ content, usage, citations } = await callOpenRouter(
      primary,
      VERIFY_PROMPT,
      user,
      0.2,
      { web: true }
    ));
  } catch (err) {
    if (!fallback || fallback === primary) throw err;
    console.error(`fact-check: ${primary} failed, trying ${fallback}:`, err);
    model = fallback;
    ({ content, usage, citations } = await callOpenRouter(
      fallback,
      VERIFY_PROMPT,
      user,
      0.2,
      { web: true }
    ));
  }
  totalTokens += usage.total_tokens ?? 0;
  totalCost += usage.cost ?? 0;

  // Some models occasionally answer in prose despite instructions. Structure
  // the analysis with a cheap second pass (no web) rather than failing.
  let parsed: { claims?: unknown; notes?: unknown };
  try {
    parsed = extractJson<{ claims?: unknown; notes?: unknown }>(content);
  } catch {
    console.warn("fact-check: verifier returned prose, running structuring pass");
    const structurer = process.env.OPENROUTER_MODEL || DEFAULT_CLAIM_MODEL;
    const structured = await callOpenRouter(
      structurer,
      STRUCTURE_PROMPT,
      `Claims being checked:\n${claims.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nAnalysis:\n"""${content.slice(0, 12000)}"""`,
      0.1
    );
    totalTokens += structured.usage.total_tokens ?? 0;
    totalCost += structured.usage.cost ?? 0;
    parsed = extractJson<{ claims?: unknown; notes?: unknown }>(structured.content);
    model = `${model} (structured)`;
  }

  // Surface when the web search returned nothing usable, so a wall of
  // "unsupported" verdicts is understood as thin sourcing, not falsity.
  let notes = typeof parsed.notes === "string" ? parsed.notes.slice(0, 500) : null;
  if (citations === 0) {
    notes = `Web search returned no usable sources for these claims${notes ? ` — ${notes}` : "."}`;
  }

  return {
    claims: normalizeClaims(parsed.claims),
    notes,
    model: `${model} · web×${webResults()}${citations ? ` (${citations} sources)` : ""}`,
    usage: { total_tokens: totalTokens, cost: totalCost },
  };
}

// ---------- Scoring ----------

/** 0 = fully grounded, 100 = total bull. Confidence-weighted verdict average. */
export function computeBsScore(claims: CheckedClaim[]): number | null {
  if (claims.length === 0) return null;
  let weighted = 0;
  let totalWeight = 0;
  for (const c of claims) {
    // Low-confidence verdicts count for less; floor keeps them from vanishing.
    const w = Math.max(0.25, c.confidence / 100);
    weighted += VERDICT_WEIGHT[c.verdict] * w;
    totalWeight += w;
  }
  return Math.round(weighted / totalWeight);
}

// ---------- Orchestration ----------

export function factCheckDailyCap(): number | null {
  const raw = process.env.FACT_CHECK_DAILY_CAP;
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/** Mark a check as running so the UI can show progress across refreshes. */
export async function markFactCheckPending(emailId: number): Promise<void> {
  await upsertFactCheck({
    email_id: emailId,
    status: "pending",
    claims: null,
    doc_context: null,
    bs_score: null,
    contested: false,
    notes: null,
    model: null,
    tokens_used: null,
    cost_usd: null,
  });
}

export async function markFactCheckError(
  emailId: number,
  message: string
): Promise<void> {
  await upsertFactCheck({
    email_id: emailId,
    status: "error",
    claims: null,
    doc_context: null,
    bs_score: null,
    contested: false,
    notes: message.slice(0, 400),
    model: null,
    tokens_used: null,
    cost_usd: null,
  });
}

/** Minutes since a row was created — used to spot stalled pending checks. */
export function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export async function runFactCheck(emailId: number): Promise<FactCheckResult> {
  const cap = factCheckDailyCap();
  if (cap !== null && (await factChecksLastDay()) >= cap) {
    throw new Error(
      `Daily fact-check cap (${cap}) reached — raise FACT_CHECK_DAILY_CAP or try tomorrow.`
    );
  }

  const item = await getEmail(emailId);
  if (!item) throw new Error("Item not found");
  const text = item.text_body || item.subject || "";

  // Stage 0 — triage
  const triage = await extractClaims(text);
  let tokens = triage.usage.total_tokens ?? 0;
  let cost = triage.usage.cost ?? 0;

  if (triage.claims.length === 0) {
    const result: FactCheckResult = {
      status: "no_claims",
      claims: [],
      docContext: [],
      bsScore: null,
      contested: false,
      notes: "No checkable factual claims — opinion, rhetoric or personal content.",
      model: process.env.OPENROUTER_MODEL || DEFAULT_CLAIM_MODEL,
      tokensUsed: tokens || null,
      costUsd: cost || null,
    };
    await persist(emailId, result);
    return result;
  }

  // Stage 1 — Fusion (or fallback) verification with web search
  const verified = await verifyClaims(triage.claims, text);
  tokens += verified.usage.total_tokens ?? 0;
  cost += verified.usage.cost ?? 0;

  // Stage 2 — what our own grounding documents say (local, free)
  const chunks = await retrieveChunks(triage.claims.join(" "), 3);
  const docContext: DocExcerpt[] = chunks
    .filter((c) => c.rank > 0)
    .map((c) => ({
      document: c.document_title,
      excerpt: c.content.slice(0, 400),
    }));

  const bsScore = computeBsScore(verified.claims);
  const contested = verified.claims.some((c) => c.contested);

  const result: FactCheckResult = {
    status: "checked",
    claims: verified.claims,
    docContext,
    bsScore,
    contested,
    notes: verified.notes,
    model: verified.model,
    tokensUsed: tokens || null,
    costUsd: cost || null,
  };
  await persist(emailId, result);
  return result;
}

async function persist(emailId: number, r: FactCheckResult): Promise<void> {
  await upsertFactCheck({
    email_id: emailId,
    status: r.status,
    claims: r.claims.length ? JSON.stringify(r.claims) : null,
    doc_context: r.docContext.length ? JSON.stringify(r.docContext) : null,
    bs_score: r.bsScore,
    contested: r.contested,
    notes: r.notes,
    model: r.model,
    tokens_used: r.tokensUsed,
    cost_usd: r.costUsd,
  });
}

// ---------- Parsing helpers for the UI ----------

export function parseClaims(row: FactCheckRow): CheckedClaim[] {
  if (!row.claims) return [];
  try {
    return normalizeClaims(JSON.parse(row.claims));
  } catch {
    return [];
  }
}

export function parseDocContext(row: FactCheckRow): DocExcerpt[] {
  if (!row.doc_context) return [];
  try {
    const parsed = JSON.parse(row.doc_context);
    return Array.isArray(parsed) ? (parsed as DocExcerpt[]) : [];
  } catch {
    return [];
  }
}

export function bsLabel(score: number): string {
  if (score <= 20) return "Grounded";
  if (score <= 45) return "Stretched";
  if (score <= 70) return "Spin";
  return "Total Bull";
}
