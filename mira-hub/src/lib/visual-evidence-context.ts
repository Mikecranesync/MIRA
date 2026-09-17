/**
 * Visual-evidence context — the bridge from a photographed nameplate to the
 * notebook chat answer, keyed on the CANONICAL asset identity (Slice 1, owner
 * decision B).
 *
 * WRITE (capture): when a nameplate photo is taken inside an asset-bound
 * notebook, `recordNameplateObservations` records it in the VisualSession
 * ledger (migration 063) — one `visual_session` carrying the bound asset's
 * `asset_id`, one `evidence_item` referencing the already-parked photo, and one
 * `observation` per recognized field. Every observation is `candidate`
 * (`review_state='unreviewed'`): a vision reading is never self-promoted to
 * verified truth (ADR-0033; mirrors `evidence_from_visual_session`).
 *
 * READ (chat): `loadVisualEvidenceForAsset` returns the ACTIVE observations for
 * a notebook's bound asset, keyed ONLY on `visual_session.asset_id` = the
 * notebook's `equipment_entity_id`. Never a label, tag, uns_path, or a
 * client-supplied id — so a stale display name cannot change retrieval and one
 * machine's evidence cannot surface under another.
 *
 * ISOLATION: cross-TENANT is enforced by RLS + the explicit `o.tenant_id` /
 * `vs.tenant_id` predicates (TEXT since migration 069 — no `::uuid` cast; a
 * cast would throw `42883 operator does not exist: text = uuid` on every
 * call, see .claude/rules/mira-hub-migrations.md §1/§2). Cross-MACHINE separation rests on
 * `visual_session.asset_id` being written correctly at capture — which the
 * write path here does, and nothing else writes it. `asset_id` is a soft link
 * (migration 063: no FK), so a mis-tagged session is indistinguishable from a
 * correct one; the guarantee is "this query filters correctly", not "the data
 * cannot be mis-tagged".
 *
 * The active/trust rules mirror the Python source of truth verbatim
 * (`mira-bots/shared/visual/store.py::_ACTIVE_FILTER` +
 * `materialized_evidence/context_contract.py::evidence_from_visual_session`):
 * drop REJECTED/SUPERSEDED/review=rejected/superseded_by; verified iff the
 * HUMAN review_state is confirmed/corrected.
 */
import { withTenantContext } from "@/lib/tenant-context";
import { sha256Hex } from "@/lib/workspace-files";

/** A query client (the `withTenantContext` callback client, or a pg pool client). */
type QueryClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `equipment_entity_id` is TEXT holding `coalesce(entity_id, id::text)` — a UUID
 *  for a bridged/seeded asset, but not guaranteed. Guard before any `::uuid`
 *  cast so a non-UUID key never throws (write path) or 500s a turn (read path). */
export function isUuidKey(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export { sha256Hex };

export type NameplateVisualFact = {
  /** The nameplate field, e.g. "manufacturer" / "model" / "serial". */
  readonly field: string;
  /** As read off the plate (may be null when only a normalized value exists). */
  readonly rawText: string | null;
  /** The value to record; rows with an empty value are skipped. */
  readonly value: string;
  /** 0..1 recognizer confidence, or null. */
  readonly confidence: number | null;
};

/**
 * Record a nameplate capture into the VisualSession ledger, bound to the asset.
 * Returns the ids written, or null when there is nothing to record (no
 * asset-bound key, key is not a UUID, or no facts). CALLER MUST fail open —
 * wrap in try/catch so a ledger failure never breaks nameplate recognition.
 */
/** One persisted observation's stable identity, returned to the recognize
 *  response so the client can later confirm this EXACT reading (Slice 2). */
export type PersistedObservation = {
  readonly observationId: string;
  readonly field: string;
  readonly value: string;
};

export async function recordNameplateObservations(opts: {
  readonly tenantId: string;
  /** The notebook's bound asset key (`equipment_entity_id`). Must be a UUID. */
  readonly equipmentEntityId: string | null;
  /** The already-parked photo (hub_uploads file id) — cited to open the original. */
  readonly fileId: string;
  /** sha256 of the photo bytes (dedup/audit anchor). */
  readonly photoHash: string;
  readonly facts: readonly NameplateVisualFact[];
  readonly createdBy: string | null;
  readonly title: string | null;
}): Promise<{ sessionId: string; evidenceId: string; observations: PersistedObservation[] } | null> {
  // Write-side UUID guard (advisor #1): an asset-bound notebook whose key is not
  // a UUID is skipped, not thrown — logged by the caller.
  if (!isUuidKey(opts.equipmentEntityId)) return null;
  const facts = opts.facts.filter((f) => f.value && f.value.trim());
  if (facts.length === 0) return null;

  return withTenantContext(opts.tenantId, async (c: QueryClient) => {
    const s = await c.query(
      `INSERT INTO visual_session (tenant_id, asset_id, title, created_by, metadata)
       VALUES ($1, $2::uuid, $3, $4, $5::jsonb)
       RETURNING session_id::text AS id`,
      [opts.tenantId, opts.equipmentEntityId, opts.title, opts.createdBy, JSON.stringify({ source: "nameplate_photo" })],
    );
    const sessionId = String(s.rows[0].id);

    const e = await c.query(
      `INSERT INTO evidence_item (session_id, tenant_id, source_type, original_hash, capture_meta)
       VALUES ($1::uuid, $2, 'nameplate', $3, $4::jsonb)
       RETURNING evidence_id::text AS id`,
      // content stays NULL — the bytes live in hub_uploads (parked); capture_meta
      // carries the file id so the citation opens the original photo.
      [sessionId, opts.tenantId, opts.photoHash, JSON.stringify({ file_id: opts.fileId })],
    );
    const evidenceId = String(e.rows[0].id);

    const observations: PersistedObservation[] = [];
    for (const f of facts) {
      const value = f.value.trim();
      const o = await c.query(
        `INSERT INTO observation
           (session_id, tenant_id, evidence_id, obs_kind, raw_value, normalized_value,
            evidence_state, confidence, extractor, review_state)
         VALUES ($1::uuid, $2, $3::uuid, 'property', $4, $5, 'VISIBLE', $6, 'nameplate', 'unreviewed')
         RETURNING observation_id::text AS id`,
        [sessionId, opts.tenantId, evidenceId, f.rawText, `${f.field}: ${value}`, f.confidence],
      );
      observations.push({ observationId: String(o.rows[0].id), field: f.field, value });
    }
    return { sessionId, evidenceId, observations };
  });
}

/**
 * Promote ONLY the exact persisted observations a technician explicitly confirms.
 *
 * Slice 2 trust-loop. Flips `review_state` from `unreviewed` → `confirmed` for
 * the submitted `observationIds`, and ONLY where EVERY canonical-identity guard
 * holds (see the WHERE clause). It NEVER matches on component, field name, asset
 * label, tag, notebook label, client id, or capture type — only on the exact
 * observation UUIDs, scoped to the bound asset and this photo.
 *
 * Guards, in order (each fails safe by promoting nothing, never by broadening):
 *  - unbound / non-UUID bound asset → 0 (an unconfirmed asset context must not promote).
 *  - non-UUID fileId → 0 (no photo identity → nothing to scope to).
 *  - every submitted id that is not a UUID is DROPPED before the query (invalid
 *    identifiers fail safely; a malformed id in `ANY($::uuid[])` would otherwise
 *    throw). Empty after filtering → 0, no query.
 *
 * The UPDATE itself additionally requires each row to be a LIVE candidate
 * (`review_state='unreviewed'`, active evidence_state, not superseded), belong to
 * a `visual_session` on the bound `asset_id` (cross-machine guard), and belong to
 * `evidence_item` carrying this `file_id` (cross-capture guard). An id for a
 * sibling not submitted, an older/newer capture, another asset, or an already
 * confirmed/rejected row therefore promotes nothing.
 *
 * Returns the ids actually promoted (RETURNING) — the caller surfaces the count
 * so "only that observation was confirmed" is observable in production, not just
 * in tests. CALLER should treat a throw as a failed confirmation (do not swallow).
 */
export async function promoteVisualObservations(opts: {
  readonly tenantId: string;
  /** The notebook's SERVER-bound asset key (`equipment_entity_id`, Slice 0). */
  readonly boundEntityId: string | null;
  /** The confirmed photo (hub_uploads file id) — scopes promotion to this capture. */
  readonly fileId: string;
  /** The exact observation ids the technician approved (the client-decided subset). */
  readonly observationIds: readonly string[];
}): Promise<{ promotedIds: string[] }> {
  if (!isUuidKey(opts.boundEntityId)) return { promotedIds: [] };
  if (!isUuidKey(opts.fileId)) return { promotedIds: [] };
  const ids = opts.observationIds.filter((id) => isUuidKey(id));
  if (ids.length === 0) return { promotedIds: [] };

  return withTenantContext(opts.tenantId, async (c: QueryClient) => {
    const res = await c.query(
      `UPDATE observation o
          SET review_state = 'confirmed'
        WHERE o.observation_id = ANY($1::uuid[])
          AND o.tenant_id = $2
          AND o.review_state = 'unreviewed'
          AND o.evidence_state NOT IN ('REJECTED', 'SUPERSEDED')
          AND o.superseded_by IS NULL
          AND o.session_id IN (
            SELECT vs.session_id FROM visual_session vs
             WHERE vs.tenant_id = $2 AND vs.asset_id = $3::uuid
          )
          AND o.evidence_id IN (
            SELECT e.evidence_id FROM evidence_item e
             WHERE e.tenant_id = $2 AND e.capture_meta->>'file_id' = $4
          )
        RETURNING o.observation_id::text AS id`,
      [ids, opts.tenantId, opts.boundEntityId, opts.fileId],
    );
    return { promotedIds: res.rows.map((r) => String(r.id)) };
  });
}

export type VisualEvidenceRow = {
  readonly observationId: string;
  readonly sessionId: string;
  readonly text: string;
  readonly obsKind: string;
  /** verified only when a HUMAN confirmed/corrected it; a model reading is candidate. */
  readonly trust: "verified" | "candidate";
  readonly confidence: number | null;
  /** hub_uploads file id of the source photo — the citation-open-original target. */
  readonly fileId: string | null;
  readonly photoHash: string | null;
  readonly observedAt: string | null;
};

/**
 * Load the ACTIVE visual observations for a notebook's bound asset. Keyed ONLY
 * on `equipmentEntityId` (the notebook's binding) → `visual_session.asset_id`.
 * Returns [] for an unbound notebook (null key) or a non-UUID key. `c` is a
 * tenant-scoped client (called inside the route's `withTenantContext`).
 */
export async function loadVisualEvidenceForAsset(
  c: QueryClient,
  tenantId: string,
  equipmentEntityId: string | null,
  limit = 20,
): Promise<VisualEvidenceRow[]> {
  if (!isUuidKey(equipmentEntityId)) return [];
  const res = await c.query(
    `SELECT o.observation_id::text AS observation_id, o.session_id::text AS session_id,
            coalesce(o.normalized_value, o.raw_value) AS text, o.obs_kind, o.confidence,
            o.review_state, o.created_at,
            e.original_hash AS photo_hash, e.capture_meta->>'file_id' AS file_id
       FROM observation o
       JOIN visual_session vs ON vs.session_id = o.session_id AND vs.tenant_id = o.tenant_id
       LEFT JOIN evidence_item e ON e.evidence_id = o.evidence_id AND e.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1
        AND vs.asset_id = $2::uuid
        AND o.evidence_state NOT IN ('REJECTED', 'SUPERSEDED')
        AND o.review_state <> 'rejected'
        AND o.superseded_by IS NULL
        AND coalesce(o.normalized_value, o.raw_value, '') <> ''
      ORDER BY o.created_at DESC
      LIMIT $3`,
    [tenantId, equipmentEntityId, limit],
  );
  return res.rows.map((r) => ({
    observationId: String(r.observation_id),
    sessionId: String(r.session_id),
    text: String(r.text),
    obsKind: String(r.obs_kind),
    trust: r.review_state === "confirmed" || r.review_state === "corrected" ? "verified" : "candidate",
    confidence: r.confidence == null ? null : Number(r.confidence),
    fileId: (r.file_id as string) ?? null,
    photoHash: (r.photo_hash as string) ?? null,
    observedAt: r.created_at ? String(r.created_at) : null,
  }));
}

/**
 * Render the visual observations as a citable prompt section. The trust state is
 * carried in the LINE TEXT (advisor #2), not just a field — a candidate reading
 * the model would otherwise read as settled fact is explicitly marked
 * UNCONFIRMED, the way the machine-evidence section marks replay rows. Returns
 * "" when there is nothing to add.
 */
export function renderVisualEvidenceSection(rows: readonly VisualEvidenceRow[]): string {
  if (rows.length === 0) return "";
  const lines = rows.map((r) => {
    const mark =
      r.trust === "verified"
        ? "confirmed by a technician"
        : "UNCONFIRMED vision reading — a candidate the technician has not verified, NOT established fact";
    return `- ${r.text} (${mark})`;
  });
  // Prose attribution, NOT bracketed [n] markers — this route bans stray brackets
  // (they render as citation chips pointing at documents that do not exist), and
  // this mirrors how the machine-evidence section is attributed ("cite as machine
  // memory"). The trust state rides in each line so a candidate reading can never
  // be read as settled fact (ADR-0033 / advisor).
  return `## Visual Evidence (nameplate photographed on THIS machine)
Observations read from photos of this machine, scoped to its confirmed asset identity. Attribute
these in prose to "the photographed nameplate" — do NOT wrap them in bracketed citation numbers. A
line marked UNCONFIRMED is a candidate reading the technician has not verified: never state it as an
established fact; if you use one, say it is an unconfirmed nameplate reading and offer to confirm it.

${lines.join("\n")}`;
}
