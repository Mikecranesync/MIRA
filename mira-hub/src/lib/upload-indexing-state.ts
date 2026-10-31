// mira-hub/src/lib/upload-indexing-state.ts
//
// #4784 — one honest answer to "is this attached manual searchable yet?".
// Pure functions only: the namespace files route computes the inputs from
// namespace_direct_uploads (upload_id, ingest_claim_token, ingest_claimed_at),
// and the attachment composer polls on the result.
//
// "queued" and "chunking" are part of the vocabulary but the namespace door
// cannot observe them separately (the ingest runs synchronously inside the
// POST after a claim). They are reported only when a caller supplies them.

export type IndexingState = "queued" | "parsing" | "chunking" | "indexed" | "failed";

export interface IndexingInput {
  /** capability === "indexable" (PDF or plain text). */
  indexable: boolean;
  /** The parked original is linked to an indexed upload. */
  indexed: boolean;
  /** An ingest claim is held and has not gone stale. */
  claimLive: boolean;
}

/**
 * null = the file is never indexed by design (images, stored blobs): no
 * indexing status is shown for it.
 */
export function indexingStateFor(input: IndexingInput): IndexingState | null {
  if (input.indexed) return "indexed";
  if (!input.indexable) return null;
  if (input.claimLive) return "parsing";
  return "failed";
}

export type PollDecision = "ready" | "wait" | "failed";

/** What the attachment composer does with a state: send, keep polling, or stop. */
export function pollDecision(state: IndexingState | null | undefined): PollDecision {
  if (state === "indexed") return "ready";
  if (state === "queued" || state === "parsing" || state === "chunking") return "wait";
  return "failed";
}
