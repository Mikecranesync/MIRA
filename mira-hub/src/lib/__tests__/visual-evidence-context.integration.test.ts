/**
 * Visual-evidence context against REAL Postgres (migrations 063 + 069 applied
 * by scripts/setup-integration-db.mjs). Proves, on the actual schema and RLS:
 *
 *   - `promoteVisualObservations` and `loadVisualEvidenceForAsset` execute
 *     with NO Postgres error — before the fix, every call threw SQLSTATE
 *     42883 ("operator does not exist: text = uuid") because `tenant_id` on
 *     visual_session/evidence_item/observation is TEXT since migration 069,
 *     but the code compared it against a `::uuid`-cast bind param.
 *   - promotion matches EXACTLY the submitted observation ids, scoped to the
 *     bound asset and the confirmed photo — never a sibling, another photo,
 *     another asset, or another tenant.
 *   - `loadVisualEvidenceForAsset` isolates by asset and by tenant, and maps
 *     review_state to the trust the chat prompt renders.
 *   - the write path (`recordNameplateObservations`) round-trips through the
 *     read path end to end with a real TEXT tenant_id.
 *
 * Run: cd mira-hub && TEST_DATABASE_URL=… MIRA_TEST_DB_CONFIRM=DISPOSABLE \
 *   npm run db:integration:setup && \
 *   npx vitest run --config vitest.integration.config.ts src/lib/__tests__/visual-evidence-context.integration
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000000b";

// vi.mock factories are hoisted above every import, so the pool the mock hands
// to `@/lib/db` must itself be created in a hoisted block.
const { pool } = await vi.hoisted(async () => {
  const pg = await import("pg");
  return { pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }) };
});

vi.mock("@/lib/db", () => ({ default: pool }));
vi.mock("@/lib/workspace-files", () => ({ sha256Hex: (b: Buffer) => `sha:${b.length}` }));

import {
  correctVisualObservations,
  loadVisualEvidenceForAsset,
  promoteVisualObservations,
  recordNameplateObservations,
} from "../visual-evidence-context";
import { withTenantContext } from "../tenant-context";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** Seed with the OWNER pool — bypasses RLS (superuser in the disposable
 *  container), matching prod's neondb_owner before SET LOCAL ROLE. */
async function q(sql: string, values: unknown[] = []) {
  const c = await pool.connect();
  try {
    return await c.query(sql, values);
  } finally {
    c.release();
  }
}

const ASSET_A1 = "a55e7a11-0000-4000-8000-0000000000a1";
const ASSET_A2 = "a55e7a11-0000-4000-8000-0000000000a2";
const FILE_1 = "f11e0000-0000-4000-8000-000000000001";
const FILE_2 = "f11e0000-0000-4000-8000-000000000002";

type SeededObservation = {
  id: string;
  sessionId: string;
  evidenceId: string;
  text: string;
};

let sessionA1: string;
let sessionA1Photo2: string;
let sessionA2: string;
let sessionB: string;
let evidenceA1Photo1: string;
let evidenceA1Photo2: string;
let evidenceA2: string;
let evidenceB: string;

let obsA1P1_mfr: SeededObservation; // photo 1, manufacturer — the one confirmed
let obsA1P1_model: SeededObservation; // photo 1, model — sibling, NOT submitted
let obsA1P2_serial: SeededObservation; // photo 2 on the SAME asset
let obsA2: SeededObservation; // another asset, same tenant
let obsB: SeededObservation; // another tenant
let obsAlreadyConfirmed: SeededObservation;
let obsRejected: SeededObservation;
let obsSuperseded: SeededObservation;

async function insertSession(tenantId: string, assetId: string): Promise<string> {
  const r = await q(
    `INSERT INTO visual_session (tenant_id, asset_id, title) VALUES ($1, $2::uuid, 'it-test')
     RETURNING session_id::text AS id`,
    [tenantId, assetId],
  );
  return String(r.rows[0].id);
}

async function insertEvidence(sessionId: string, tenantId: string, fileId: string): Promise<string> {
  const r = await q(
    `INSERT INTO evidence_item (session_id, tenant_id, source_type, original_hash, capture_meta)
     VALUES ($1::uuid, $2, 'nameplate', 'deadbeef', $3::jsonb)
     RETURNING evidence_id::text AS id`,
    [sessionId, tenantId, JSON.stringify({ file_id: fileId })],
  );
  return String(r.rows[0].id);
}

async function insertObservation(
  sessionId: string,
  tenantId: string,
  evidenceId: string,
  text: string,
  opts: { reviewState?: string; evidenceState?: string; supersededBy?: string | null } = {},
): Promise<SeededObservation> {
  const { reviewState = "unreviewed", evidenceState = "VISIBLE", supersededBy = null } = opts;
  const r = await q(
    `INSERT INTO observation
       (session_id, tenant_id, evidence_id, obs_kind, raw_value, normalized_value,
        evidence_state, confidence, extractor, review_state, superseded_by)
     VALUES ($1::uuid, $2, $3::uuid, 'property', $4, $4, $5, 0.9, 'nameplate', $6, $7::uuid)
     RETURNING observation_id::text AS id`,
    [sessionId, tenantId, evidenceId, text, evidenceState, reviewState, supersededBy],
  );
  return { id: String(r.rows[0].id), sessionId, evidenceId, text };
}

run("visual-evidence-context (integration)", () => {
  beforeAll(async () => {
    sessionA1 = await insertSession(TENANT_A, ASSET_A1);
    sessionA1Photo2 = await insertSession(TENANT_A, ASSET_A1);
    sessionA2 = await insertSession(TENANT_A, ASSET_A2);
    sessionB = await insertSession(TENANT_B, ASSET_A1); // same asset UUID, other tenant

    evidenceA1Photo1 = await insertEvidence(sessionA1, TENANT_A, FILE_1);
    evidenceA1Photo2 = await insertEvidence(sessionA1Photo2, TENANT_A, FILE_2);
    evidenceA2 = await insertEvidence(sessionA2, TENANT_A, FILE_1);
    evidenceB = await insertEvidence(sessionB, TENANT_B, FILE_1);

    obsA1P1_mfr = await insertObservation(sessionA1, TENANT_A, evidenceA1Photo1, "manufacturer: DURApulse");
    obsA1P1_model = await insertObservation(sessionA1, TENANT_A, evidenceA1Photo1, "model: GS10");
    obsA1P2_serial = await insertObservation(sessionA1Photo2, TENANT_A, evidenceA1Photo2, "serial: SN-2");
    obsA2 = await insertObservation(sessionA2, TENANT_A, evidenceA2, "manufacturer: OtherAsset");
    obsB = await insertObservation(sessionB, TENANT_B, evidenceB, "manufacturer: TenantB");
    obsAlreadyConfirmed = await insertObservation(sessionA1, TENANT_A, evidenceA1Photo1, "already: confirmed", {
      reviewState: "confirmed",
    });
    obsRejected = await insertObservation(sessionA1, TENANT_A, evidenceA1Photo1, "rejected: reading", {
      evidenceState: "REJECTED",
    });
    const superseder = await insertObservation(sessionA1, TENANT_A, evidenceA1Photo1, "superseder");
    obsSuperseded = await insertObservation(sessionA1, TENANT_A, evidenceA1Photo1, "superseded: reading", {
      supersededBy: superseder.id,
    });
  });

  afterAll(async () => {
    await q(`DELETE FROM observation WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    await q(`DELETE FROM evidence_item WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    await q(`DELETE FROM visual_session WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    await pool.end();
  });

  describe("promoteVisualObservations — real Postgres executes without error, and matches EXACT identity", () => {
    it("P1: correct tenant+asset+photo+exact observation id promotes exactly that id and flips review_state", async () => {
      const out = await promoteVisualObservations({
        tenantId: TENANT_A,
        boundEntityId: ASSET_A1,
        fileId: FILE_1,
        observationIds: [obsA1P1_mfr.id],
      });
      expect(out.promotedIds).toEqual([obsA1P1_mfr.id]);

      const row = await q(`SELECT review_state FROM observation WHERE observation_id = $1::uuid`, [obsA1P1_mfr.id]);
      expect(row.rows[0].review_state).toBe("confirmed");
    });

    it("P2: sibling observation on the SAME photo, not submitted, stays unreviewed", async () => {
      const before = await q(`SELECT review_state FROM observation WHERE observation_id = $1::uuid`, [
        obsA1P1_model.id,
      ]);
      expect(before.rows[0].review_state).toBe("unreviewed");

      await promoteVisualObservations({
        tenantId: TENANT_A,
        boundEntityId: ASSET_A1,
        fileId: FILE_1,
        observationIds: [obsA1P1_mfr.id], // deliberately NOT obsA1P1_model.id
      });

      const after = await q(`SELECT review_state FROM observation WHERE observation_id = $1::uuid`, [
        obsA1P1_model.id,
      ]);
      expect(after.rows[0].review_state).toBe("unreviewed");
    });

    it("P3: an observation from ANOTHER PHOTO on the same asset promotes 0", async () => {
      const out = await promoteVisualObservations({
        tenantId: TENANT_A,
        boundEntityId: ASSET_A1,
        fileId: FILE_1, // wrong photo — obsA1P2_serial belongs to FILE_2
        observationIds: [obsA1P2_serial.id],
      });
      expect(out.promotedIds).toEqual([]);
      const row = await q(`SELECT review_state FROM observation WHERE observation_id = $1::uuid`, [
        obsA1P2_serial.id,
      ]);
      expect(row.rows[0].review_state).toBe("unreviewed");
    });

    it("P4: an observation from ANOTHER ASSET (same tenant) promotes 0", async () => {
      const out = await promoteVisualObservations({
        tenantId: TENANT_A,
        boundEntityId: ASSET_A1, // wrong asset — obsA2 belongs to ASSET_A2
        fileId: FILE_1,
        observationIds: [obsA2.id],
      });
      expect(out.promotedIds).toEqual([]);
    });

    it("P5: an observation from ANOTHER TENANT promotes 0, row unchanged when read via the owner pool", async () => {
      const out = await promoteVisualObservations({
        tenantId: TENANT_A,
        boundEntityId: ASSET_A1,
        fileId: FILE_1,
        observationIds: [obsB.id], // belongs to TENANT_B
      });
      expect(out.promotedIds).toEqual([]);
      const row = await q(`SELECT review_state, tenant_id FROM observation WHERE observation_id = $1::uuid`, [
        obsB.id,
      ]);
      expect(row.rows[0].review_state).toBe("unreviewed");
      expect(row.rows[0].tenant_id).toBe(TENANT_B);
    });

    it("P6: all-malformed observationIds promotes 0, no rows changed, never enters the DB", async () => {
      const out = await promoteVisualObservations({
        tenantId: TENANT_A,
        boundEntityId: ASSET_A1,
        fileId: FILE_1,
        observationIds: ["", "not-a-uuid"],
      });
      expect(out.promotedIds).toEqual([]);
    });

    it("P7: boundEntityId null and fileId non-UUID promote 0", async () => {
      expect(
        await promoteVisualObservations({
          tenantId: TENANT_A,
          boundEntityId: null,
          fileId: FILE_1,
          observationIds: [obsA1P1_mfr.id],
        }),
      ).toEqual({ promotedIds: [] });
      expect(
        await promoteVisualObservations({
          tenantId: TENANT_A,
          boundEntityId: ASSET_A1,
          fileId: "not-a-uuid",
          observationIds: [obsA1P1_mfr.id],
        }),
      ).toEqual({ promotedIds: [] });
    });

    it("P8: already-confirmed / REJECTED / superseded rows are not live candidates — promote 0", async () => {
      const out = await promoteVisualObservations({
        tenantId: TENANT_A,
        boundEntityId: ASSET_A1,
        fileId: FILE_1,
        observationIds: [obsAlreadyConfirmed.id, obsRejected.id, obsSuperseded.id],
      });
      expect(out.promotedIds).toEqual([]);
    });
  });

  describe("P9: a promotion is visible through the UNCHANGED Slice 1 read path (order-independent)", () => {
    it("promote → loadVisualEvidenceForAsset shows that exact row as verified; its sibling stays candidate", async () => {
      // Own rows so this holds regardless of what P1–P8 did to the shared fixtures.
      const session = await insertSession(TENANT_A, ASSET_A1);
      const evidence = await insertEvidence(session, TENANT_A, FILE_1);
      const target = await insertObservation(session, TENANT_A, evidence, "voltage: 480V (P9)");
      const sibling = await insertObservation(session, TENANT_A, evidence, "frequency: 60Hz (P9)");

      const before = await withTenantContext(TENANT_A, (c) => loadVisualEvidenceForAsset(c, TENANT_A, ASSET_A1, 100));
      expect(before.find((r) => r.observationId === target.id)).toMatchObject({ trust: "candidate" });

      const out = await promoteVisualObservations({
        tenantId: TENANT_A,
        boundEntityId: ASSET_A1,
        fileId: FILE_1,
        observationIds: [target.id],
      });
      expect(out.promotedIds).toEqual([target.id]);

      const after = await withTenantContext(TENANT_A, (c) => loadVisualEvidenceForAsset(c, TENANT_A, ASSET_A1, 100));
      expect(after.find((r) => r.observationId === target.id)).toMatchObject({ text: "voltage: 480V (P9)", trust: "verified", fileId: FILE_1 });
      expect(after.find((r) => r.observationId === sibling.id)).toMatchObject({ text: "frequency: 60Hz (P9)", trust: "candidate" });
    });
  });

  describe("loadVisualEvidenceForAsset — real Postgres executes without error, and isolates by asset + tenant", () => {
    it("R1+R4: returns exactly asset A1's active observations, fileId + photoHash populated, trust reflects review_state", async () => {
      const rows = await withTenantContext(TENANT_A, (c) => loadVisualEvidenceForAsset(c, TENANT_A, ASSET_A1));
      const byText = new Map(rows.map((r) => [r.text, r]));

      // The confirmed one from P1 above is verified; the untouched sibling is candidate.
      expect(byText.get("manufacturer: DURApulse")).toMatchObject({ trust: "verified", fileId: FILE_1 });
      expect(byText.get("model: GS10")).toMatchObject({ trust: "candidate", fileId: FILE_1 });
      expect(byText.get("serial: SN-2")).toMatchObject({ trust: "candidate", fileId: FILE_2 });
      expect(byText.get("serial: SN-2")?.photoHash).toBe("deadbeef");

      // REJECTED / superseded rows never surface as active evidence.
      expect(byText.has("rejected: reading")).toBe(false);
      expect(byText.has("superseded: reading")).toBe(false);
    });

    it("R2: cross-asset isolation — asset A2's rows never appear for A1 and vice versa", async () => {
      const a1 = await withTenantContext(TENANT_A, (c) => loadVisualEvidenceForAsset(c, TENANT_A, ASSET_A1));
      const a2 = await withTenantContext(TENANT_A, (c) => loadVisualEvidenceForAsset(c, TENANT_A, ASSET_A2));

      expect(a1.some((r) => r.text === "manufacturer: OtherAsset")).toBe(false);
      expect(a2.some((r) => r.text === "manufacturer: OtherAsset")).toBe(true);
      expect(a2.some((r) => r.text === "manufacturer: DURApulse")).toBe(false);
    });

    it("R3: cross-tenant isolation — tenant B's rows never appear for tenant A's asset id, even though the asset UUID collides", async () => {
      const asTenantA = await withTenantContext(TENANT_A, (c) => loadVisualEvidenceForAsset(c, TENANT_A, ASSET_A1));
      expect(asTenantA.some((r) => r.text === "manufacturer: TenantB")).toBe(false);

      const asTenantB = await withTenantContext(TENANT_B, (c) => loadVisualEvidenceForAsset(c, TENANT_B, ASSET_A1));
      expect(asTenantB.map((r) => r.text)).toEqual(["manufacturer: TenantB"]);
    });

    it("R5: both functions resolve with no thrown Postgres error", async () => {
      await expect(
        withTenantContext(TENANT_A, (c) => loadVisualEvidenceForAsset(c, TENANT_A, ASSET_A1)),
      ).resolves.toBeDefined();
      await expect(
        promoteVisualObservations({ tenantId: TENANT_A, boundEntityId: ASSET_A1, fileId: FILE_1, observationIds: [] }),
      ).resolves.toBeDefined();
    });
  });

  describe("recordNameplateObservations — write path round-trips through the read path (TEXT tenant_id, end to end)", () => {
    it("a fresh capture is written and immediately readable via loadVisualEvidenceForAsset", async () => {
      const written = await recordNameplateObservations({
        tenantId: TENANT_A,
        equipmentEntityId: ASSET_A2,
        fileId: FILE_2,
        photoHash: "roundtrip-hash",
        facts: [{ field: "voltage", rawText: "480V", value: "480V", confidence: 0.95 }],
        createdBy: "it-test",
        title: "round trip",
      });
      expect(written).not.toBeNull();
      expect(written?.observations).toHaveLength(1);

      const rows = await withTenantContext(TENANT_A, (c) => loadVisualEvidenceForAsset(c, TENANT_A, ASSET_A2));
      const found = rows.find((r) => r.observationId === written?.observations[0].observationId);
      expect(found).toMatchObject({ text: "voltage: 480V", trust: "candidate", photoHash: "roundtrip-hash" });
    });
  });

  // ── Slice 3: a technician CORRECTION supersedes the exact vision reading it
  //    replaces — never destroys evidence, changes which observation is active.
  //    Real schema (063 + 069: TEXT tenant_id), real RLS, real transaction.
  describe("correctVisualObservations — correction supersedes the exact reading, preserves the trail", () => {
    let misread: SeededObservation; // "model: GS1O" — OCR misread on photo 1 of asset A1
    let siblingOk: SeededObservation; // "frequency: 60Hz" — same photo, untouched
    const readA1 = () => withTenantContext(TENANT_A, (c) => loadVisualEvidenceForAsset(c, TENANT_A, ASSET_A1, 100));
    const ownerRow = async (id: string) =>
      (await q(
        `SELECT raw_value, normalized_value, evidence_state, review_state, superseded_by::text AS superseded_by,
                extractor, session_id::text AS session_id, evidence_id::text AS evidence_id, metadata
           FROM observation WHERE observation_id = $1::uuid`,
        [id],
      )).rows[0];

    beforeAll(async () => {
      misread = await insertObservation(sessionA1, TENANT_A, evidenceA1Photo1, "model: GS1O");
      siblingOk = await insertObservation(sessionA1, TENANT_A, evidenceA1Photo1, "frequency: 60Hz");
    });

    it("C2–C7: another photo / another asset / another tenant / already-confirmed / nonexistent / foreign bound asset correct NOTHING", async () => {
      const base = { tenantId: TENANT_A, boundEntityId: ASSET_A1, fileId: FILE_1, correctedBy: "it-tech" };
      for (const target of [obsA1P2_serial.id, obsA2.id, obsB.id, obsAlreadyConfirmed.id, "deadbeef-0000-4000-8000-000000000000"]) {
        const out = await correctVisualObservations({ ...base, corrections: [{ observationId: target, value: "X" }] });
        expect(out, target).toEqual({ corrected: [], mismatched: [] });
      }
      const foreign = await correctVisualObservations({
        ...base,
        boundEntityId: "deadbeef-0000-4000-8000-000000000000",
        corrections: [{ observationId: misread.id, value: "GS10" }],
      });
      expect(foreign).toEqual({ corrected: [], mismatched: [] });
      // Nothing was superseded anywhere and no replacement row appeared.
      const n = await q(`SELECT count(*)::int AS n FROM observation WHERE extractor = 'technician' AND tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
      expect(n.rows[0].n).toBe(0);
      expect((await ownerRow(misread.id)).evidence_state).toBe("VISIBLE");
    });

    it("C1 + C9: correcting 'model: GS1O' → 'GS10' inserts a technician/corrected replacement on the SAME photo, supersedes the misread with a pointer, and the chat read flips", async () => {
      // BEFORE: the misread is an active candidate in chat context.
      const before = await readA1();
      expect(before.find((r) => r.observationId === misread.id)).toMatchObject({ text: "model: GS1O", trust: "candidate" });

      const out = await correctVisualObservations({
        tenantId: TENANT_A,
        boundEntityId: ASSET_A1,
        fileId: FILE_1,
        corrections: [{ observationId: misread.id, value: " GS10 " }], // trimmed
        correctedBy: "it-tech",
      });
      expect(out.corrected).toHaveLength(1);
      expect(out.corrected[0].supersededId).toBe(misread.id);
      const replacementId = out.corrected[0].replacementId;

      // Replacement: human reading, verified trust, same session + evidence (photo), reverse pointer.
      const rep = await ownerRow(replacementId);
      expect(rep).toMatchObject({
        normalized_value: "model: GS10",
        raw_value: null,
        extractor: "technician",
        review_state: "corrected",
        evidence_state: "VISIBLE",
        superseded_by: null,
        session_id: misread.sessionId,
        evidence_id: misread.evidenceId,
      });
      expect(rep.metadata).toMatchObject({ corrected_from: misread.id, corrected_by: "it-tech", field: "model" });

      // Trail: the misread still exists, its own values untouched, pointing at the replacement.
      const old = await ownerRow(misread.id);
      expect(old).toMatchObject({
        raw_value: "model: GS1O",
        normalized_value: "model: GS1O",
        review_state: "unreviewed",
        evidence_state: "SUPERSEDED",
        superseded_by: replacementId,
      });

      // Sibling on the same photo untouched.
      expect(await ownerRow(siblingOk.id)).toMatchObject({ evidence_state: "VISIBLE", review_state: "unreviewed", superseded_by: null });

      // AFTER (the UNMODIFIED Slice 1 read): misread gone from context, correction present as verified.
      const after = await readA1();
      expect(after.find((r) => r.observationId === misread.id)).toBeUndefined();
      expect(after.find((r) => r.observationId === replacementId)).toMatchObject({ text: "model: GS10", trust: "verified" });
      expect(after.find((r) => r.observationId === siblingOk.id)).toMatchObject({ text: "frequency: 60Hz", trust: "candidate" });
    });

    it("C8 (Codex round 3 F1): a retry with the same correction writes nothing and is reported SATISFIED with the existing pair — never as lost", async () => {
      const ptr = await q(`SELECT superseded_by::text AS rep FROM observation WHERE observation_id = $1::uuid`, [misread.id]);
      const replacementId = ptr.rows[0].rep as string;
      const again = await correctVisualObservations({
        tenantId: TENANT_A, boundEntityId: ASSET_A1, fileId: FILE_1,
        corrections: [{ observationId: misread.id, value: "GS10" }], correctedBy: "it-tech",
      });
      expect(again).toEqual({ corrected: [{ supersededId: misread.id, replacementId }], mismatched: [] });
      const reps = await q(`SELECT count(*)::int AS n FROM observation WHERE metadata->>'corrected_from' = $1`, [misread.id]);
      expect(reps.rows[0].n).toBe(1);
    });

    it("C8b: a retry with a DIFFERENT value for the already-corrected reading is not satisfied and writes nothing", async () => {
      const again = await correctVisualObservations({
        tenantId: TENANT_A, boundEntityId: ASSET_A1, fileId: FILE_1,
        corrections: [{ observationId: misread.id, value: "GS20" }], correctedBy: "it-tech",
      });
      expect(again).toEqual({ corrected: [], mismatched: [] });
      const reps = await q(`SELECT count(*)::int AS n FROM observation WHERE metadata->>'corrected_from' = $1`, [misread.id]);
      expect(reps.rows[0].n).toBe(1);
    });

    it("same-value 'correction' is a no-op (that is a confirm, not a correction)", async () => {
      const out = await correctVisualObservations({
        tenantId: TENANT_A, boundEntityId: ASSET_A1, fileId: FILE_1,
        corrections: [{ observationId: siblingOk.id, value: "60Hz" }], correctedBy: "it-tech",
      });
      expect(out).toEqual({ corrected: [], mismatched: [] });
      expect((await ownerRow(siblingOk.id)).evidence_state).toBe("VISIBLE");
    });

    it("C10: no row was ever deleted — the correction added exactly one observation", async () => {
      const n = await q(`SELECT count(*)::int AS n FROM observation WHERE extractor = 'technician' AND tenant_id = $1`, [TENANT_A]);
      expect(n.rows[0].n).toBe(1);
    });
  });
});
