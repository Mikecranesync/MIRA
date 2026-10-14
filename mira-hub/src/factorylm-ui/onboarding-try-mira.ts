/**
 * The onboarding "Try MIRA" step, as pure decisions (#4417).
 *
 * Staging stranger walk, 2026-10-13: a new account uploaded its manual, was
 * told "Your manual is ready", asked a question, and got "Connection lost". The
 * node chat route had answered 412 approved_context: with
 * MIRA_ENFORCE_APPROVED_RETRIEVAL on (staging and production), a tenant's
 * private upload is admitted only when the technician opened that document, and
 * the wizard never said which document it was asking about.
 *
 * Owner ruling A (#4417): on a training surface the uploader's own manual
 * answers right away as a candidate source; approval gates only deployment
 * surfaces. So the wizard scopes its chat to the document it just uploaded —
 * the route's existing opened-document admission (#3437) — and the route stays
 * exactly as strict as it is everywhere else.
 */
import { errorMessageFor } from "./hub-host-logic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// local-upload.ts marks an exact re-drop of already-indexed bytes as parsed
// with this detail and writes no chunks of its own; the original's are on file.
const DUPLICATE_OF_RE = /^duplicate of (\S+)$/;

export interface TryMiraScope {
  nodeId: string;
  unsPath: string | null;
  /** hub_uploads.id whose chunks answer — the route's opened-document scope. */
  docId?: string;
}

export function tryMiraChatScope(input: {
  uploadId: string;
  upload: { kgEntityId?: string | null; statusDetail?: string | null } | null;
  line: { id: string; unsPath: string };
}): TryMiraScope {
  const node = input.upload?.kgEntityId ?? null;
  // No node on the upload means it never reached the citable (v2) store, so
  // there is no document to scope to: keep the line node, as before.
  if (!node) return { nodeId: input.line.id, unsPath: input.line.unsPath };
  const original = DUPLICATE_OF_RE.exec(input.upload?.statusDetail ?? "")?.[1];
  return {
    nodeId: node,
    unsPath: null,
    docId: original && UUID_RE.test(original) ? original : input.uploadId,
  };
}

/**
 * A response the route actually sent is never a network failure. Route codes
 * arrive as `error` (most routes) or `gate` (the approved-context refusal);
 * both read through the shell's one plain-language table.
 */
export function nodeChatFailureMessage(status: number, body: unknown): string {
  const b = body && typeof body === "object" ? (body as { error?: unknown; gate?: unknown }) : {};
  const code = typeof b.error === "string" ? b.error : typeof b.gate === "string" ? b.gate : "";
  return errorMessageFor(code, status);
}
