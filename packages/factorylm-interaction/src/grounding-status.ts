import type { GroundingOutcome, GroundingSearchScope, GroundingStatus } from "./types";

/**
 * F004 (#4303): the ONE reader of the server's `grounding_status` evidence
 * entry (wire `v: 1`, mira-hub `capabilities/grounding-status.ts`) that every
 * host adapter uses — Hub and phone never grow two parsers for one fact.
 *
 * Fail-closed: anything that is not a well-formed v1 entry is ignored (the
 * turn renders exactly as it did before the entry existed), never guessed at.
 * A future `v` is ignored rather than misread.
 */
const OUTCOMES: ReadonlySet<string> = new Set<GroundingOutcome>([
  "safety_stop",
  "stopped",
  "provider_error",
  "abstained_no_passages",
  "abstained_retrieval_unavailable",
  "refused_with_passages",
  "refused_without_passages",
  "answered_citation_linked",
  "answered_uncited_with_passages",
  "answered_without_manual",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The raw v1 entry, or null. */
function entryOf(raw: unknown): Record<string, unknown> | null {
  const r = record(raw);
  if (!r || r.kind !== "grounding_status" || r.v !== 1) return null;
  if (typeof r.outcome !== "string" || !OUTCOMES.has(r.outcome)) return null;
  return r;
}

export function isGroundingStatusEntry(raw: unknown): boolean {
  return entryOf(raw) !== null;
}

/** A non-empty array, read defensively: anything else counts as empty. */
function nonEmpty(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export function groundingStatusFromEntry(raw: unknown): GroundingStatus | null {
  const r = entryOf(raw);
  if (!r) return null;
  const retrieval = record(r.retrieval);
  const fallback = record(r.fallback);
  const searched = typeof retrieval?.status === "string" && retrieval.status !== "not_attempted";
  // `scopeDocIds` is the server-validated selection; with none, the search
  // (if any) was over the shared manual library.
  const searchScope: GroundingSearchScope = !searched
    ? "none"
    : nonEmpty(retrieval?.scopeDocIds)
      ? "selected_manual"
      : "shared_library";
  const passagesFrom = retrieval?.status !== "passages_found"
    ? null
    : nonEmpty(retrieval?.returnedDocIds)
      ? ("selected_manual" as const)
      : nonEmpty(retrieval?.returnedSourceRefs)
        ? ("shared_library" as const)
        : null;
  return {
    outcome: r.outcome as GroundingOutcome,
    manualSearched: searched,
    searchScope,
    passagesFrom,
    fallbackOffered: fallback?.offered === true,
    isGeneralFallback: typeof fallback?.of === "string" && fallback.of.length > 0,
  };
}

/** The first well-formed entry in a saved turn's `evidence[]`. */
export function groundingStatusOf(evidence: readonly unknown[] | null | undefined): GroundingStatus | null {
  for (const e of evidence ?? []) {
    const s = groundingStatusFromEntry(e);
    if (s) return s;
  }
  return null;
}

/** The failed turn this general answer was requested from (`fallback.of`), if any. */
export function fallbackSourceOf(evidence: readonly unknown[] | null | undefined): string | null {
  for (const e of evidence ?? []) {
    const r = entryOf(e);
    const of = record(r?.fallback)?.of;
    if (typeof of === "string" && of) return of;
  }
  return null;
}

/**
 * A refusal or abstention is not general guidance, even when the server's
 * legacy `basis` label calls it `general_reasoning`. Hosts drop the basis
 * chip for these outcomes so the turn never reads "General guidance — …"
 * over an answer MIRA declined to give.
 */
export function suppressesBasisLabel(status: GroundingStatus | null): boolean {
  return (
    status !== null &&
    (status.outcome === "refused_with_passages" ||
      status.outcome === "refused_without_passages" ||
      status.outcome === "abstained_no_passages" ||
      status.outcome === "abstained_retrieval_unavailable")
  );
}
