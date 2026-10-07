/**
 * F004 grounding status (contract document r4, wire v1, PR #4303): what a notebook turn's
 * evidence actually was, kept as two statuses that are never merged.
 *
 *   retrieval — did passages from the selected manual reach the prompt?
 *   citation  — does the answer point at one of THIS turn's retrieved passages?
 *
 * Finding passages does not make an answer cited, and "citation linked" means
 * only that an [n] marker resolves to a passage retrieved for this turn — it
 * never claims the passage supports the sentence (semantic support stays with
 * the groundedness / JEV signals). An answer without a linked citation is
 * `manualCited: false`, whatever its basis label says.
 *
 * One entry per saved turn, built once by `buildGroundingStatus`, stored in the
 * existing `equipment_notebook_turns.evidence` JSONB array (no migration), and
 * shown ONLY to a client that declares `grounding_status_v1` while the flag is
 * on — installed clients that don't know the entry would otherwise render it as
 * an "Unrecognized part". Ids and counts only: never chunk or answer text.
 *
 * Zero-token: pure, deterministic, no inference.
 */

export const GROUNDING_STATUS_CAPABILITY = "grounding_status_v1";

/** Server flag. Off (unset) by default: nothing is written, emitted or shown. */
export function groundingStatusEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.NOTEBOOK_GROUNDING_STATUS_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Did the request declare that it understands the entry? Accepts the body's
 *  `clientCapabilities` array or a comma-separated query value. */
export function declaresGroundingStatus(caps: unknown): boolean {
  const list = typeof caps === "string" ? caps.split(",") : Array.isArray(caps) ? caps : [];
  return list.some((c) => typeof c === "string" && c.trim() === GROUNDING_STATUS_CAPABILITY);
}

/** The entry reaches a client only when BOTH hold. */
export function showGroundingStatus(caps: unknown, env: Record<string, string | undefined> = process.env): boolean {
  return groundingStatusEnabled(env) && declaresGroundingStatus(caps);
}

export type GroundingOutcome =
  | "safety_stop"
  | "stopped"
  | "provider_error"
  | "abstained_no_passages"
  | "abstained_retrieval_unavailable"
  | "refused_with_passages"
  | "refused_without_passages"
  | "answered_citation_linked"
  | "answered_uncited_with_passages"
  | "answered_without_manual";

export type RetrievalStatus = "passages_found" | "no_passages" | "unavailable" | "not_attempted";
export type CitationStatus = "linked" | "uncited" | "refused" | "not_applicable";

export interface GroundingStatusEntry {
  kind: "grounding_status";
  v: 1;
  outcome: GroundingOutcome;
  retrieval: {
    status: RetrievalStatus;
    notAttemptedReason?: "general_mode" | "no_manual_scope";
    /** Notebook document ids (UUIDs) in the server-validated scope. */
    scopeDocIds: string[];
    passageCount: number;
    /** Notebook document ids (UUIDs) of the passages that entered the prompt. */
    returnedDocIds: string[];
    /** Shared-library passages as `<origin+path>#p<page|?>` (the evidence
     *  packet's convention), with credentials, query and fragment removed. */
    returnedSourceRefs: string[];
  };
  citation: {
    status: CitationStatus;
    linkedDocIds: string[];
    linkedSourceRefs: string[];
    unresolvedMarkerCount: number;
  };
  /** Derived: `citation.status === "linked"`. Never set independently. A
   *  well-formed reference is not authorization and not proof of support. */
  manualCited: boolean;
  /** References dropped because their format was not a UUID / http(s) ref. */
  droppedRefCount: number;
  fallback: {
    /** May the client offer "Get general guidance (not from the manual)"? */
    offered: boolean;
    /** This general answer was requested from that failed turn (ownership-checked). */
    of?: string;
  };
}

/** The shape of a retrieved passage this module reads — ids only. */
export interface PassageRef {
  docId?: string | null;
  sourceUrl?: string | null;
  sourcePage?: number | null;
}

export interface GroundingStatusInputs {
  /** The answer was replaced by a terminal Safety STOP (`unsafe_answer`). */
  terminalSafetyStop: boolean;
  /** The technician stopped the answer before it completed. */
  stopped: boolean;
  /** A provider was called (false = the zero-evidence abstain gate). */
  modelCalled: boolean;
  /** A provider produced an answer. */
  served: boolean;
  /** The refusal verdict, or a non-unsafe pre-display rejection. */
  refused: boolean;
  /** The request asked for general mode. */
  general: boolean;
  /** Notebook or OEM retrieval ran this turn. */
  retrievalAttempted: boolean;
  /** The OEM library could not be reached (retrieval failed and was skipped). */
  retrievalUnavailable: boolean;
  /** The server-validated selected doc scope. */
  scopeDocIds: readonly string[];
  /** Passages that entered the prompt. */
  passages: readonly PassageRef[];
  /** Citations the answer actually shipped (resolved [n] → a retrieved passage). */
  emittedCitations: readonly { docId?: string | null; sourceUrl?: string | null; page?: number | null }[];
  /** [n] markers in the answer that resolve to no retrieved passage. */
  unresolvedMarkerCount: number;
  /** The notebook is bound to a resolved machine. */
  notebookBound: boolean;
  /** Validated id of the failed turn this general answer was requested from. */
  fallbackOf: string | null;
}

const CAP = 32;

const MAX_REF_CHARS = 512;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unique = (xs: readonly string[]): string[] => [...new Set(xs)].slice(0, CAP);

/** A shared-library reference in the evidence packet's `<url>#p<page>` form —
 *  http(s) only, with credentials, query string and fragment removed so no
 *  secret or signed URL is ever stored. Null when not a usable reference. */
function sourceRef(url: string | null | undefined, page: number | null | undefined): string | null {
  if (typeof url !== "string" || !url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const p = typeof page === "number" && Number.isInteger(page) && page >= 0 ? String(page) : "?";
  const ref = `${u.origin}${u.pathname}#p${p}`;
  return ref.length <= MAX_REF_CHARS ? ref : null;
}

type RefKind = { docId: string } | { sourceRef: string } | null;

/** Notebook passages are identified by their document UUID; shared-library
 *  passages (no doc id) by url + page. Anything else is malformed (null). */
function refOf(docId: string | null | undefined, url: string | null | undefined, page: number | null | undefined): RefKind {
  if (typeof docId === "string" && docId) return UUID_RE.test(docId) ? { docId } : null;
  const ref = sourceRef(url, page);
  return ref ? { sourceRef: ref } : null;
}

function splitRefs(refs: readonly RefKind[]): { docIds: string[]; sourceRefs: string[]; dropped: number } {
  const docIds: string[] = [];
  const sourceRefs: string[] = [];
  let dropped = 0;
  for (const r of refs) {
    if (!r) dropped++;
    else if ("docId" in r) docIds.push(r.docId);
    else sourceRefs.push(r.sourceRef);
  }
  return { docIds: unique(docIds), sourceRefs: unique(sourceRefs), dropped };
}

/** The references of the passages that entered the prompt, split into
 *  notebook document ids and shared-library refs; malformed ones are counted. */
export function sourceReferencesOf(passages: readonly PassageRef[]): { docIds: string[]; sourceRefs: string[]; dropped: number } {
  return splitRefs(passages.map((c) => refOf(c.docId, c.sourceUrl, c.sourcePage)));
}

/** Distinct [n] markers in `answer` that match no retrieved passage's citation id. */
export function countUnresolvedMarkers(answer: string, citations: readonly { citationId: string }[]): number {
  const known = new Set(citations.map((c) => c.citationId));
  const used = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => m[1]));
  let n = 0;
  for (const id of used) if (!known.has(id)) n++;
  return n;
}

/** Deterministic precedence (contract §3): the first matching row wins. */
export function buildGroundingStatus(i: GroundingStatusInputs): GroundingStatusEntry {
  const passageCount = i.passages.length;
  const scope = splitRefs(i.scopeDocIds.map((d) => (typeof d === "string" && UUID_RE.test(d) ? { docId: d } : null)));
  const returned = sourceReferencesOf(i.passages);
  const retrievalStatus: RetrievalStatus = !i.retrievalAttempted
    ? "not_attempted"
    : i.retrievalUnavailable
      ? "unavailable"
      : passageCount > 0
        ? "passages_found"
        : "no_passages";
  const retrieval: GroundingStatusEntry["retrieval"] = {
    status: retrievalStatus,
    ...(retrievalStatus === "not_attempted"
      ? { notAttemptedReason: i.general ? ("general_mode" as const) : ("no_manual_scope" as const) }
      : {}),
    scopeDocIds: scope.docIds,
    passageCount,
    returnedDocIds: returned.docIds,
    returnedSourceRefs: returned.sourceRefs,
  };
  const docGrounded = passageCount > 0;
  // Rule F: the general-guidance action is offered only for a selected manual
  // on an unbound notebook (a bound machine keeps its abstention — an answer
  // about that machine is grounded or it is not), never in general mode.
  const ruleF = !i.notebookBound && i.scopeDocIds.length > 0 && !i.general;

  let outcome: GroundingOutcome;
  let citationStatus: CitationStatus = "not_applicable";
  let offered = false;
  if (i.terminalSafetyStop) {
    outcome = "safety_stop";
  } else if (i.stopped) {
    outcome = "stopped";
  } else if (i.modelCalled && !i.served) {
    outcome = "provider_error";
  } else if (!i.modelCalled) {
    outcome = i.retrievalUnavailable ? "abstained_retrieval_unavailable" : "abstained_no_passages";
    offered = ruleF;
  } else if (i.refused) {
    outcome = docGrounded ? "refused_with_passages" : "refused_without_passages";
    citationStatus = "refused";
    offered = ruleF;
  } else if (i.emittedCitations.length > 0) {
    outcome = "answered_citation_linked";
    citationStatus = "linked";
  } else if (docGrounded) {
    outcome = "answered_uncited_with_passages";
    citationStatus = "uncited";
    offered = ruleF;
  } else {
    outcome = "answered_without_manual";
  }

  const linked =
    citationStatus === "linked"
      ? splitRefs(i.emittedCitations.map((c) => refOf(c.docId, c.sourceUrl, c.page)))
      : { docIds: [], sourceRefs: [], dropped: 0 };

  return {
    kind: "grounding_status",
    v: 1,
    outcome,
    retrieval,
    citation: {
      status: citationStatus,
      linkedDocIds: linked.docIds,
      linkedSourceRefs: linked.sourceRefs,
      unresolvedMarkerCount: citationStatus === "linked" || citationStatus === "uncited" ? i.unresolvedMarkerCount : 0,
    },
    manualCited: citationStatus === "linked",
    droppedRefCount: scope.dropped + returned.dropped + linked.dropped,
    fallback: { offered, ...(i.fallbackOf ? { of: i.fallbackOf } : {}) },
  };
}

export function isGroundingStatusEntry(e: unknown): e is GroundingStatusEntry {
  return typeof e === "object" && e !== null && (e as { kind?: unknown }).kind === "grounding_status";
}

/** Saved history for a client that did not declare the capability (or with the
 *  flag off): the entry is removed, so that client's output is unchanged. */
export function withoutUndeclaredGroundingStatus(evidence: unknown[], show: boolean): unknown[] {
  return show ? evidence : evidence.filter((e) => !isGroundingStatusEntry(e));
}

/** Honest refusal wording (contract §4, refusal status text) — about the attempt, never a claim
 *  that the manual lacks the answer. Sent only where the entry is shown. */
export const HONEST_REFUSAL_STATUS_MESSAGE = "I couldn't answer that from the selected sources.";
