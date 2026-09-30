/**
 * Turn Flight Recorder content capture — what the technician typed and what
 * MIRA answered, readable on the trace. Emitted ONLY behind
 * `MIRA_OTEL_CAPTURE_CONTENT=1` (captureContentEnabled(); staging-only by
 * doctrine, design §3/§8). Without it a trace carries lengths, never text.
 *
 * Values are scrubbed with the same shapes `InferenceRouter.sanitize_context()`
 * redacts (security-boundaries.md) and still pass through tracing.ts's
 * key/secret redaction. The content keys get CONTENT_MAX_LEN instead of the
 * 512-char attribute clamp — see CONTENT_ATTRIBUTE_KEYS in tracing.ts.
 */
import type { Span } from "@opentelemetry/api";
import { captureContentEnabled } from "./config";
import { CONTENT_MAX_LEN, setSpanAttrs } from "./tracing";

export function scrubContent(text: string): string {
  return text
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[IP]")
    .replace(/\b[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}\b/g, "[MAC]")
    .replace(/\b(?:S\/N|SN|serial)[:\s]+([A-Za-z0-9]{6,})/gi, (m, tok: string) => m.slice(0, m.length - tok.length) + "[SN]")
    .slice(0, CONTENT_MAX_LEN);
}

/** Put the typed question and/or the delivered answer on `span` (the turn root). */
export function recordTurnContent(
  span: Span,
  content: { question?: string | null; answer?: string | null },
): void {
  if (!captureContentEnabled()) return;
  const attrs: Record<string, string> = {};
  if (content.question) attrs["mira.content.question"] = scrubContent(content.question);
  if (content.answer) attrs["mira.content.answer"] = scrubContent(content.answer);
  if (Object.keys(attrs).length) setSpanAttrs(attrs, span);
}
