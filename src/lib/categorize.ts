import { EMAIL_TYPES, POLICY_TOPICS, type EmailType } from "./taxonomy";
import {
  listUncategorizedEmails,
  saveCategorization,
  saveCategorizationError,
  type EmailRow,
} from "./db";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-chat-v3-0324";

export interface CategorizationResult {
  email_type: EmailType;
  topics: string[];
  summary: string;
  fundraising_ask: boolean;
}

const EMAIL_SYSTEM_PROMPT = `You are an analyst cataloguing emails from UK politicians and parties for a public research archive.
Given one email, respond with ONLY a JSON object (no markdown fences, no commentary) with exactly these keys:
- "email_type": one of ${JSON.stringify(EMAIL_TYPES)}
- "policy_topics": array of 0-4 strings, each EXACTLY one of ${JSON.stringify(POLICY_TOPICS)}. Only include topics the email substantively discusses; an email that is purely a donation ask with no policy content gets [].
- "summary": one or two neutral sentences describing what the email says and asks for.
- "fundraising_ask": true if the email asks for money anywhere, else false.`;

const TWEET_SYSTEM_PROMPT = `You are an analyst cataloguing tweets (X posts) by UK politicians for a public research archive.
Given one tweet, respond with ONLY a JSON object (no markdown fences, no commentary) with exactly these keys:
- "email_type": always the string "other" (ignored for tweets).
- "policy_topics": array of 0-3 strings, each EXACTLY one of ${JSON.stringify(POLICY_TOPICS)}. Only include topics the tweet substantively engages with; personal or purely rhetorical tweets with no policy content get [].
- "summary": one neutral sentence describing what the tweet says or claims.
- "fundraising_ask": true if the tweet asks for money/donations, else false.`;

export function isCategorizationConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export async function categorizeEmailContent(
  subject: string,
  senderName: string | null,
  body: string,
  kind: "email" | "tweet" = "email"
): Promise<CategorizationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const userContent =
    kind === "tweet"
      ? [`Author: ${senderName || "unknown"}`, "", body.slice(0, 2000) || subject].join("\n")
      : [
          `From: ${senderName || "unknown"}`,
          `Subject: ${subject}`,
          "",
          body.slice(0, 6000),
        ].join("\n");

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/samclaudecode/politicalmonitor",
      "X-Title": "Political Email Archive",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: kind === "tweet" ? TWEET_SYSTEM_PROMPT : EMAIL_SYSTEM_PROMPT,
        },
        { role: "user", content: userContent },
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
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("OpenRouter returned no content");

  return parseModelResponse(raw);
}

export function parseModelResponse(raw: string): CategorizationResult {
  // Models occasionally wrap JSON in code fences despite instructions.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model response contained no JSON object");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
    email_type?: string;
    policy_topics?: unknown;
    summary?: string;
    fundraising_ask?: unknown;
  };

  const emailType: EmailType = (EMAIL_TYPES as readonly string[]).includes(
    parsed.email_type ?? ""
  )
    ? (parsed.email_type as EmailType)
    : "other";

  const validTopics = new Set<string>(POLICY_TOPICS);
  const topics = Array.isArray(parsed.policy_topics)
    ? parsed.policy_topics
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => validTopics.has(t))
        .slice(0, 4)
    : [];

  return {
    email_type: emailType,
    topics,
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    fundraising_ask: parsed.fundraising_ask === true,
  };
}

export async function categorizeEmail(email: EmailRow): Promise<void> {
  const body = email.text_body || email.html_body || "";
  const isTweet = email.kind === "tweet";
  const result = await categorizeEmailContent(
    email.subject,
    email.sender_name,
    body,
    isTweet ? "tweet" : "email"
  );
  await saveCategorization(email.id, {
    ...result,
    // Tweets keep email_type NULL — the feed's "Tweet" chip comes from kind.
    email_type: isTweet ? null : result.email_type,
  });
}

export interface CategorizeBatchResult {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

/** Categorize pending emails, oldest failures retried too. */
export async function categorizePending(limit = 25): Promise<CategorizeBatchResult> {
  const result: CategorizeBatchResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };
  if (!isCategorizationConfigured()) {
    result.errors.push("OPENROUTER_API_KEY not set — skipping categorization");
    return result;
  }
  const pending = await listUncategorizedEmails(limit);
  for (const email of pending) {
    result.attempted++;
    try {
      await categorizeEmail(email);
      result.succeeded++;
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`email ${email.id}: ${message}`);
      await saveCategorizationError(email.id, message);
    }
  }
  return result;
}
