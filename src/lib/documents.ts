// Extraction and chunking for grounding documents (PDF & markdown/text).
// PDFs are parsed with unpdf (a serverless-friendly bundled pdf.js).
import { extractText, getDocumentProxy } from "unpdf";
import { insertDocument, type DocumentRow } from "./db";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // matches next.config bodySizeLimit
const CHUNK_CHARS = 1100; // ~250-300 tokens per chunk
const CHUNK_OVERLAP = 150;

export interface ExtractResult {
  text: string;
  pageCount: number | null;
  kind: "pdf" | "markdown";
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractResult> {
  const pdf = await getDocumentProxy(bytes);
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  // With mergePages the driver returns a single string; guard just in case.
  const merged = Array.isArray(text) ? (text as string[]).join("\n\n") : text;
  return {
    text: cleanText(merged),
    pageCount: totalPages ?? null,
    kind: "pdf",
  };
}

export function extractMarkdown(raw: string): ExtractResult {
  return { text: cleanText(raw), pageCount: null, kind: "markdown" };
}

/**
 * Split text into overlapping chunks on paragraph/sentence boundaries so
 * full-text retrieval returns coherent, self-contained passages.
 */
export function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    // Carry a little overlap into the next chunk for context continuity.
    current = trimmed.length > CHUNK_OVERLAP ? trimmed.slice(-CHUNK_OVERLAP) + " " : "";
  };

  for (const para of paragraphs) {
    if (para.length > CHUNK_CHARS) {
      // Break oversized paragraphs on sentence boundaries.
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (current.length + sentence.length > CHUNK_CHARS) flush();
        current += sentence + " ";
      }
      continue;
    }
    if (current.length + para.length > CHUNK_CHARS) flush();
    current += para + "\n\n";
  }
  const last = current.trim();
  if (last) chunks.push(last);
  return chunks;
}

export interface StoredDocument {
  id: number;
  title: string;
  chunkCount: number;
  pageCount: number | null;
  charCount: number;
}

/**
 * Extract, chunk and persist an uploaded file. Returns a summary; throws with
 * a user-facing message on unsupported types, empty text, or oversize input.
 */
export async function ingestDocument(
  file: File,
  titleOverride?: string
): Promise<StoredDocument> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is ${
        MAX_UPLOAD_BYTES / 1024 / 1024
      }MB. For long documents, upload a markdown/text version instead.`
    );
  }
  const name = file.name || "document";
  const lower = name.toLowerCase();
  let extracted: ExtractResult;

  if (lower.endsWith(".pdf") || file.type === "application/pdf") {
    extracted = await extractPdf(new Uint8Array(await file.arrayBuffer()));
  } else if (/\.(md|markdown|txt|text)$/.test(lower) || file.type.startsWith("text/")) {
    extracted = extractMarkdown(await file.text());
  } else {
    throw new Error(`Unsupported file type: ${name}. Upload a PDF or a .md/.txt file.`);
  }

  if (!extracted.text || extracted.text.length < 20) {
    throw new Error(
      "No extractable text found. Scanned/image-only PDFs aren't supported — upload a text-based PDF or a markdown version."
    );
  }

  const chunks = chunkText(extracted.text);
  const title = (titleOverride || name.replace(/\.[^.]+$/, "")).trim().slice(0, 200);
  const id = await insertDocument(
    {
      title,
      filename: name,
      kind: extracted.kind,
      page_count: extracted.pageCount,
      char_count: extracted.text.length,
    },
    chunks
  );
  return {
    id,
    title,
    chunkCount: chunks.length,
    pageCount: extracted.pageCount,
    charCount: extracted.text.length,
  };
}

export function documentSubtitle(doc: DocumentRow): string {
  const parts: string[] = [];
  if (doc.page_count) parts.push(`${doc.page_count} page${doc.page_count === 1 ? "" : "s"}`);
  parts.push(`${doc.chunk_count} chunk${doc.chunk_count === 1 ? "" : "s"}`);
  parts.push(`${(doc.char_count / 1000).toFixed(0)}k chars`);
  return parts.join(" · ");
}
