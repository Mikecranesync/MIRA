/**
 * Document readiness — the "Ready to Ask" product contract.
 *
 * WHY THIS EXISTS
 * ---------------
 * The generic parsing/parsed status on `hub_uploads` is too coarse to drive the
 * product. It cannot distinguish "bytes accepted" from "text is citable" from
 * "background enrichment is still running" from "an optional enrichment is
 * permanently broken". That ambiguity is exactly what let a PERMANENT embedding
 * authorization failure (Postgres 42501, fixed by migration 079) look identical
 * to slow background work for a full day.
 *
 * THE ONE RULE THIS MODULE ENFORCES
 * ---------------------------------
 *   Chat readiness is TEXT/EVIDENCE readiness, not embedding completion.
 *
 * A document is answerable as soon as page-anchored chunks are searchable by the
 * canonical lexical (BM25/`content_tsv`) path. Embeddings are an *enhancement
 * state*. This is not a theory: a real 274-page PowerFlex 525 manual and a
 * 226-page Micro820 manual both produced correct, page-exact, click-through
 * citations while 100% of their chunks had `embedding IS NULL`.
 *
 * `embedding IS NOT NULL` must therefore NEVER become the definition of
 * readiness. `deriveReadiness` is written so that embedding facts can only ever
 * move a document between `enhancing` and `chat_ready_enhanced` — they can never
 * flip `canChat`. The test suite asserts that invariant directly.
 *
 * NOT A COMPETING LEDGER
 * ----------------------
 * This module stores nothing. It is a pure projection of facts the system
 * already records (upload status, chunk rows, embedding coverage) onto the
 * logical states the product needs. The canonical records remain `hub_uploads`,
 * `knowledge_entries` and `workspace_file_links`.
 */

/** Logical readiness states. Order matters only for readability, not ranking. */
export type ReadinessState =
  | "uploading" // bytes still moving; request not durably accepted
  | "stored" // bytes durable + identity known, but no citable text yet
  | "chat_ready_basic" // page-anchored chunks are lexically searchable → ASKABLE
  | "enhancing" // askable, and optional enrichment is still running
  | "chat_ready_enhanced" // askable, enrichment healthy/complete
  | "enhancement_degraded" // askable, but an optional enrichment failed
  | "needs_ocr" // no usable text layer — NOT askable, and we must say so
  | "failed"; // upload/parse/materialization failed

/**
 * Facts the caller must supply. Every field is something the system already
 * knows; nothing here requires a new table or a new write path.
 */
export interface ReadinessFacts {
  /** Are the bytes durably stored and the content hash known? (§14 "Stored") */
  bytesDurable: boolean;
  /** Terminal parse/materialization failure that is not "no text". */
  parseFailed?: boolean;
  /**
   * True when extraction produced ZERO usable text. This is a property of the
   * FILE (a scan), not a transient error — no retry of the same pipeline fixes
   * it, so it gets its own state rather than being flattened into `failed`.
   */
  noExtractableText?: boolean;
  /** Count of materialized chunk rows for this document. */
  chunkCount: number;
  /**
   * Do the chunks carry a real page/locator? Citations must resolve to an exact
   * page, so a chunk set with no anchors is NOT basic-ready even if non-empty.
   */
  hasPageAnchors: boolean;
  /** Can the caller's tenant/membership scope for this doc be validated? */
  scopeValidated: boolean;
  /** Are the original bytes still resolvable (for "open original page")? */
  originalResolvable: boolean;

  // ---- Enhancement facts. These may ONLY affect the enhanced/enhancing/
  // ---- degraded distinction. They can never make a document unaskable.
  /** Chunks that currently have a vector. */
  embeddedChunkCount?: number;
  /** An enrichment pass reported a permanent failure (e.g. 42501). */
  enhancementPermanentlyFailed?: boolean;
  /** Enrichment deliberately switched off (kill switch) — not a failure. */
  enhancementDisabled?: boolean;
}

export interface Readiness {
  state: ReadinessState;
  /** THE product question: may the composer send a question right now? */
  canChat: boolean;
  /** Short, technician-facing copy. Never leaks "BM25"/"vector"/"embedding". */
  label: string;
  /**
   * Fraction of chunks carrying a vector, 0..1, or null when unknown/not
   * applicable. Operator-facing only.
   */
  embeddingCoverage: number | null;
}

/**
 * The §14.1 hard definition, isolated so it can be asserted on its own.
 *
 * Deliberately absent: any embedding term. Adding one here is the specific
 * regression this function exists to prevent.
 */
export function meetsBasicReady(f: ReadinessFacts): boolean {
  return (
    f.bytesDurable &&
    !f.parseFailed &&
    !f.noExtractableText &&
    f.chunkCount > 0 &&
    f.hasPageAnchors &&
    f.scopeValidated &&
    f.originalResolvable
  );
}

function coverage(f: ReadinessFacts): number | null {
  if (f.chunkCount <= 0) return null;
  if (typeof f.embeddedChunkCount !== "number") return null;
  // Clamp: a stale/over-counted read must not produce >1 or a negative ratio.
  const ratio = f.embeddedChunkCount / f.chunkCount;
  return Math.max(0, Math.min(1, ratio));
}

/**
 * Project raw facts onto the readiness contract.
 *
 * Evaluation order is significant: the blocking conditions are settled BEFORE
 * any enhancement fact is consulted, which is what structurally guarantees that
 * enrichment can never gate chat.
 */
export function deriveReadiness(f: ReadinessFacts): Readiness {
  const cov = coverage(f);

  // ---- Blocking conditions first. ----------------------------------------
  if (f.parseFailed) {
    return { state: "failed", canChat: false, label: "Upload failed", embeddingCoverage: cov };
  }
  if (!f.bytesDurable) {
    return { state: "uploading", canChat: false, label: "Uploading…", embeddingCoverage: cov };
  }
  // A scan is reported honestly. It must NEVER claim to be searchable — an
  // answer "from" a document with no text layer would be ungrounded by
  // construction (canonical-files spec: stored and viewable, not chat-able).
  if (f.noExtractableText) {
    return {
      state: "needs_ocr",
      canChat: false,
      label: "Uploaded · text recognition required",
      embeddingCoverage: cov,
    };
  }
  if (!meetsBasicReady(f)) {
    return {
      state: "stored",
      canChat: false,
      label: "Uploaded — preparing text…",
      embeddingCoverage: cov,
    };
  }

  // ---- From here the document IS askable. Nothing below may change that. --
  const canChat = true;

  if (f.enhancementPermanentlyFailed) {
    // Technician-facing copy stays neutral: an optional enrichment failure is
    // not their problem and must not read as a broken document. The operator
    // signal is the structured log emitted by the enrichment pass itself.
    return {
      state: "enhancement_degraded",
      canChat,
      label: "Ready to ask",
      embeddingCoverage: cov,
    };
  }

  // Kill switch on, or nothing to report: basic-ready is the honest state.
  if (f.enhancementDisabled || cov === null) {
    return { state: "chat_ready_basic", canChat, label: "Ready to ask", embeddingCoverage: cov };
  }

  if (cov >= 1) {
    return {
      state: "chat_ready_enhanced",
      canChat,
      label: "Ready to ask",
      embeddingCoverage: cov,
    };
  }

  return {
    state: "enhancing",
    canChat,
    label: "Ready to ask · improving search…",
    embeddingCoverage: cov,
  };
}
