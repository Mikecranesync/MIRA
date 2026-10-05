/**
 * The technician's message, shown the moment Send is tapped (owner ask,
 * 2026-10-05: uploads should work "just like chatgpt grok or any other modern
 * site"). Before this, a send with a photo — or the first send from HOME —
 * showed nothing until the upload, the project creation and the answer had all
 * finished (about 38 s on staging).
 *
 * View-only: an outgoing turn is never persisted. It is shown until the live
 * stream (whose question turn it then decorates with the photo) and finally
 * the server's own row (which carries the photo too) take over. Pure
 * functions, so the host only plumbs state.
 */
import type { Attachment, ContextSnapshot, InteractionPart, InteractionTurn } from "../../../packages/factorylm-interaction/src";

/** The thread id an outgoing message carries while it is sent from HOME (no project yet). */
export const HOME_THREAD = "home";

export interface Outgoing {
  readonly id: string;
  /** The thread the message was sent from; it never renders anywhere else. */
  readonly threadId: string;
  readonly question: string;
  readonly attachments: readonly Attachment[];
  readonly startedAt: string;
}

/** Attachments as they show on the outgoing message: queued until the server has them. */
export function outgoingParts(outgoing: Outgoing): InteractionPart[] {
  return outgoing.attachments.map((attachment) => ({ type: "attachment", attachment: { ...attachment, status: "queued" } }));
}

/** The outgoing message as a user turn, before any stream exists. */
export function outgoingTurn(outgoing: Outgoing, threadId: string, context: ContextSnapshot): InteractionTurn {
  const text: InteractionPart[] = outgoing.question ? [{ type: "text", text: outgoing.question }] : [];
  return {
    id: `${outgoing.id}-q`,
    threadId,
    role: "user",
    parts: [...text, ...outgoingParts(outgoing)],
    lifecycle: "running",
    context,
    createdAt: outgoing.startedAt,
    updatedAt: outgoing.startedAt,
  };
}

/**
 * The turns to show for the open thread. `streaming` are the live stream's
 * [question, answer] turns (empty before the stream starts). An outgoing
 * message from another thread is never shown.
 */
export function withOutgoing(
  persisted: readonly InteractionTurn[],
  streaming: readonly InteractionTurn[],
  outgoing: Outgoing | null,
  openThreadId: string | null,
  threadId: string,
  context: ContextSnapshot,
): InteractionTurn[] {
  if (!outgoing || outgoing.threadId !== openThreadId) return [...persisted, ...streaming];
  if (streaming.length === 0) return [...persisted, outgoingTurn(outgoing, threadId, context)];
  // The stream's question turn is text-only; give it the photo the technician sent.
  const [question, ...rest] = streaming;
  return [...persisted, { ...question, parts: [...question.parts, ...outgoingParts(outgoing)] }, ...rest];
}
