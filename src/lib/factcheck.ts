// On-demand fact-checking pipeline:
//   Stage 0  claim triage (cheap model) — early exit when nothing checkable
//   Stage 1  one OpenRouter Fusion call (panel + web search + judge)
//   Stage 2  grounding-doc retrieval (local Postgres FTS)
// Results are cached per item in fact_checks; nothing runs automatically.
import {
  getEmail,
  retrieveChunks,
  upsertFactCheck,
  factChecksLastDay,
  type FactCheckRow,
} from "./db";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_CLAIM_MODEL = "deepseek/deepseek-chat-v3-0324";
const DEFAULT_FUSION_MODEL = "openrouter/fusion";
// Fallback when Fusion is unavailable: same cheap model with web search.
const FALLBACK_WEB_MODEL = "deepseek/deepseek-chat-v3-0324:online";

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
  temperature: number
): Promise<{ content: string; usage: OpenRouterUsage }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/samclaudecode/politicalmonitor",
      "X-Title": "PoliticalMonitor Fact Check",
    },
    body: JSON.stringify({
      model,
      temperature,
      usage: { include: true },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(280_000), // Fusion panels can take a while
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status} (${model}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: OpenRouterUsage;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error(`OpenRouter returned no content (${model})`);
  return { content, usage: data.usage ?? {} };
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

// ---------- Stage 1: Fusion verification ----------

const VERIFY_PROMPT = `You are a rigorous fact-checker verifying claims made by UK politicians. Search the web for evidence, prioritising reliable sources: gov.uk, ons.gov.uk, parliament.uk, obr.uk, fullfact.org, BBC, Reuters, FT. Ignore partisan blogs and social media.
For EACH claim respond with a verdict from exactly: "accurate", "mostly-true", "misleading", "unsupported", "false".
Respond with ONLY a JSON object:
{"claims": [{"claim": "...", "verdict": "...", "confidence": 0-100, "evidence_quote": "short quote from the best source", "evidence_url": "https://...", "source": "publisher name", "rationale": "one sentence", "contested": true/false}], "notes": "one sentence on any disagreement between sources, or null"}
Set "contested" true when reliable sources disagree or evidence is thin. Never invent quotes or URLs — if you cannot find evidence, use verdict "unsupported" with empty evidence fields.`;

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

  const fusionModel = process.env.FACT_CHECK_MODEL || DEFAULT_FUSION_MODEL;
  let content: string, usage: OpenRouterUsage, model = fusionModel;
  try {
    ({ content, usage } = await callOpenRouter(fusionModel, VERIFY_PROMPT, user, 0.2));
  } catch (err) {
    // Fusion unavailable → degrade to a single web-search-enabled model.
    console.error(`fact-check: ${fusionModel} failed, falling back:`, err);
    model = FALLBACK_WEB_MODEL;
    ({ content, usage } = await callOpenRouter(FALLBACK_WEB_MODEL, VERIFY_PROMPT, user, 0.2));
  }
  const parsed = extractJson<{ claims?: unknown; notes?: unknown }>(content);
  return {
    claims: normalizeClaims(parsed.claims),
    notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 500) : null,
    model,
    usage,
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
