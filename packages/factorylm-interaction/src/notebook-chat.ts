/**
 * The client for the ONE shared MIRA chat route.
 *
 * `POST /api/equipment-notebooks/{id}/chat` is the route both existing products
 * already use (issue #3806: "citations, evidence and the approved-retrieval gate
 * live behind it. This is a presentation convergence and must not touch it").
 * The public demo asks its questions here or it does not ask them at all.
 *
 * There is no fallback answerer in this file, and that is deliberate. A demo
 * that quietly substitutes a canned diagnosis when the real path is unreachable
 * is not a demo of this product — it is a demo of a different, imaginary one,
 * and the visitor cannot tell which they were shown. So every failure resolves
 * to `{ ok: false, reason }` with the reason stated on screen.
 *
 * ## What the route requires, which the public demo does not yet have
 *
 * The route begins with `sessionOr401` and scopes retrieval to
 * `(tenant ∧ notebook ∧ not-rejected)`. An anonymous visitor has no session and
 * no tenant, so **the real chat path cannot serve an anonymous turn**.
 *
 * **That is settled, not pending** (owner decision, 2026-09-15): the public demo
 * does NOT get anonymous chat. The visitor sees the machine, injects the jam,
 * watches it fault — and asking is what a workspace unlocks. So a declined turn
 * resolves to `gate: "account"` and the host renders the door. A demo account or
 * a public rate-limited route is reconsidered only once the demo is live on the
 * marketing site and visitors are measurably reaching the ask.
 *
 * The client itself is unchanged by that decision: it posts to the real route
 * with whatever credentials the host has, and reports honestly when there are
 * none. It has no opinion about sign-up, and no fallback answerer.
 *
 * ## Frame order, from the route's own contract
 *
 *   answered : content* → sources → evidence → [usage] → status → [followups]
 *   abstain  : sources (empty) → status
 *   safety   : sources (empty) → content* → safety → status
 *
 * `sources` arrives AFTER the content, because citations are filtered to the
 * `[n]` the answer actually used and that is unknowable before the model
 * finishes. So content is buffered and citations attach when `sources` lands —
 * the same rule `mira-hub/src/lib/notebook-chat-types.ts` states for every
 * client.
 */

import type {
  EvidenceBasisKind,
  InteractionPart,
  Lifecycle,
  SourceReference,
} from "./types";

export interface NotebookChatRequest {
  readonly message: string;
  readonly sourceDocIds?: readonly string[];
  readonly history?: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly threadId?: string;
}

export type ChatFailureReason =
  | "unauthenticated"
  | "not_configured"
  | "unreachable"
  | "http_error"
  | "malformed_stream";

/**
 * Why there is no answer, in the only distinction that changes what to DO.
 *
 * `account` - the route worked exactly as designed and declined an anonymous
 * turn. Nothing is broken; the visitor needs a workspace. The honest end of
 * that turn is an invitation.
 *
 * `fault` - something is actually wrong (unreachable, 5xx, unreadable stream).
 * The honest end of that turn is an error the visitor can see and we can fix.
 * It must NEVER be dressed up as a sign-up prompt: that misleads the visitor
 * about the product AND hides the bug from us.
 *
 * The split is a frozen total map rather than an `if` at each call site, so a
 * new failure reason cannot quietly default into the friendlier branch.
 */
export type ChatGate = "account" | "fault";

export interface ChatUnavailable {
  readonly ok: false;
  readonly reason: ChatFailureReason;
  readonly gate: ChatGate;
  /** One sentence a visitor can read. Never a stack trace, never a guess. */
  readonly message: string;
}

export interface ChatAnswer {
  readonly ok: true;
  readonly parts: readonly InteractionPart[];
  readonly lifecycle: Lifecycle;
}

export type ChatResult = ChatAnswer | ChatUnavailable;

/**
 * A sentence for each failure, in the visitor's language rather than HTTP's.
 *
 * The two `account` sentences say what MIRA would have needed and what the
 * visitor can do about it. They do not apologise for a failure, because there
 * was none - and they do not promise an answer waits behind the door, only that
 * the door is where grounded answers get their grounding.
 */
const FAILURE_MESSAGE: Readonly<Record<ChatFailureReason, string>> = Object.freeze({
  unauthenticated:
    "MIRA answers from a workspace's approved documents, and this preview is not signed in — so there is nothing here to ground an answer in. Create a workspace to ask about your own equipment.",
  not_configured:
    "MIRA answers from a workspace's approved documents, and this preview has none attached — so there is nothing here to ground an answer in. Create a workspace to ask about your own equipment.",
  unreachable: "MIRA is unreachable from this preview right now. Nothing was answered.",
  http_error: "MIRA could not complete this answer. Nothing was invented in its place.",
  malformed_stream: "MIRA's reply could not be read. Nothing was invented in its place.",
});

/**
 * Total, frozen, and deliberately explicit for EVERY reason.
 *
 * `Record<ChatFailureReason, ChatGate>` makes a new reason a compile error here
 * rather than a silent `undefined` at a call site - and the missing entry fails
 * in the file that owns the union, not three packages downstream.
 */
const FAILURE_GATE: Readonly<Record<ChatFailureReason, ChatGate>> = Object.freeze({
  unauthenticated: "account",
  not_configured: "account",
  unreachable: "fault",
  http_error: "fault",
  malformed_stream: "fault",
});

export function chatGate(reason: ChatFailureReason): ChatGate {
  return FAILURE_GATE[reason];
}

export function chatUnavailable(reason: ChatFailureReason): ChatUnavailable {
  return { ok: false, reason, gate: FAILURE_GATE[reason], message: FAILURE_MESSAGE[reason] };
}

// ---------------------------------------------------------------------------
// Frame parsing
// ---------------------------------------------------------------------------

const EVIDENCE_BASES: readonly EvidenceBasisKind[] = [
  "general_reasoning",
  "identified_component",
  "oem_documentation",
  "workspace_evidence",
  "machine_history",
  "live_machine_evidence",
];

export type ChatFrame =
  | { readonly kind: "content"; readonly content: string }
  | { readonly kind: "sources"; readonly citations: readonly RawCitation[] }
  | { readonly kind: "evidence"; readonly basis?: EvidenceBasisKind; readonly label?: string; readonly identityDisputed?: boolean }
  | { readonly kind: "safety"; readonly trigger: string }
  | { readonly kind: "status"; readonly status: "answered" | "insufficient_evidence" | "error"; readonly message?: string }
  | { readonly kind: "followups"; readonly suggestions: readonly string[] }
  | { readonly kind: "usage"; readonly inputTokens: number | null; readonly outputTokens: number | null };

export interface RawCitation {
  readonly citationId: string;
  readonly docId: string;
  readonly sourceTitle: string;
  readonly page: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One SSE `data:` payload to a typed frame, or `null`.
 *
 * Unknown kinds return `null` and are skipped rather than failing the turn —
 * the route's own contract says additive frames must not break a client
 * ("existing clients ignore unknown kinds"). Malformed KNOWN kinds are a
 * different matter and are also dropped; the `status` frame is what decides the
 * turn, so a mangled `content` delta must not be allowed to invent text.
 */
export function parseFrame(raw: unknown): ChatFrame | null {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;
  switch (raw.kind) {
    case "content":
      return typeof raw.content === "string" ? { kind: "content", content: raw.content } : null;
    case "sources": {
      if (!Array.isArray(raw.citations)) return null;
      const citations: RawCitation[] = [];
      for (const entry of raw.citations) {
        if (
          !isRecord(entry)
          || typeof entry.citationId !== "string"
          || typeof entry.docId !== "string"
          || typeof entry.sourceTitle !== "string"
        ) return null;
        citations.push({
          citationId: entry.citationId,
          docId: entry.docId,
          sourceTitle: entry.sourceTitle,
          page: typeof entry.page === "number" ? entry.page : null,
        });
      }
      return { kind: "sources", citations };
    }
    case "evidence": {
      const basis = typeof raw.basis === "string" && (EVIDENCE_BASES as readonly string[]).includes(raw.basis)
        ? (raw.basis as EvidenceBasisKind)
        : undefined;
      return {
        kind: "evidence",
        ...(basis ? { basis } : {}),
        ...(typeof raw.label === "string" ? { label: raw.label } : {}),
        ...(raw.identityDisputed === true ? { identityDisputed: true } : {}),
      };
    }
    case "safety":
      return typeof raw.trigger === "string" ? { kind: "safety", trigger: raw.trigger } : null;
    case "status":
      return raw.status === "answered" || raw.status === "insufficient_evidence" || raw.status === "error"
        ? { kind: "status", status: raw.status, ...(typeof raw.message === "string" ? { message: raw.message } : {}) }
        : null;
    case "followups":
      return Array.isArray(raw.suggestions) && raw.suggestions.every((s) => typeof s === "string")
        ? { kind: "followups", suggestions: raw.suggestions as string[] }
        : null;
    case "usage":
      return {
        kind: "usage",
        inputTokens: typeof raw.inputTokens === "number" ? raw.inputTokens : null,
        outputTokens: typeof raw.outputTokens === "number" ? raw.outputTokens : null,
      };
    default:
      return null;
  }
}

/** Split an SSE body into `data:` payloads, stopping at the literal `[DONE]`. */
export function splitSseFrames(body: string): string[] {
  const payloads: string[] = [];
  for (const block of body.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return payloads;
      if (payload) payloads.push(payload);
    }
  }
  return payloads;
}

export function parseStream(body: string): ChatFrame[] {
  const frames: ChatFrame[] = [];
  for (const payload of splitSseFrames(body)) {
    let raw: unknown;
    try {
      raw = JSON.parse(payload);
    } catch {
      continue; // an unreadable payload is skipped; `status` still decides
    }
    const frame = parseFrame(raw);
    if (frame) frames.push(frame);
  }
  return frames;
}

/**
 * Frames to the shell's own parts.
 *
 * Nothing is synthesised: if the route sent no evidence frame there is no
 * evidence part, and an `insufficient_evidence` status becomes a refusal the
 * shell renders as such rather than an empty answer bubble.
 */
export function framesToParts(frames: readonly ChatFrame[]): ChatAnswer {
  let text = "";
  const parts: InteractionPart[] = [];
  const sources: SourceReference[] = [];
  let lifecycle: Lifecycle = "completed";
  let safety: { trigger: string } | null = null;
  let status: "answered" | "insufficient_evidence" | "error" = "answered";
  let statusMessage: string | undefined;
  let evidence: { basis: EvidenceBasisKind; label: string } | null = null;
  let followups: readonly string[] | null = null;
  let identityDisputed = false;

  for (const frame of frames) {
    switch (frame.kind) {
      case "content": text += frame.content; break;
      case "sources":
        for (const citation of frame.citations) {
          sources.push({
            id: citation.docId,
            title: citation.sourceTitle,
            kind: "oem_documentation",
            locator: citation.page === null ? `[${citation.citationId}]` : `p. ${citation.page}`,
          });
        }
        break;
      case "evidence":
        if (frame.identityDisputed) identityDisputed = true;
        if (frame.basis) evidence = { basis: frame.basis, label: frame.label ?? frame.basis };
        break;
      case "safety": safety = { trigger: frame.trigger }; break;
      case "status":
        status = frame.status;
        statusMessage = frame.message;
        break;
      case "followups": followups = frame.suggestions; break;
      case "usage": break; // spend telemetry, not a technician-facing part
    }
  }

  if (text) parts.push({ type: "text", text });

  if (safety) {
    // A refusal on safety grounds is its own lifecycle, never "stopped" and
    // never "failed" — the difference is whether the machine or the network is
    // the reason there is no answer.
    parts.push({ type: "safety_notice", notice: { severity: "stop", message: text || "Safety stop.", trigger: safety.trigger } });
    lifecycle = "safety_stop";
  } else if (status === "error") {
    parts.push({
      type: "error",
      error: { code: "provider_failure", message: statusMessage ?? FAILURE_MESSAGE.http_error, retryable: true },
    });
    lifecycle = "failed";
  } else if (status === "insufficient_evidence") {
    // Not an error: MIRA declining because the approved sources do not answer
    // the question is the product working. Rendered as the refusal it is.
    parts.push({
      type: "text",
      text: statusMessage
        ?? "MIRA found nothing in the approved sources that answers this, so it has not answered.",
    });
    lifecycle = "completed";
  }

  if (identityDisputed) parts.push({ type: "identity_dispute" });
  for (const source of sources) parts.push({ type: "source", source });
  if (evidence) parts.push({ type: "evidence_basis", basis: { kind: evidence.basis, label: evidence.label, authorized: true } });
  if (followups && followups.length > 0) parts.push({ type: "followups", suggestions: followups });
  parts.push({ type: "status", status: lifecycle });

  return { ok: true, parts, lifecycle };
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export interface NotebookChatOptions {
  readonly baseUrl: string;
  /** Absent = the preview has nothing to ground an answer in, and says so. */
  readonly notebookId?: string;
  readonly fetch: (input: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;
}

export function notebookChatPath(notebookId: string): string {
  return `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/chat`;
}

export class NotebookChatClient {
  constructor(private readonly options: NotebookChatOptions) {}

  async ask(request: NotebookChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    const { baseUrl, notebookId, fetch: fetchImpl } = this.options;
    if (!notebookId) return chatUnavailable("not_configured");

    let response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}${notebookChatPath(notebookId)}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({
          message: request.message,
          ...(request.sourceDocIds ? { sourceDocIds: [...request.sourceDocIds] } : {}),
          ...(request.history ? { history: [...request.history] } : {}),
          ...(request.threadId ? { threadId: request.threadId } : {}),
        }),
        ...(signal ? { signal } : {}),
      });
    } catch {
      return chatUnavailable("unreachable");
    }

    if (response.status === 401 || response.status === 403) return chatUnavailable("unauthenticated");
    if (!response.ok) return chatUnavailable("http_error");

    let body: string;
    try {
      body = await response.text();
    } catch {
      return chatUnavailable("malformed_stream");
    }

    const frames = parseStream(body);
    // A stream that produced no frame at all never reached a `status`, so there
    // is no turn to render. Saying so beats rendering an empty answer.
    if (frames.length === 0) return chatUnavailable("malformed_stream");
    return framesToParts(frames);
  }
}
