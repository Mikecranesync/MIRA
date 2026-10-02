/**
 * notebook-manual-acquisition — when a technician CONFIRMS a machine's identity,
 * look for that machine's official manual in the background and remember the
 * outcome on the notebook (#4075).
 *
 * The search itself is acquireManualForIdentity (the nameplate confirm route's
 * pipeline, unchanged): discovery, hardened download, ingest, and an
 * applicability check against the document's own text. A manual only enters
 * chat when that check verifies it; otherwise it is attached disabled for the
 * technician to review.
 *
 * Why background: discovery alone may take up to a minute, and the notebook
 * create response and chat decline both answer immediately. The outcome is
 * recorded in equipment_notebooks.manual_acquisition (migration 100), which the
 * chat reads to answer honestly and to avoid repeating a search it already ran
 * for the same identity.
 *
 * Identity comes only from the notebook's own confirmed fields, never from the
 * technician's free text (UNS-gate doctrine). Everything here fails open: a
 * missing column (prod applies migrations after merge), a database error, or a
 * disabled flag means "no automatic search", never a failed request.
 */
import { withTenantContext } from "@/lib/tenant-context";
import type { NotebookSource } from "@/lib/equipment-notebooks";
import { attachFileToTargetsTx } from "@/lib/workspace-files";
import type { SpanContext } from "@opentelemetry/api";
import {
  acquireManualForIdentity,
  type ManualAcquisitionOutcome,
  type ManualAcquisitionInput,
  type PersistedSource,
  type SourceStateWriter,
} from "@/capabilities/manual-acquisition";
import { MANUAL_SEARCH_LIMIT_COPY, MANUAL_SEARCH_UNAVAILABLE_COPY } from "@/capabilities/manual-search-copy";

/** A running claim older than this is treated as abandoned (container restart). */
export const STALE_RUNNING_MINUTES = 10;
/**
 * A search that failed because the discovery service was unavailable is retried
 * — but no sooner than this, so a down service is not hammered once per chat
 * turn (Codex #4118 r7 F12). Every other finished outcome is final for its key.
 */
export const UNAVAILABLE_RETRY_MINUTES = 30;
/** At most this many automatic retries per identity; after that the outcome stands. */
export const MAX_AUTOMATIC_RETRIES = 3;

/** safe-download rejections that say nothing about the file — only that it could not be fetched right now. */
const TRANSIENT_DOWNLOAD_REASONS = new Set(["timeout", "network_error"]);
/** HTTP statuses that mean "try again later", not "no such file" (Codex #4118 r11 F15). */
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type AcquisitionState = "running" | ManualAcquisitionOutcome["status"];

export interface AcquisitionRecord {
  key: string;
  state: AcquisitionState;
  started_at: string | null;
  finished_at: string | null;
  candidate_host: string | null;
  match_state: string | null;
  oem_request_url: string | null;
  /** The discovered document's URL, when discovery returned one. */
  candidate_url?: string | null;
  /** An INDEXED document was attached to this notebook's sources (reviewable in Sources). */
  attached_indexed?: boolean;
  /** #4172: confirming the candidate identity WILL turn this document on — it is
   *  attached, indexed, and stamped candidateApplicability='verified' (the only
   *  rows migration 104 / fencedWriter promote). Never true otherwise. */
  promotes_on_confirm?: boolean;
  /** The claim generation that wrote this record (Codex #4118 r3 F6). */
  gen?: string;
  /** The acquired document — reconciled against the notebook's current sources (Codex #4118 r8 F13). */
  doc_id?: string | null;
  /** The acquired file — reconciled for file-only (scanned) outcomes (Codex #4118 r9 F14). */
  file_id?: string | null;
  /** This attempt actually attached the manual to the notebook (Codex #4118 r14 F19). */
  linked?: boolean;
  /** What an EARLIER attempt attached, carried through every retry until resolved (r15 F20). */
  prior_doc_id?: string | null;
  prior_file_id?: string | null;
  /** Automatic retries already spent on a retryable failure (capped by MAX_AUTOMATIC_RETRIES). */
  retries?: number;
  /** Why a download failed, when it did (safe-download's rejection reason). */
  download_reason?: string | null;
  /** Set at read time: the acquired source was since removed or rejected by the technician. */
  source_removed?: boolean;
}

export interface ConfirmedIdentity {
  identityStatus: string | null | undefined;
  manufacturer: string | null | undefined;
  model: string | null | undefined;
  catalogNumber: string | null | undefined;
}

/** Off unless explicitly enabled — eval harnesses create confirmed notebooks too. */
export function acquisitionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.MIRA_NOTEBOOK_MANUAL_ACQUISITION ?? "").trim() === "1";
}

/**
 * #4160 S6 candidate takeover (the RC1 identity proposal from a label read,
 * the candidate-basis background search, and the replacement of #4171's
 * explicit search chip) — gated behind its OWN flag until a client can
 * confirm a candidate identity (#4175; Codex #4172 F13). Requires the base
 * flag too. Off (the default everywhere): the chat behaves exactly as before
 * S6. Only the exact value "1" enables it.
 */
export function candidateAcquisitionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return acquisitionEnabled(env) && (env.MIRA_NOTEBOOK_CANDIDATE_ACQUISITION ?? "").trim() === "1";
}

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/**
 * The identity this search is FOR. Only a technician-confirmed identity with a
 * manufacturer plus a model or catalog number qualifies — the same precondition
 * the confirm route enforces before it searches.
 */
export function acquisitionKey(id: ConfirmedIdentity): string | null {
  if (id.identityStatus !== "user_confirmed") return null;
  const mfr = clean(id.manufacturer);
  const model = clean(id.model);
  const catalog = clean(id.catalogNumber);
  if (!mfr || !(model || catalog)) return null;
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return [norm(mfr), norm(model), norm(catalog)].join("|");
}

function isUndefinedColumn(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "42703";
}

/** The acquisition key `fencedWriter` stamped into a source's `match_evidence`
 *  (the SAME field `reconcileAcquisition`'s own SQL reads as `auto_key`), or
 *  null when the source carries none (never search-matched — e.g. attached by
 *  hand through `POST /sources`). */
function matchEvidenceKey(matchEvidence: unknown): string | null {
  if (typeof matchEvidence !== "object" || matchEvidence === null) return null;
  const v = (matchEvidence as Record<string, unknown>).autoAcquisitionKey;
  return typeof v === "string" && v ? v : null;
}

/**
 * Codex F3 round 2 (MEDIUM) — the notebook's enabled, trusted (verified or
 * user_confirmed) manual that APPLIES to `identity`: role "manual" and a
 * stamped `autoAcquisitionKey` matching `acquisitionKey(identity)` exactly.
 * "Readiness" (can it answer right now) is a SEPARATE question — see
 * `applicableReadySource` below — because an applicable, enabled manual that
 * is still indexing is a different user-facing state ("added, preparing")
 * from one that is fully answerable, and from one that was never found at all.
 *
 * A source with no stamped key is NOT assumed applicable (fail closed): the
 * cost of a false negative here is one idempotent background search; the
 * cost of a false positive is exactly the bug Codex reported — an unrelated
 * ready manual silently satisfying, and silently suppressing the search for,
 * a DIFFERENT confirmed identity. Migration 104 deliberately preserves
 * user_confirmed sources across identity changes, so this predicate is the
 * only thing standing between that preservation and a false "ready".
 */
/** The shared applicability test both `applicableEnabledSource` and
 *  `applicableReadySource` filter on — see `applicableEnabledSource`'s own
 *  doc comment for the fail-closed rationale on a keyless source. */
function isApplicableEnabledManual(s: NotebookSource, key: string): boolean {
  return (
    s.sourceRole === "manual" &&
    s.enabledByDefault &&
    (s.matchState === "verified" || s.matchState === "user_confirmed") &&
    matchEvidenceKey(s.matchEvidence) === key
  );
}

export function applicableEnabledSource(
  sources: readonly NotebookSource[],
  identity: ConfirmedIdentity,
): NotebookSource | null {
  const key = acquisitionKey(identity);
  if (!key) return null;
  return sources.find((s) => isApplicableEnabledManual(s, key)) ?? null;
}

/**
 * As `applicableEnabledSource`, additionally requiring `readiness.canChat` —
 * the manual is not merely applicable and turned on, but ANSWERABLE now.
 *
 * Codex F13 (round 3): a notebook can have MORE THAN ONE applicable, enabled,
 * trusted manual for the same confirmed identity (an older one still
 * indexing, a newer one already ready). Composing `applicableEnabledSource`
 * — which stops at the FIRST applicable match in `listSources`' own
 * (created_at) order — and then checking only THAT one's readiness silently
 * reported "not ready" even when a later applicable source already was.
 * This searches ALL applicable sources for one that's ready, sharing the
 * SAME applicability predicate above — never a second matcher.
 */
export function applicableReadySource(
  sources: readonly NotebookSource[],
  identity: ConfirmedIdentity,
): NotebookSource | null {
  const key = acquisitionKey(identity);
  if (!key) return null;
  return sources.find((s) => isApplicableEnabledManual(s, key) && s.readiness.canChat) ?? null;
}

/** The recorded search for this notebook, or null (never attempted, or unreadable). */
export async function readAcquisition(tenantId: string, notebookId: string): Promise<AcquisitionRecord | null> {
  try {
    return await withTenantContext(tenantId, async (c) => {
      const r = await c.query<{ manual_acquisition: AcquisitionRecord | null }>(
        `SELECT manual_acquisition FROM equipment_notebooks WHERE tenant_id = $1 AND id = $2`,
        [tenantId, notebookId],
      );
      const rec = r.rows[0]?.manual_acquisition ?? null;
      return rec && typeof rec === "object" && typeof rec.state === "string" ? rec : null;
    });
  } catch (err) {
    if (!isUndefinedColumn(err)) {
      console.error("[manual-acquisition] read failed:", err instanceof Error ? err.message : err);
    }
    return null;
  }
}

/**
 * Atomically claim the search for this identity. Succeeds when the notebook has
 * no record, a record for a DIFFERENT identity, a stale "running" record, or a
 * "search_unavailable" record older than the retry backoff. Exactly one
 * concurrent caller wins.
 */
/**
 * `explicit` (#4177 S7, Codex r1 F2): an explicit technician confirmation owns a
 * new generation over ANY same-key record that is not a live running search —
 * a terminal no_manual_found, or a retryable one still inside its backoff — so
 * its real outcome is always persisted and a stale miss is never left behind.
 * A background start never passes it.
 */
async function claim(tenantId: string, notebookId: string, key: string, explicit = false): Promise<string | null> {
  try {
    return await withTenantContext(tenantId, async (c) => {
      // Every claim mints a fresh generation; only the holder of the CURRENT
      // generation may write sources or the outcome, so a slow worker whose
      // stale claim was taken over is fenced out (Codex #4118 r3 F6).
      const r = await c.query<{ gen: string }>(
        `UPDATE equipment_notebooks
            SET manual_acquisition = jsonb_build_object(
                  'key', $3::text, 'state', 'running', 'gen', gen_random_uuid()::text,
                  'started_at', to_jsonb(now()), 'finished_at', NULL,
                  'candidate_host', NULL, 'match_state', NULL, 'oem_request_url', NULL,
                  -- Automatic retries of a retryable failure are counted and capped
                  -- (Codex #4118 r12 F16): a PDF that never reads stops, eventually.
                  -- search_limit_reached (#4160 S4) is retried on a DIFFERENT
                  -- clock (the next UTC day — see the WHERE clause) and is
                  -- deliberately NOT counted here: a quota denial costs no
                  -- Serper query, so there is no reason to ever give up on it,
                  -- and counting it against the 30-min/3-retry budget below
                  -- would make it terminal in ~90 minutes while the real
                  -- daily/monthly window is still hours or weeks from reset —
                  -- a cap denial permanently cached as a miss (PRD R5).
                  -- Automatic retries of search_unavailable are counted against
                  -- MAX_AUTOMATIC_RETRIES. An EXPLICIT technician confirmation
                  -- ($7) is not an automatic retry: it never spends that budget
                  -- and resets it, so a fresh attempt gets fresh automatic
                  -- recovery (#4177 Codex r2 F4).
                  'retries', CASE WHEN NOT $7::boolean
                                   AND manual_acquisition->>'key' = $3::text
                                   AND manual_acquisition->>'state' = 'search_unavailable'
                                  THEN COALESCE((manual_acquisition->>'retries')::int, 0) + 1
                                  ELSE 0 END,
                  -- A retry remembers everything an earlier attempt ATTACHED —
                  -- across retries, early failures and stale-running recovery —
                  -- so a manual the technician removed is never put back
                  -- (Codex #4118 r14/r15 F19/F20). Removal history binds
                  -- AUTOMATIC attempts only: a fresh EXPLICIT confirmation ($7)
                  -- is the technician asking for the manual now, so it starts
                  -- with no prior references and attaches what discovery
                  -- returns; its OWN attachment is then checkpointed by the
                  -- fenced attach, so a later removal binds the automatic
                  -- recovery of THAT attempt (#4177 Codex r6 F8).
                  'prior_doc_id', CASE WHEN NOT $7::boolean
                                        AND manual_acquisition->>'key' = $3::text
                                        AND manual_acquisition->>'state' IN ('search_unavailable', 'search_limit_reached', 'running')
                                       THEN COALESCE(
                                              CASE WHEN manual_acquisition->>'linked' = 'true'
                                                   THEN manual_acquisition->'doc_id' END,
                                              manual_acquisition->'prior_doc_id') END,
                  'prior_file_id', CASE WHEN NOT $7::boolean
                                         AND manual_acquisition->>'key' = $3::text
                                         AND manual_acquisition->>'state' IN ('search_unavailable', 'search_limit_reached', 'running')
                                        THEN COALESCE(
                                               CASE WHEN manual_acquisition->>'linked' = 'true'
                                                    THEN manual_acquisition->'file_id' END,
                                               manual_acquisition->'prior_file_id') END)
          WHERE tenant_id = $1 AND id = $2
            AND (manual_acquisition IS NULL
                 OR manual_acquisition->>'key' IS DISTINCT FROM $3::text
                 OR (manual_acquisition->>'state' = 'running'
                     AND (manual_acquisition->>'started_at')::timestamptz
                         < now() - make_interval(mins => $4))
                 OR (manual_acquisition->>'state' = 'search_unavailable'
                     AND COALESCE((manual_acquisition->>'retries')::int, 0) < $6
                     AND COALESCE((manual_acquisition->>'finished_at')::timestamptz, '-infinity')
                         < now() - make_interval(mins => $5))
                 -- search_limit_reached: retry once a NEW UTC day has started
                 -- since the denial (the daily caps reset at UTC midnight; a
                 -- retry that still hits the monthly global cap just denies
                 -- again at zero cost and tries again the following day).
                 -- Uncapped by $6 on purpose — see the 'retries' comment above.
                 OR (manual_acquisition->>'state' = 'search_limit_reached'
                     AND COALESCE((manual_acquisition->>'finished_at')::timestamptz, '-infinity')
                         < date_trunc('day', now(), 'UTC'))
                 OR ($7::boolean
                     AND manual_acquisition->>'key' = $3::text
                     AND manual_acquisition->>'state' <> 'running'))
          RETURNING manual_acquisition->>'gen' AS gen`,
        [tenantId, notebookId, key, STALE_RUNNING_MINUTES, UNAVAILABLE_RETRY_MINUTES, MAX_AUTOMATIC_RETRIES, explicit],
      );
      return r.rows[0]?.gen ?? null;
    });
  } catch (err) {
    if (!isUndefinedColumn(err)) {
      console.error("[manual-acquisition] claim failed:", err instanceof Error ? err.message : err);
    }
    return null;
  }
}

/** The durable summary of an outcome. Only facts the pipeline returned. */
export function recordFromOutcome(key: string, startedAt: string | null, out: ManualAcquisitionOutcome): AcquisitionRecord {
  const p = out.payload as {
    candidate?: { host?: unknown; url?: unknown } | null;
    manual?: {
      matchState?: unknown;
      docId?: unknown;
      fileId?: unknown;
      indexed?: unknown;
      attached?: unknown;
      candidateApplicability?: unknown;
    } | null;
    oemRequestUrl?: unknown;
    warning?: unknown;
    reason?: unknown;
    httpStatus?: unknown;
    ingestFailed?: unknown;
    retryable?: unknown;
    linked?: unknown;
    removedByTechnician?: unknown;
  };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  // A source that was removed (or rejected) meanwhile is not "attached" — the
  // chat must never point at a source that is not there (Codex #4118 F9).
  const attachedIndexed =
    Boolean(str(p.manual?.docId)) && p.manual?.indexed === true && p.manual?.attached !== false && p.removedByTechnician !== true;
  // Another request is indexing these exact bytes: nothing is attached here YET.
  // Leave the claim "running" so the stale-claim recovery retries it and the
  // retry reuses the finished document instead of reporting a phantom source.
  const indexingElsewhere =
    out.status === "candidate_review" && !attachedIndexed && /currently indexing/i.test(String(p.warning ?? ""));
  // A download that failed for a TRANSIENT reason (the OEM site timed out or
  // the network dropped) is retryable, like an unavailable search; every other
  // rejection is a security/content guard and stays final (Codex #4118 r10 F15).
  const downloadReason = out.status === "download_rejected" ? str(p.reason) : null;
  // A PDF that downloaded but could not be READ for a non-scan reason (e.g. the
  // database dropped mid-ingest) is retryable too (Codex #4118 r12 F16).
  const transientIngest = out.status === "candidate_review" && (p.ingestFailed === true || p.retryable === true);
  const transientDownload =
    transientIngest ||
    (downloadReason !== null &&
      (TRANSIENT_DOWNLOAD_REASONS.has(downloadReason) ||
        (downloadReason === "http_error" && typeof p.httpStatus === "number" && TRANSIENT_HTTP_STATUSES.has(p.httpStatus))));
  return {
    key,
    state: indexingElsewhere ? "running" : transientDownload ? "search_unavailable" : out.status,
    started_at: startedAt,
    finished_at: indexingElsewhere ? null : new Date().toISOString(),
    candidate_host: str(p.candidate?.host),
    match_state: str(p.manual?.matchState),
    oem_request_url: str(p.oemRequestUrl),
    candidate_url: str(p.candidate?.url),
    attached_indexed: attachedIndexed,
    promotes_on_confirm: attachedIndexed && p.manual?.candidateApplicability === "verified",
    doc_id: str(p.manual?.docId),
    file_id: str(p.manual?.fileId),
    download_reason: downloadReason,
    linked: p.linked === true,
    ...(p.removedByTechnician === true ? { source_removed: true } : {}),
  };
}

/** SQL twin of acquisitionKey() for the notebook row (ASCII-identical normalization). */
const NOTEBOOK_KEY_SQL = `upper(regexp_replace(coalesce(n.manufacturer, ''), '[^A-Za-z0-9]', '', 'g'))
  || '|' || upper(regexp_replace(coalesce(n.model, ''), '[^A-Za-z0-9]', '', 'g'))
  || '|' || upper(regexp_replace(coalesce(n.catalog_number, ''), '[^A-Za-z0-9]', '', 'g'))`;

/**
 * Write this search's source state ONLY while, at that instant, the notebook is
 * still confirmed as the identity the search ran for AND still owns this
 * search's claim — and ONLY onto an undecided candidate this acquisition
 * attached (decisionMethod "pending_applicability_check"). The notebook row is
 * locked (FOR UPDATE) before the source is written, in the same transaction, so
 * a concurrent identity change either waits for this write (and then the
 * migration-101 trigger revokes it) or commits first and makes this write
 * refuse (Codex #4118 F3/F5). A technician's decision — rejected, confirmed, a
 * verified source they disabled — is never overwritten (F8), and the result is
 * what is actually persisted afterwards, null when the source is gone (F9).
 * The search key is stamped into the evidence so a later identity change can
 * find what this search enabled.
 *
 * `basis` (#4160 S6, default "confirmed" — byte-identical to the pre-S6
 * behaviour above): for "candidate", ownership does NOT require
 * `identity_status = 'user_confirmed'` — the notebook may be wholly unbound —
 * but if it IS confirmed, it must be confirmed to THIS exact key (a
 * different confirmed identity is not this search's owner, same as
 * "confirmed" basis). A candidate-basis write never enables a source UNLESS,
 * at this exact instant, the notebook turns out to already be confirmed to
 * the matching key (the common race: the technician confirms the identity
 * before the search finishes) — then it promotes using the REAL applicability
 * verdict this write carries (`candidateApplicability`, stamped by
 * manual-acquisition.ts), exactly as a "confirmed" write would. Otherwise it
 * is forced to match_state='candidate', enabled_by_default=false regardless
 * of what `patch` asked for (acquireManualForIdentity already forces
 * promote=false for candidate basis, so this is normally a no-op override —
 * it is the fence of record, not a formality).
 */
export function fencedWriter(key: string, gen: string, basis: "confirmed" | "candidate" = "confirmed"): SourceStateWriter {
  return async (tenantId, notebookId, docId, patch) => {
    try {
      return await withTenantContext(tenantId, async (c) => {
        const current = async (): Promise<PersistedSource> => {
          const r = await c.query<{ match_state: string; enabled_by_default: boolean }>(
            `SELECT match_state, enabled_by_default FROM equipment_notebook_sources
              WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND doc_id = $3::uuid`,
            [tenantId, notebookId, docId],
          );
          const row = r.rows[0];
          return row ? { matchState: row.match_state, enabledByDefault: row.enabled_by_default } : null;
        };
        const owner = await c.query<{ confirmed_same_key: boolean }>(
          `SELECT (n.identity_status = 'user_confirmed' AND ${NOTEBOOK_KEY_SQL} = $3) AS confirmed_same_key
             FROM equipment_notebooks n
            WHERE n.tenant_id = $1::uuid AND n.id = $2::uuid
              AND n.manual_acquisition->>'key' = $3
              AND n.manual_acquisition->>'gen' = $4
              AND (
                ($5::text = 'confirmed' AND n.identity_status = 'user_confirmed' AND ${NOTEBOOK_KEY_SQL} = $3)
                OR ($5::text = 'candidate' AND (n.identity_status <> 'user_confirmed' OR ${NOTEBOOK_KEY_SQL} = $3))
              )
            FOR UPDATE`,
          [tenantId, notebookId, key, gen, basis],
        );
        const row0 = owner.rows[0];
        if (!row0) return current();
        const evidence: Record<string, unknown> = { ...patch.matchEvidence, autoAcquisitionKey: key };
        const promoteNow = basis === "candidate" && row0.confirmed_same_key === true && evidence.candidateApplicability === "verified";
        const matchState = basis === "confirmed" ? patch.matchState : promoteNow ? "verified" : "candidate";
        const enabledByDefault = basis === "confirmed" ? patch.enabledByDefault : promoteNow;
        const written = await c.query<{ match_state: string; enabled_by_default: boolean }>(
          `UPDATE equipment_notebook_sources
              SET match_state = $4, enabled_by_default = $5, match_evidence = $6::jsonb
            WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND doc_id = $3::uuid
              AND match_state = 'candidate'
              AND match_evidence->>'decisionMethod' = 'pending_applicability_check'
            RETURNING match_state, enabled_by_default`,
          [tenantId, notebookId, docId, matchState, enabledByDefault, JSON.stringify(evidence)],
        );
        const row = written.rows[0];
        return row ? { matchState: row.match_state, enabledByDefault: row.enabled_by_default } : current();
      });
    } catch (err) {
      // A database failure is NOT "the source is gone" (null): rethrow so the
      // pipeline records a retryable outcome (Codex #4118 r13 F17).
      console.error("[manual-acquisition] fenced write failed:", err instanceof Error ? err.message : err);
      throw err;
    }
  };
}

/**
 * Attach only while this search still owns the notebook (current generation,
 * same confirmed identity). A stale worker that slips past this check cannot
 * corrupt a trusted source: the notebook-source upsert never lets a candidate
 * re-attach replace a verified/user-confirmed/rejected row's trust flags or
 * evidence (Codex #4118 r4 F5), and every promotion stays fenced by
 * fencedWriter under a row lock.
 */
/**
 * The background search's attach, in ONE transaction: lock the notebook row and
 * re-check ownership; if an earlier attempt attached this manual, lock THAT
 * source row (or file link) and report "removed" if the technician took it
 * out, or "resume" when it is the same document (assessed in place, never
 * re-attached); otherwise attach inside the same transaction. A concurrent
 * removal either committed first (seen, honored) or waits on the row lock and
 * removes the manual after this commit — it is never undone (Codex #4118 r15
 * F19). A database failure throws: retryable, not a refusal (r14 F18).
 *
 * `basis` (#4160 S6, default "confirmed" — identical ownership to pre-S6):
 * for "candidate" the notebook need not be confirmed yet (it may be unbound),
 * but if it IS confirmed, only to THIS exact key — the same relaxation as
 * `fencedWriter`. Attaching is not itself an enable decision (that is
 * `fencedWriter`'s job); this only decides who may attach the file/doc at
 * all.
 */
export function fencedAttach(
  key: string,
  gen: string,
  basis: "confirmed" | "candidate" = "confirmed",
): NonNullable<ManualAcquisitionInput["attach"]> {
  return async (tenantId, notebookId, fileId, docId, targets, createdBy) =>
    withTenantContext(tenantId, async (c) => {
      const owner = await c.query<{ prior_doc: string | null; prior_file: string | null }>(
        `SELECT n.manual_acquisition->>'prior_doc_id' AS prior_doc,
                n.manual_acquisition->>'prior_file_id' AS prior_file
           FROM equipment_notebooks n
          WHERE n.tenant_id = $1::uuid AND n.id = $2::uuid
            AND n.manual_acquisition->>'key' = $3
            AND n.manual_acquisition->>'gen' = $4
            AND (
              ($5::text = 'confirmed' AND n.identity_status = 'user_confirmed' AND ${NOTEBOOK_KEY_SQL} = $3)
              OR ($5::text = 'candidate' AND (n.identity_status <> 'user_confirmed' OR ${NOTEBOOK_KEY_SQL} = $3))
            )
          FOR UPDATE`,
        [tenantId, notebookId, key, gen, basis],
      );
      const row = owner.rows[0];
      if (!row) return false;
      if (row.prior_doc) {
        const src = await c.query<{ match_state: string }>(
          `SELECT match_state FROM equipment_notebook_sources
            WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND doc_id = $3::uuid
            FOR UPDATE`,
          [tenantId, notebookId, row.prior_doc],
        );
        if (!src.rows[0] || src.rows[0].match_state === "rejected") return "removed";
        // Same document (or a file-only retry of it): assess the existing row.
        if (docId === null || docId === row.prior_doc) return "resume";
      } else if (row.prior_file) {
        const link = await c.query(
          `SELECT 1 FROM workspace_file_links
            WHERE tenant_id = $1::uuid AND file_id = $2::uuid
              AND target_type = 'equipment_notebook' AND target_id = $3::uuid
            FOR UPDATE`,
          [tenantId, row.prior_file, notebookId],
        );
        if ((link.rowCount ?? 0) === 0) return "removed";
      }
      // Ownership held, nothing removed: attach in THIS transaction. An existing
      // source row is not a reason to stop (a retry must reach its applicability
      // check — r4 F7); the upsert keeps a trusted row's evidence (r4 F5).
      const res = await attachFileToTargetsTx(c, tenantId, fileId, targets, { createdBy });
      if (!res.ok) throw new Error(`attach failed: ${res.error}`);
      // Record what was attached IN THIS TRANSACTION, fenced by our generation:
      // if the worker dies before finish, stale-running recovery still knows,
      // so a later removal is honored (Codex #4118 r16 F22).
      await c.query(
        `UPDATE equipment_notebooks
            SET manual_acquisition = manual_acquisition || jsonb_build_object(
                  'prior_file_id', $5::text,
                  'prior_doc_id', COALESCE($6::text, manual_acquisition->>'prior_doc_id'))
          WHERE tenant_id = $1::uuid AND id = $2::uuid
            AND manual_acquisition->>'key' = $3 AND manual_acquisition->>'gen' = $4`,
        [tenantId, notebookId, key, gen, fileId, docId],
      );
      return true;
    });
}

async function finish(tenantId: string, notebookId: string, rec: AcquisitionRecord): Promise<void> {
  try {
    await withTenantContext(tenantId, async (c) => {
      // Only overwrite OUR claim: a re-bind to another identity mid-search wins.
      await c.query(
        `UPDATE equipment_notebooks
            SET manual_acquisition = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
                  $3::jsonb,
                  '{started_at}', COALESCE(manual_acquisition->'started_at', 'null'::jsonb)),
                  '{retries}', COALESCE(manual_acquisition->'retries', '0'::jsonb)),
                  '{prior_doc_id}', COALESCE(manual_acquisition->'prior_doc_id', 'null'::jsonb)),
                  '{prior_file_id}', COALESCE(manual_acquisition->'prior_file_id', 'null'::jsonb))
          WHERE tenant_id = $1 AND id = $2 AND manual_acquisition->>'key' = $4
            AND manual_acquisition->>'gen' = $5`,
        [tenantId, notebookId, JSON.stringify(rec), rec.key, rec.gen ?? ""],
      );
    });
  } catch (err) {
    console.error("[manual-acquisition] finish failed:", err instanceof Error ? err.message : err);
  }
}

export interface StartInput {
  tenantId: string;
  userId: string | null;
  notebookId: string;
  nodeId: string;
  identity: ConfirmedIdentity;
  /** R15: the chat turn starting this search (see ManualAcquisitionInput). */
  turnSpanContext?: SpanContext;
  /**
   * "candidate" starts the search for an identity the technician has not yet
   * confirmed (#4160 S6, PRD R2) — `identity` here is the SYNTHETIC
   * `{identityStatus: "user_confirmed", manufacturer, model, catalogNumber}`
   * the caller builds from the proposed/label-read maker+part, so `key` below
   * is EXACTLY the key the real PATCH bind will key once the technician
   * accepts (`acquisitionKey` only looks at the fields, not at whether the
   * confirmation is real). Threaded into `fencedWriter`/`fencedAttach` so the
   * write can never enable the source before that real confirmation lands.
   * Defaults to "confirmed" — identical to pre-S6 behaviour.
   */
  basis?: "confirmed" | "candidate";
}

/**
 * Start the background search if this notebook qualifies and no search for the
 * same identity already ran (or is running). Returns true only when THIS call
 * claimed and started it. Never throws, never awaits the search.
 */
export async function startManualAcquisition(
  input: StartInput,
  deps: { acquire?: typeof acquireManualForIdentity; env?: Record<string, string | undefined> } = {},
): Promise<boolean> {
  if (!acquisitionEnabled(deps.env)) return false;
  const basis = input.basis ?? "confirmed";
  const key = acquisitionKey(input.identity);
  if (!key) return false;
  const gen = await claim(input.tenantId, input.notebookId, key);
  if (!gen) return false;
  const acquire = deps.acquire ?? acquireManualForIdentity;
  const startedAt = new Date().toISOString();
  void (async () => {
    let out: ManualAcquisitionOutcome;
    try {
      // R15: the run's root span is made inside acquireManualForIdentity,
      // linked to `turnSpanContext` when a chat turn started it.
      out = await acquire({
        tenantId: input.tenantId,
        userId: input.userId,
        notebookId: input.notebookId,
        nodeId: input.nodeId,
        identity: {
          manufacturer: clean(input.identity.manufacturer) || undefined,
          model: clean(input.identity.model) || undefined,
          catalogNumber: clean(input.identity.catalogNumber) || undefined,
        },
        // Omitted entirely for the default "confirmed" basis — keeps the
        // acquire() call payload byte-identical to pre-S6 for every existing
        // (nameplate confirm + confirmed-identity notebook) caller.
        ...(basis === "candidate" ? { basis } : {}),
        ...(input.turnSpanContext ? { turnSpanContext: input.turnSpanContext } : {}),
        writeSourceState: fencedWriter(key, gen, basis),
        attach: fencedAttach(key, gen, basis),
      });
    } catch (err) {
      console.error("[manual-acquisition] search failed:", err instanceof Error ? err.message : err);
      out = { status: "search_unavailable", payload: {} };
    }
    await finish(input.tenantId, input.notebookId, { ...recordFromOutcome(key, startedAt, out), gen });
    console.log(
      `[manual-acquisition] notebook=${input.notebookId} state=${out.status}` +
        ` host=${(out.payload as { candidate?: { host?: string } }).candidate?.host ?? "-"}`,
    );
  })();
  return true;
}

/**
 * #4160 S7 (owner decision 2026-10-01 §2 — acquisition owns recovery
 * server-side): the confirm-time search, run INLINE under the same lifecycle
 * as the background one. `claim` owns the record, the search is awaited so
 * the caller still reports the real outcome, and `finish` records it — so a
 * limit denial (`search_limit_reached`) or an outage (`search_unavailable`)
 * is recovered by the chat route's existing retry predicates on the
 * technician's next question, with no repeat of the nameplate flow. The
 * caller's own source writer is used (no fenced writer: the technician is
 * confirming right now). `started: false` when the flag is off, the identity
 * is not searchable, or a LIVE search for this key is already running (an
 * explicit confirmation takes over any other same-key record — see `claim`) —
 * the caller then falls back to its unrecorded inline search (at worst two
 * queries in a rare race, and the running search's record stays the fresh
 * one). The caller decides WHICH acquisitions belong on the notebook-level
 * record: only the notebook's own confirmed identity, since that is the key
 * the chat's retry re-searches (#4178 tracks component nameplates).
 */
export async function runManualAcquisition(
  input: ManualAcquisitionInput,
  deps: { acquire?: typeof acquireManualForIdentity; env?: Record<string, string | undefined> } = {},
): Promise<{ started: boolean; outcome: ManualAcquisitionOutcome | null }> {
  if (!acquisitionEnabled(deps.env)) return { started: false, outcome: null };
  const key = acquisitionKey({
    identityStatus: "user_confirmed",
    manufacturer: input.identity.manufacturer ?? null,
    model: input.identity.model ?? null,
    catalogNumber: input.identity.catalogNumber ?? null,
  });
  if (!key) return { started: false, outcome: null };
  const gen = await claim(input.tenantId, input.notebookId, key, true);
  if (!gen) return { started: false, outcome: null };
  const acquire = deps.acquire ?? acquireManualForIdentity;
  const startedAt = new Date().toISOString();
  let out: ManualAcquisitionOutcome;
  try {
    // Codex #4177 r5 F7: the attachment is checkpointed IN THE ATTACH
    // TRANSACTION, fenced by this generation (prior_file_id / prior_doc_id),
    // exactly as the background runner does — so if the process dies after the
    // attach commits but before `finish`, the stale-running recovery still
    // knows what was attached and honors a removal instead of re-attaching
    // (the r16 F22 invariant). The caller's own source writer stays.
    // R15: the run's root span is made inside acquireManualForIdentity.
    out = await acquire({ ...input, attach: fencedAttach(key, gen) });
  } catch (err) {
    console.error("[manual-acquisition] confirm-time search failed:", err instanceof Error ? err.message : err);
    out = { status: "search_unavailable", payload: {} };
  }
  await finish(input.tenantId, input.notebookId, { ...recordFromOutcome(key, startedAt, out), gen });
  return { started: true, outcome: out };
}

/**
 * What the chat says about the automatic search when this notebook's own
 * manuals had nothing. Null when there is nothing honest to add (no record, or a
 * record for a different identity). Never claims a manual it did not attach.
 */
/**
 * Check a finished record against the notebook's CURRENT sources before it is
 * shown: a document the technician removed (or rejected) since the search is
 * reported as removed — never "it's in Sources" — and is never re-attached
 * automatically (Codex #4118 r8 F13). A read failure leaves the record as-is.
 */
export async function reconcileAcquisition(
  tenantId: string,
  notebookId: string,
  rec: AcquisitionRecord | null,
): Promise<AcquisitionRecord | null> {
  if (!rec) return rec;
  // An indexed document is checked against the notebook's sources (r8 F13); a
  // file-only outcome (a scanned manual) against the notebook's file link (r9 F14).
  // A retryable record whose attempt attached a manual is checked too, so a
  // removal during the backoff is honored before any retry (r14 F19).
  // For a retryable record, check what ANY attempt attached (r15 F20).
  const retryable = rec.state === "search_unavailable" || rec.state === "search_limit_reached";
  const docRef = retryable ? (rec.linked ? rec.doc_id : null) || rec.prior_doc_id || null : rec.doc_id || null;
  const fileRef = retryable ? (rec.linked ? rec.file_id : null) || rec.prior_file_id || null : rec.file_id || null;
  const bySource =
    Boolean(docRef) &&
    (rec.state === "complete" || (rec.state === "candidate_review" && rec.attached_indexed) || retryable);
  const byFile = !bySource && Boolean(fileRef) && (rec.state === "no_extractable_text" || retryable);
  if (!bySource && !byFile) return rec;
  try {
    return await withTenantContext(tenantId, async (c) => {
      if (bySource) {
        const r = await c.query<{
          match_state: string;
          auto_key: string | null;
          cand_app: string | null;
          revoked: string | null;
        }>(
          `SELECT match_state,
                  match_evidence->>'autoAcquisitionKey' AS auto_key,
                  match_evidence->>'candidateApplicability' AS cand_app,
                  match_evidence->>'revokedBecause' AS revoked
             FROM equipment_notebook_sources
            WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND doc_id = $3::uuid`,
          [tenantId, notebookId, docRef],
        );
        const row = r.rows[0];
        if (row && row.match_state !== "rejected") {
          // Codex post-cap 6 F11 (#4172): a cached promise that confirming will
          // turn this source on is re-checked against the CURRENT row with
          // migration 104's exact promotion predicate, so a source revoked
          // since the search (identity cleared) is never promised again.
          if (!rec.promotes_on_confirm) return rec;
          const stillPromotes =
            row.match_state === "candidate" && row.auto_key === rec.key && row.cand_app === "verified" && row.revoked == null;
          return stillPromotes ? rec : { ...rec, promotes_on_confirm: false };
        }
      } else {
        const r = await c.query(
          `SELECT 1 FROM workspace_file_links
            WHERE tenant_id = $1::uuid AND file_id = $2::uuid
              AND target_type = 'equipment_notebook' AND target_id = $3::uuid`,
          [tenantId, fileRef, notebookId],
        );
        if ((r.rowCount ?? 0) > 0) return rec;
      }
      return { ...rec, attached_indexed: false, source_removed: true };
    });
  } catch (err) {
    console.error("[manual-acquisition] reconcile failed:", err instanceof Error ? err.message : err);
    return rec;
  }
}

/**
 * `basis` (#4160 S6, default "confirmed" — unchanged copy below): for
 * "candidate" the technician has not yet accepted this identity. The only
 * action a shipping client gives them on the acquired manual is turning it on
 * in Sources (Hub notebook page; classic mobile notebook screen) — no client
 * renders the `identity_proposal` frame, offers a chat-side confirm, or can
 * confirm an EXISTING notebook's make/model (Codex #4172 F13; the client half
 * is #4095 / #3626). So the running copy says where the manual will land and
 * what to do with it, and every finished state uses the shared copy below,
 * which already points at Sources or gives the URL and the upload step. It
 * never names a button and never promises anything about confirmation
 * (migration 104 still promotes if a future client confirms the same key).
 */
export { MANUAL_SEARCH_LIMIT_COPY, MANUAL_SEARCH_UNAVAILABLE_COPY };

export function acquisitionDeclineText(
  rec: AcquisitionRecord | null,
  key: string | null,
  label: string,
  basis: "confirmed" | "candidate" = "confirmed",
): string | null {
  if (!rec || !key || rec.key !== key) return null;
  if (rec.source_removed) {
    return `I found a manual for the ${label} earlier, but it's no longer in this notebook's Sources, so I can't answer from it. If you need it, add it back or upload the manual, and ask again — I'll answer from it and show you the page.`;
  }
  if (basis === "candidate") {
    switch (rec.state) {
      case "running":
        return `I'm looking for the official ${label} manual now. When I find it, it'll be saved to this notebook's Sources, turned off until you check it — turn it on there if it's right and ask again, and I'll answer from it and show you the page.`;
      // candidate_review (Codex post-cap 4 F9 / 13 F13 / 14 F13): never a
      // promise about confirmation — no shipping client can confirm an
      // EXISTING notebook's identity (#4095 / #3626). The shared copy below
      // gives the one real next step: check it in Sources and turn it on, or
      // the URL and the upload instruction. `promotes_on_confirm` stays on the
      // record so a client that ships confirmation later can use it.
      // "complete" (Codex post-cap 6 F11): a cached complete record can outlive a
      // later revocation, and confirming never re-enables a revoked source, so
      // the shared copy below (pointing at Sources) is used instead of a promise.
      default:
        break;
    }
  }
  switch (rec.state) {
    case "running":
      return `I don't have the ${label} manual yet — I'm looking for the official one now. It will show up in this notebook's Sources when I find it; ask again in a minute and I'll answer from it and show you the page.`;
    case "complete":
      // The client chose this turn's sources before the manual arrived, so this
      // answer did not consult it — say so rather than imply it was searched.
      return `I found the official ${label} manual and added it to this notebook's Sources. Reopen the notebook (or turn it on in Sources) and ask again — I'll answer from it and show you the page.`;
    case "candidate_review":
      // Only name Sources when an indexed document is actually there to review.
      if (rec.attached_indexed) {
        return `I found a possible manual for the ${label}${rec.candidate_host ? ` (from ${rec.candidate_host})` : ""}, but I couldn't confirm it covers this exact model, so it isn't turned on. Check it in this notebook's Sources — turn it on if it's right and ask again.`;
      }
      return `I found a possible manual for the ${label}${rec.candidate_url ? ` at ${rec.candidate_url}` : rec.candidate_host ? ` on ${rec.candidate_host}` : ""}, but I couldn't confirm it's the official document for this model, so I didn't add it. If it's right, upload it to this notebook and ask again — I'll answer from it and show you the page.`;
    case "no_extractable_text":
      return `I found a manual for the ${label}, but it's a scanned image I can't read, so I can't answer from it. It's saved in this notebook's Sources for you to open.`;
    case "no_manual_found":
      return `I looked for the official ${label} manual and couldn't find one${rec.oem_request_url ? ` — you can request it from the manufacturer: ${rec.oem_request_url}` : ""}. Upload the manual (or the page that covers it) to this notebook, and I'll answer from it and show you the page.`;
    case "search_limit_reached":
      // Distinct from "couldn't find one" (PRD R5, #4160 S4) — a cap denial
      // must never read as "no manual exists". Scope-agnostic on purpose: the
      // cap that was hit could be this user's or this org's DAILY limit, or
      // the system-wide MONTHLY one — claim()'s retry predicate below retries
      // once a new UTC day starts regardless of which, so "tomorrow" is
      // accurate for the daily case and still eventually true for the
      // monthly one (never "in a bit", which the old wording promised and
      // the retry predicate could not keep for a daily backoff).
      // #4160 S7 (owner decision 2026-10-01 §1): never a reset time the backend
      // does not know — the denial may be the daily or the monthly cap. The #4160
      // gate (NO-GO 2026-10-01) required the approved sentence verbatim and no
      // "I'll try again automatically": a retry only happens on a later turn.
      return MANUAL_SEARCH_LIMIT_COPY;
    case "search_unavailable":
      // #4160 gate NO-GO: an outage had no copy and fell through to a generic
      // "couldn't find anything" — which reads as "no manual exists".
      return MANUAL_SEARCH_UNAVAILABLE_COPY;
    case "download_rejected":
    case "manufacturer_model_required":
      return null;
  }
}

/** T2 (#4189 F4/F6) — the shape the notebook GET route returns alongside
 *  `notebook`/`sources`/`turns`, for both the Hub and mobile post-refresh
 *  render path. Mirrors `ManualSearchStatus` in `packages/factorylm-interaction`
 *  field-for-field (not imported: that package has no DB-adjacent deps and
 *  this one does, by design — see that package's own header).
 *  `startedAt` (Codex round 2 F4/F8) identifies the SEARCH GENERATION — the
 *  shared mobile/Hub follower keys its retry budget on `notebookId|startedAt`
 *  so a NEW search (a different `started_at`) always gets a fresh budget,
 *  never one already spent by an earlier search for the same identity. */
export interface ManualSearchStatus {
  manufacturer: string;
  model: string;
  running: boolean;
  message?: string;
  startedAt?: string;
}

/**
 * The notebook's CURRENT manual-search status — for its own confirmed
 * identity, or (if that search never ran or isn't this notebook's own) the
 * most recently PROPOSED (not yet confirmed) identity — recomputed fresh on
 * every call via `readAcquisition` + `reconcileAcquisition`, never read from
 * a persisted snapshot. `manualSearchStatusFrame` (chat/route.ts) is
 * deliberately transient for exactly this reason: a "running" state captured
 * at persist-time reads as permanently stale once the search finishes. This
 * is the ONE place that recomputes it — reused by the Hub (`hub-host.tsx`'s
 * `loadDetail`, already called after every send and after a confirm) and
 * mobile (`getNotebookDetail`) on their EXISTING post-turn/post-confirm
 * refetch, never a second acquisition-status path.
 *
 * `sources` is the SAME list the GET route already read via `listSources` —
 * passed in rather than re-queried (Codex round 2 F10 review note).
 *
 * Codex F10 (MEDIUM): a candidate-basis search can finish `candidate_review`
 * in `manual_acquisition` and THEN identity confirmation promotes its source
 * to verified+enabled (migration 104) — a write to a DIFFERENT table that
 * never touches `manual_acquisition.state`. Reading the record's historical
 * state alone kept reporting the stale "I couldn't confirm it, it isn't
 * turned on" for a manual that is now, in fact, ready. This checks the
 * ACQUIRED SOURCE'S CURRENT state first (`applicableEnabledSource`/
 * `applicableReadySource` — the SAME matcher F3 uses, not a second one):
 * ready → "found and ready"; applicable+enabled but not yet readable →
 * "added, still preparing" (never "turn it on" for a source that already is
 * on); otherwise falls through to the historical decline text, unchanged.
 *
 * Returns null when acquisition is disabled, there is no record, or the
 * record belongs to neither identity (nothing current to report).
 */
export async function currentManualSearchStatus(
  tenantId: string,
  notebookId: string,
  confirmed: ConfirmedIdentity,
  proposedIdentity: { manufacturer: string; model: string } | null,
  sources: readonly NotebookSource[],
  deps: { env?: Record<string, string | undefined> } = {},
): Promise<ManualSearchStatus | null> {
  if (!acquisitionEnabled(deps.env)) return null;
  const rec = await readAcquisition(tenantId, notebookId);
  if (!rec) return null;

  const confirmedKey = acquisitionKey(confirmed);
  const candidateIdentity: ConfirmedIdentity | null = proposedIdentity
    ? { identityStatus: "user_confirmed", manufacturer: proposedIdentity.manufacturer, model: proposedIdentity.model, catalogNumber: "" }
    : null;
  const candidateKey = candidateIdentity ? acquisitionKey(candidateIdentity) : null;

  let manufacturer: string;
  let model: string;
  let key: string;
  let basis: "confirmed" | "candidate";
  let identity: ConfirmedIdentity;
  if (confirmedKey && rec.key === confirmedKey && confirmed.manufacturer && confirmed.model) {
    manufacturer = confirmed.manufacturer;
    model = confirmed.model;
    key = confirmedKey;
    basis = "confirmed";
    identity = confirmed;
  } else if (candidateKey && proposedIdentity && candidateIdentity && rec.key === candidateKey) {
    manufacturer = proposedIdentity.manufacturer;
    model = proposedIdentity.model;
    key = candidateKey;
    basis = "candidate";
    identity = candidateIdentity;
  } else {
    return null;
  }

  const startedAt = rec.started_at ?? undefined;

  // F10: the acquired source's CURRENT state wins over the historical record.
  const ready = applicableReadySource(sources, identity);
  if (ready) {
    return {
      manufacturer,
      model,
      running: false,
      message: `The ${manufacturer} ${model} manual is ready — I can answer from it.`,
      ...(startedAt ? { startedAt } : {}),
    };
  }
  const enabledButPreparing = applicableEnabledSource(sources, identity);
  if (enabledButPreparing) {
    return {
      manufacturer,
      model,
      running: false,
      message: `I found the ${manufacturer} ${model} manual and added it to this notebook's Sources — it's still being prepared to answer from.`,
      ...(startedAt ? { startedAt } : {}),
    };
  }

  const reconciled = await reconcileAcquisition(tenantId, notebookId, rec);
  if (!reconciled) return null;
  const running = reconciled.state === "running";
  const message = running ? null : acquisitionDeclineText(reconciled, key, `${manufacturer} ${model}`, basis);
  return { manufacturer, model, running, ...(message ? { message } : {}), ...(startedAt ? { startedAt } : {}) };
}
