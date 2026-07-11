// Draft a grounded rebuttal to an archived tweet/email, using DeepSeek via
// OpenRouter with relevant passages retrieved from uploaded documents.
import { focusParty } from "./taxonomy";
import {
  getEmail,
  retrieveChunks,
  insertRebuttal,
  type RetrievedChunk,
} from "./db";

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

  const system = `You are a political communications adviser to ${party}. You draft rebuttals to opponents' public statements on behalf of ${party}.
Rules:
- Ground every factual claim ONLY in the provided document excerpts. Cite them inline as [1], [2], etc. matching the excerpt numbers.
- If the excerpts do not support a point, do not invent facts — argue from principle or values instead, and do not fabricate figures or quotes.
- Never use slurs or personal abuse. Attack the argument, not the person.
- Write in British English. Output ONLY the rebuttal text, no preamble or headings.
Tone: ${TONE_GUIDANCE[tone]}`;

  const source = item.candidate || item.sender_name || item.source_name;
  const user = [
    `A ${item.kind === "tweet" ? "tweet" : "message"} by ${source} to rebut:`,
    `"""`,
    itemText.slice(0, 2000),
    `"""`,
    "",
    chunks.length
      ? `Document excerpts you may cite:\n${buildContext(chunks)}`
      : "No grounding documents are available; argue from principle and do not invent facts.",
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
