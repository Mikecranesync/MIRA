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
import { acquireManualForIdentity, type ManualAcquisitionOutcome } from "@/capabilities/manual-acquisition";

/** A running claim older than this is treated as abandoned (container restart). */
export const STALE_RUNNING_MINUTES = 10;

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
 * no record, a record for a DIFFERENT identity, or a stale "running" record.
 * Exactly one concurrent caller wins.
 */
async function claim(tenantId: string, notebookId: string, key: string): Promise<boolean> {
  try {
    return await withTenantContext(tenantId, async (c) => {
      const r = await c.query(
        `UPDATE equipment_notebooks
            SET manual_acquisition = jsonb_build_object(
                  'key', $3::text, 'state', 'running',
                  'started_at', to_jsonb(now()), 'finished_at', NULL,
                  'candidate_host', NULL, 'match_state', NULL, 'oem_request_url', NULL)
          WHERE tenant_id = $1 AND id = $2
            AND (manual_acquisition IS NULL
                 OR manual_acquisition->>'key' IS DISTINCT FROM $3::text
                 OR (manual_acquisition->>'state' = 'running'
                     AND (manual_acquisition->>'started_at')::timestamptz
                         < now() - make_interval(mins => $4)))
          RETURNING id`,
        [tenantId, notebookId, key, STALE_RUNNING_MINUTES],
      );
      return (r.rowCount ?? 0) > 0;
    });
  } catch (err) {
    if (!isUndefinedColumn(err)) {
      console.error("[manual-acquisition] claim failed:", err instanceof Error ? err.message : err);
    }
    return false;
  }
}

/** The durable summary of an outcome. Only facts the pipeline returned. */
export function recordFromOutcome(key: string, startedAt: string | null, out: ManualAcquisitionOutcome): AcquisitionRecord {
  const p = out.payload as {
    candidate?: { host?: unknown; url?: unknown } | null;
    manual?: { matchState?: unknown; docId?: unknown; indexed?: unknown } | null;
    oemRequestUrl?: unknown;
    warning?: unknown;
  };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const attachedIndexed = Boolean(str(p.manual?.docId)) && p.manual?.indexed === true;
  // Another request is indexing these exact bytes: nothing is attached here YET.
  // Leave the claim "running" so the stale-claim recovery retries it and the
  // retry reuses the finished document instead of reporting a phantom source.
  const indexingElsewhere =
    out.status === "candidate_review" && !attachedIndexed && /currently indexing/i.test(String(p.warning ?? ""));
  return {
    key,
    state: indexingElsewhere ? "running" : out.status,
    started_at: startedAt,
    finished_at: indexingElsewhere ? null : new Date().toISOString(),
    candidate_host: str(p.candidate?.host),
    match_state: str(p.manual?.matchState),
    oem_request_url: str(p.oemRequestUrl),
    candidate_url: str(p.candidate?.url),
    attached_indexed: attachedIndexed,
  };
}

/** SQL twin of acquisitionKey() for the notebook row (ASCII-identical normalization). */
const NOTEBOOK_KEY_SQL = `upper(regexp_replace(coalesce(n.manufacturer, ''), '[^A-Za-z0-9]', '', 'g'))
  || '|' || upper(regexp_replace(coalesce(n.model, ''), '[^A-Za-z0-9]', '', 'g'))
  || '|' || upper(regexp_replace(coalesce(n.catalog_number, ''), '[^A-Za-z0-9]', '', 'g'))`;

/**
 * Enable a verified manual ONLY if, at this instant, the notebook is still
 * confirmed as the identity the search ran for AND still owns this search's
 * claim. One statement, so a re-bind between the check and the write cannot
 * slip through. A refusal leaves the manual a disabled candidate.
 */
export function fencedPromoter(key: string) {
  return async (tenantId: string, notebookId: string, docId: string, matchEvidence: Record<string, unknown>): Promise<boolean> => {
    try {
      return await withTenantContext(tenantId, async (c) => {
        const r = await c.query(
          `UPDATE equipment_notebook_sources s
              SET match_state = 'verified', enabled_by_default = true, match_evidence = $4::jsonb
             FROM equipment_notebooks n
            WHERE s.tenant_id = $1::uuid AND s.notebook_id = $2::uuid AND s.doc_id = $3::uuid
              AND n.tenant_id = s.tenant_id AND n.id = s.notebook_id
              AND n.identity_status = 'user_confirmed'
              AND n.manual_acquisition->>'key' = $5
              AND ${NOTEBOOK_KEY_SQL} = $5`,
          [tenantId, notebookId, docId, JSON.stringify(matchEvidence), key],
        );
        return (r.rowCount ?? 0) > 0;
      });
    } catch (err) {
      console.error("[manual-acquisition] fenced promote failed:", err instanceof Error ? err.message : err);
      return false;
    }
  };
}

async function finish(tenantId: string, notebookId: string, rec: AcquisitionRecord): Promise<void> {
  try {
    await withTenantContext(tenantId, async (c) => {
      // Only overwrite OUR claim: a re-bind to another identity mid-search wins.
      await c.query(
        `UPDATE equipment_notebooks
            SET manual_acquisition = jsonb_set($3::jsonb, '{started_at}',
                  COALESCE(manual_acquisition->'started_at', 'null'::jsonb))
          WHERE tenant_id = $1 AND id = $2 AND manual_acquisition->>'key' = $4`,
        [tenantId, notebookId, JSON.stringify(rec), rec.key],
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
  if (!(await claim(input.tenantId, input.notebookId, key))) return false;
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
        promoteVerified: fencedPromoter(key),
      });
    } catch (err) {
      console.error("[manual-acquisition] search failed:", err instanceof Error ? err.message : err);
      out = { status: "search_unavailable", payload: {} };
    }
    await finish(input.tenantId, input.notebookId, recordFromOutcome(key, startedAt, out));
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
export function acquisitionDeclineText(rec: AcquisitionRecord | null, key: string | null, label: string): string | null {
  if (!rec || !key || rec.key !== key) return null;
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
    case "search_unavailable":
    case "download_rejected":
    case "manufacturer_model_required":
      return null;
  }
}
