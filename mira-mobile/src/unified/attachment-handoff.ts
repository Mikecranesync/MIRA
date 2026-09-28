/**
 * Carrying an attachment from HOME into the notebook the send creates.
 *
 * The composer on HOME belongs to a UnifiedChat instance that is unmounted the
 * moment a thread is created, and the notebook's composer is a DIFFERENT
 * instance. The bytes therefore have to survive one navigation that the unified
 * shell performs on itself.
 *
 * This is a deliberate, named, single-slot handoff rather than a prop threaded
 * through the legacy notebook screen: the screen is a frozen rollback surface
 * (see docs/architecture/convergence/UNIFIED_UI_CUTOVER.md), and routing the
 * shell's own navigation state through it would add a permanent coupling to a
 * tree we are trying to stop touching.
 *
 * It is a handoff, not a store: exactly one claimant, and claiming empties it.
 * Nothing observes it, nothing else writes it, and an unclaimed stash is
 * dropped by the next stash rather than accumulating.
 */
import type { Attachment } from "@factorylm/interaction";

export interface HeldAttachment {
  readonly attachment: Attachment;
  readonly file: File;
}

let stashed: readonly HeldAttachment[] = [];

/** Park what the HOME composer was holding, for the thread about to open. */
export function stashAttachments(held: readonly HeldAttachment[]): void {
  stashed = held;
}

/** Take the parked attachments. Idempotent: a second claim returns nothing. */
export function claimAttachments(): readonly HeldAttachment[] {
  const held = stashed;
  stashed = [];
  return held;
}

/** Drop anything parked — used when a handoff is abandoned. */
export function clearAttachments(): void {
  stashed = [];
}
