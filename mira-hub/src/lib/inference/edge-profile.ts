/**
 * #5265 — the EDGE profile (`MIRA_PROFILE=edge`): the same Hub, sealed on one
 * device. The notebook chat answers from a single local OpenAI-compatible
 * server (llama.cpp `llama-server`, Ollama) on loopback instead of the cloud
 * cascade, and the process refuses to start while any cloud provider key is
 * present — a sealed tablet must not be one env var away from sending a
 * technician's question off the device.
 *
 * Field evidence for the defaults: factorylm PR #237,
 * docs/air-force-rfi/w0-tablet-spike.md (Galaxy Tab S9 FE, 2026-11-07).
 */
import type { CanonicalProvider } from "./canonical-cascade";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import { relevantQuoteWindow } from "@/lib/quote-window";

/** Every cloud provider key a Hub lane reads. Present + non-empty = not sealed. */
const CLOUD_PROVIDER_KEYS = [
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHERAI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

const DEFAULT_EDGE_LLM_URL = "http://127.0.0.1:8080/v1/chat/completions";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * On-device generation is slower than a hosted API: a 1.5B model on the
 * tablet's CPU reads ~60 tok/s, so a full retrieval prompt can take tens of
 * seconds. The cloud cascade's 30 s per-attempt timeout would cut it off.
 */
export const EDGE_ATTEMPT_TIMEOUT_MS = 180_000;

export function edgeProfileEnabled(): boolean {
  return process.env.MIRA_PROFILE === "edge";
}

function edgeLlmUrl(): string {
  return process.env.MIRA_EDGE_LLM_URL || DEFAULT_EDGE_LLM_URL;
}

/**
 * The single provider the notebook chat dispatches under the edge profile.
 * `key` is a placeholder: the dispatch loop skips keyless providers, and a
 * local server ignores the bearer header.
 */
export function edgeProviders(): CanonicalProvider[] {
  return [{ name: "Local", url: edgeLlmUrl(), key: "local", model: process.env.MIRA_EDGE_LLM_MODEL || "local" }];
}

/** Sampling pinned so the same question, corpus and model give a repeatable answer. */
export function edgeRequestOverrides(): { temperature: number; seed: number } {
  return { temperature: 0, seed: 0 };
}

/**
 * Throws when the edge profile is on but the process is not sealed: a cloud
 * provider key is set, or the local model URL is not loopback. Names the
 * offending variable, never its value. A no-op when the profile is off.
 */
export function assertEdgeSealed(): void {
  if (!edgeProfileEnabled()) return;
  const present = CLOUD_PROVIDER_KEYS.filter((k) => Boolean(process.env[k]));
  if (present.length > 0) {
    throw new Error(`MIRA_PROFILE=edge refuses to start: cloud provider key(s) set: ${present.join(", ")}`);
  }
  let host: string;
  try {
    host = new URL(edgeLlmUrl()).hostname;
  } catch {
    throw new Error("MIRA_PROFILE=edge refuses to start: MIRA_EDGE_LLM_URL is not a valid URL");
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`MIRA_PROFILE=edge refuses to start: MIRA_EDGE_LLM_URL must be loopback, got host ${host}`);
  }
}

/**
 * "AI finds, manual speaks." On the tablet the notebook answer IS the matching
 * manual passages, word for word with page — no model-written text. Measured
 * 2026-11-07 (w0-tablet-spike.md): the full grounded prompt (3,438 tokens) took
 * 53 s on the 1.5B model and came back with no [n] markers, so every answer was
 * labelled ungrounded; on a short prompt it still wrote no markers and got the
 * how-to wrong. Retrieval already ran in Postgres, so the passages cost nothing.
 */
export const EDGE_PASSAGE_LIMIT = 3;
export const EDGE_PASSAGE_CHARS = 600;
export const EDGE_PASSAGES_LEAD = "Matching passages from this notebook's manuals, word for word. Open the page and read it in full before acting.";
export const EDGE_NO_PASSAGE_TEXT =
  "No passage in this notebook's manuals matches that question. Try the manual's own wording, or refer it to a qualified person.";
export const EDGE_PASSAGES_LABEL = "Passages from this notebook's sources, shown word for word — no AI summary.";

export type EdgePassage = { citation: EvidenceCitation; text: string };

/** Table-of-contents / index chunk: dotted leader lines, a list of page numbers, no instruction. */
export function isNavigationChunk(text: string): boolean {
  return (text.match(/\.{6,}/g) ?? []).length >= 3;
}

/**
 * Pair each retrieved chunk with the citation buildCitations gave it (same
 * per-page dedupe key, same order), drop navigation chunks, keep the first
 * EDGE_PASSAGE_LIMIT. The text is a verbatim window of the chunk.
 */
export function selectEdgePassages(
  chunks: { content: string; sourceUrl: string; sourcePage: number | null }[],
  citations: EvidenceCitation[],
  question: string,
): EdgePassage[] {
  const byKey = new Map<string, EvidenceCitation>();
  const order: string[] = [];
  for (const c of chunks) {
    const key = `${c.sourceUrl}::${c.sourcePage ?? ""}`;
    if (!order.includes(key)) order.push(key);
  }
  order.forEach((key, i) => {
    if (citations[i]) byKey.set(key, citations[i]);
  });
  const out: EdgePassage[] = [];
  const used = new Set<string>();
  for (const c of chunks) {
    if (out.length >= EDGE_PASSAGE_LIMIT) break;
    const citation = byKey.get(`${c.sourceUrl}::${c.sourcePage ?? ""}`);
    if (!citation || used.has(citation.citationId) || isNavigationChunk(c.content)) continue;
    used.add(citation.citationId);
    out.push({ citation, text: relevantQuoteWindow(c.content, question, EDGE_PASSAGE_CHARS) });
  }
  return out;
}

/** The answer text: a fixed lead, then each passage quoted with its [n] marker and page. */
export function renderEdgePassages(passages: EdgePassage[]): string {
  if (passages.length === 0) return EDGE_NO_PASSAGE_TEXT;
  const blocks = passages.map(({ citation, text }) => {
    const where = citation.page != null ? `${citation.sourceTitle}, page ${citation.page}` : citation.sourceTitle;
    return `"${text}" [${citation.citationId}]\n— ${where}`;
  });
  return [EDGE_PASSAGES_LEAD, ...blocks].join("\n\n");
}
