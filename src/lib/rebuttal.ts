// Draft a grounded rebuttal to an archived tweet/email, using DeepSeek via
// OpenRouter with relevant passages retrieved from uploaded documents.
import { focusParty } from "./taxonomy";
import {
  getEmail,
  getFactCheck,
  retrieveChunks,
  insertRebuttal,
  type RetrievedChunk,
} from "./db";
import { parseClaims, type CheckedClaim } from "./factcheck";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-chat-v3-0324";

export type RebuttalTone = "measured" | "punchy" | "detailed";

const TONE_GUIDANCE: Record<RebuttalTone, string> = {
  measured:
    "Calm, factual and statesmanlike. One or two short paragraphs suitable for a press line.",
  punchy:
    "A single sharp reply of at most 280 characters, suitable to post directly on X. Confident but not abusive.",
  detailed:
    "A thorough point-by-point response of up to four short paragraphs for a briefing note.",
};

/**
 * Whom rebuttals speak FOR. The archive monitors FOCUS_PARTY politicians,
 * so the rebuttal voice must be their opposition — set REBUTTAL_PARTY to
 * name your side (e.g. "the Liberal Democrats"); the uploaded grounding
 * documents are treated as that side's own policy material.
 */
export function rebuttalParty(): string {
  return process.env.REBUTTAL_PARTY || `the opposition to ${focusParty()}`;
}

/**
 * The rebuttal doctrine: stance, rhetoric and safety rules the model must
 * follow. Kept as a function so REBUTTAL_EXTRA_INSTRUCTIONS can extend it
 * per deployment without code changes.
 */
export function rebuttalSystemPrompt(tone: RebuttalTone): string {
  const monitored = focusParty();
  const ourSide = rebuttalParty();
  const extra = process.env.REBUTTAL_EXTRA_INSTRUCTIONS?.trim();
  return `You are the rapid-response director for ${ourSide}, drafting rebuttals to public messages from ${monitored} politicians. Every draft is reviewed by a human before any use.

STANCE — non-negotiable:
- You are the opposition. Never agree with, praise, endorse or amplify the message or its framing. Your job is to counter it.
- If a claim in the message happens to be true, concede it in as few words as possible and pivot immediately to your strongest counter: the cost, the contradiction with the author's record, what the message conveniently omits, or the flaw in its logic.
- Do not repeat the message's slogans or loaded phrases, even to deny them — repetition reinforces their frame. Reframe in your own words.

EXCEPTION — when not to fight:
- If the message is personal rather than political — a bereavement, tribute, illness, congratulation or family matter — do NOT attack it. Reply with exactly: "NO REBUTTAL RECOMMENDED: " followed by one short sentence explaining why. Attacking human moments loses the public.

ARGUMENT — how to win:
- Find the weakest load-bearing element of the message and hit that one thing hard: a false or unsupported statistic, a hidden trade-off, an omission, or a contradiction with the author's own record. One clear argument beats three scattered ones.
- If the message relies on a rhetorical trick (fear appeal, false choice, scapegoating, cherry-picked number), name it in plain words a voter would use — not debate-club jargon.
- Ground every factual claim ONLY in the document excerpts (cite inline as [1], [2], …) or the verified web evidence (cite as [W1], [W2], …). Never mix the two numbering schemes. If the evidence does not support a factual attack, argue from values and priorities instead — never invent figures, quotes or endorsements.
- End with ${ourSide}'s positive alternative — a rebuttal that only says "no" is half finished.

STYLE — how it should read:
- Structure: a sharp counter-frame in the first sentence → one or two pieces of evidence → pivot to the alternative → a memorable closing line.
- Concrete over abstract: people-scale numbers ("£12 a week for your family", not "£8.4bn"), everyday words, short sentences. Rule of three and antithesis are welcome; clichés are not.
- Attack the argument and the record, never the person. No abuse, no slurs, no speculation about motives stated as fact, nothing defamatory.
- Write in British English for a busy member of the public, not a policy analyst. Output ONLY the rebuttal text, no preamble or headings.
${extra ? `\nDEPLOYMENT-SPECIFIC INSTRUCTIONS:\n${extra}\n` : ""}
Tone: ${TONE_GUIDANCE[tone]}`;
}

export interface DraftedRebuttal {
  content: string;
  citations: string;
  model: string;
  chunksUsed: number;
}

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => `[[${i + 1}]] (${c.document_title})\n${c.content}`)
    .join("\n\n");
}

export function isRebuttalConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export async function draftRebuttal(
  emailId: number,
  tone: RebuttalTone = "measured"
): Promise<DraftedRebuttal> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const item = await getEmail(emailId);
  if (!item) throw new Error("Item not found");

  const itemText = item.text_body || item.subject || "";
  const chunks = await retrieveChunks(itemText || item.subject, 6);
  const party = focusParty();

  // If this item has been fact-checked, feed the web receipts in too — the
  // rebuttal can then cite ONS/gov.uk evidence alongside the party documents.
  let webEvidence: CheckedClaim[] = [];
  try {
    const check = await getFactCheck(emailId);
    if (check && check.status === "checked") {
      webEvidence = parseClaims(check).filter((c) => c.evidence_quote);
    }
  } catch {
    // fact-check table optional — never block a rebuttal on it
  }

  const system = rebuttalSystemPrompt(tone);

  const source = item.candidate || item.sender_name || item.source_name;
  const user = [
    `A ${item.kind === "tweet" ? "tweet" : "message"} by ${source} (${party}) to rebut:`,
    `"""`,
    itemText.slice(0, 2000),
    `"""`,
    "",
    chunks.length
      ? `Excerpts from ${rebuttalParty()}'s own policy documents you may cite:\n${buildContext(chunks)}`
      : "No grounding documents are available; argue from values and priorities and do not invent facts.",
    webEvidence.length
      ? `\nFact-checked web evidence about this item (verified sources — cite as [W1], [W2], …):\n${webEvidence
          .map(
            (c, i) =>
              `[[W${i + 1}]] (${c.source || "web"}) claim "${c.claim}" was rated ${c.verdict}: "${c.evidence_quote}" ${c.evidence_url}`
          )
          .join("\n")}`
      : "",
  ].join("\n");

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/samclaudecode/politicalmonitor",
      "X-Title": "PoliticalMonitor Rebuttal Desk",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenRouter returned no content");

  const citations = JSON.stringify(
    chunks.map((c, i) => ({
      n: i + 1,
      document: c.document_title,
      ordinal: c.ordinal,
    }))
  );

  return { content, citations, model, chunksUsed: chunks.length };
}

export async function draftAndSaveRebuttal(
  emailId: number,
  tone: RebuttalTone = "measured"
): Promise<number> {
  const drafted = await draftRebuttal(emailId, tone);
  return insertRebuttal({
    email_id: emailId,
    content: drafted.content,
    citations: drafted.citations,
    model: drafted.model,
  });
}

export interface Citation {
  n: number;
  document: string;
  ordinal: number;
}

export function parseCitations(json: string | null): Citation[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as Citation[]) : [];
  } catch {
    return [];
  }
}
