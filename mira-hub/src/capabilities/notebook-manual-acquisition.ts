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
import { attachFileToTargetsTx } from "@/lib/workspace-files";
import {
  acquireManualForIdentity,
  type ManualAcquisitionOutcome,
  type ManualAcquisitionInput,
  type PersistedSource,
  type SourceStateWriter,
} from "@/capabilities/manual-acquisition";

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
async function claim(tenantId: string, notebookId: string, key: string): Promise<string | null> {
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
                  -- search_limit_reached (#4160 S4) is retryable the SAME way: a
                  -- cap denial must not be cached as a permanent miss (PRD R5) —
                  -- the retry naturally re-checks the (reset) quota.
                  'retries', CASE WHEN manual_acquisition->>'key' = $3::text
                                   AND manual_acquisition->>'state' IN ('search_unavailable', 'search_limit_reached')
                                  THEN COALESCE((manual_acquisition->>'retries')::int, 0) + 1
                                  ELSE 0 END,
                  -- A retry remembers everything an earlier attempt ATTACHED —
                  -- across retries, early failures and stale-running recovery —
                  -- so a manual the technician removed is never put back
                  -- (Codex #4118 r14/r15 F19/F20).
                  'prior_doc_id', CASE WHEN manual_acquisition->>'key' = $3::text
                                        AND manual_acquisition->>'state' IN ('search_unavailable', 'search_limit_reached', 'running')
                                       THEN COALESCE(
                                              CASE WHEN manual_acquisition->>'linked' = 'true'
                                                   THEN manual_acquisition->'doc_id' END,
                                              manual_acquisition->'prior_doc_id') END,
                  'prior_file_id', CASE WHEN manual_acquisition->>'key' = $3::text
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
                 OR (manual_acquisition->>'state' IN ('search_unavailable', 'search_limit_reached')
                     AND COALESCE((manual_acquisition->>'retries')::int, 0) < $6
                     AND COALESCE((manual_acquisition->>'finished_at')::timestamptz, '-infinity')
                         < now() - make_interval(mins => $5)))
          RETURNING manual_acquisition->>'gen' AS gen`,
        [tenantId, notebookId, key, STALE_RUNNING_MINUTES, UNAVAILABLE_RETRY_MINUTES, MAX_AUTOMATIC_RETRIES],
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
    manual?: { matchState?: unknown; docId?: unknown; fileId?: unknown; indexed?: unknown; attached?: unknown } | null;
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
 */
export function fencedWriter(key: string, gen: string): SourceStateWriter {
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
        const owner = await c.query(
          `SELECT n.id FROM equipment_notebooks n
            WHERE n.tenant_id = $1::uuid AND n.id = $2::uuid
              AND n.identity_status = 'user_confirmed'
              AND n.manual_acquisition->>'key' = $3
              AND n.manual_acquisition->>'gen' = $4
              AND ${NOTEBOOK_KEY_SQL} = $3
            FOR UPDATE`,
          [tenantId, notebookId, key, gen],
        );
        if ((owner.rowCount ?? 0) === 0) return current();
        const written = await c.query<{ match_state: string; enabled_by_default: boolean }>(
          `UPDATE equipment_notebook_sources
              SET match_state = $4, enabled_by_default = $5, match_evidence = $6::jsonb
            WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND doc_id = $3::uuid
              AND match_state = 'candidate'
              AND match_evidence->>'decisionMethod' = 'pending_applicability_check'
            RETURNING match_state, enabled_by_default`,
          [
            tenantId,
            notebookId,
            docId,
            patch.matchState,
            patch.enabledByDefault,
            JSON.stringify({ ...patch.matchEvidence, autoAcquisitionKey: key }),
          ],
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
 */
export function fencedAttach(key: string, gen: string): NonNullable<ManualAcquisitionInput["attach"]> {
  return async (tenantId, notebookId, fileId, docId, targets, createdBy) =>
    withTenantContext(tenantId, async (c) => {
      const owner = await c.query<{ prior_doc: string | null; prior_file: string | null }>(
        `SELECT n.manual_acquisition->>'prior_doc_id' AS prior_doc,
                n.manual_acquisition->>'prior_file_id' AS prior_file
           FROM equipment_notebooks n
          WHERE n.tenant_id = $1::uuid AND n.id = $2::uuid
            AND n.identity_status = 'user_confirmed'
            AND n.manual_acquisition->>'key' = $3
            AND n.manual_acquisition->>'gen' = $4
            AND ${NOTEBOOK_KEY_SQL} = $3
          FOR UPDATE`,
        [tenantId, notebookId, key, gen],
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
  const key = acquisitionKey(input.identity);
  if (!key) return false;
  const gen = await claim(input.tenantId, input.notebookId, key);
  if (!gen) return false;
  const acquire = deps.acquire ?? acquireManualForIdentity;
  const startedAt = new Date().toISOString();
  void (async () => {
    let out: ManualAcquisitionOutcome;
    try {
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
        writeSourceState: fencedWriter(key, gen),
        attach: fencedAttach(key, gen),
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
        const r = await c.query<{ match_state: string }>(
          `SELECT match_state FROM equipment_notebook_sources
            WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND doc_id = $3::uuid`,
          [tenantId, notebookId, docRef],
        );
        const row = r.rows[0];
        if (row && row.match_state !== "rejected") return rec;
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

export function acquisitionDeclineText(rec: AcquisitionRecord | null, key: string | null, label: string): string | null {
  if (!rec || !key || rec.key !== key) return null;
  if (rec.source_removed) {
    return `I found a manual for the ${label} earlier, but it's no longer in this notebook's Sources, so I can't answer from it. If you need it, add it back or upload the manual, and ask again — I'll answer from it and show you the page.`;
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
      // must never read as "no manual exists". The record is retried once the
      // cap window resets (claim()'s retry predicate below).
      return `I hit today's search limit before I could look for the official ${label} manual. I'll try again automatically once the limit resets — ask again in a bit, or upload the manual yourself in the meantime.`;
    case "search_unavailable":
    case "download_rejected":
    case "manufacturer_model_required":
      return null;
  }
}
