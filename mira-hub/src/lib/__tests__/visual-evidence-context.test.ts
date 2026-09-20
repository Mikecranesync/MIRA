/**
 * Visual-evidence context (Slice 1). Pure-function contracts: the UUID guard,
 * the trust mapping, and the trust-visible-in-text renderer. The SQL execution
 * (write→read, isolation, active filter, label-independence) is proven
 * separately against real Postgres — a mock client returns rows regardless of
 * SQL, so it can prove the mapping, never the query. `recordNameplateObservations`
 * and `loadVisualEvidenceForAsset` are additionally guarded here for the paths
 * that return BEFORE touching the database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
vi.mock("@/lib/workspace-files", () => ({ sha256Hex: (b: Buffer) => `sha:${b.length}` }));

import { withTenantContext } from "@/lib/tenant-context";

import {
  blockingLookHazard,
  correctVisualObservations,
  fieldOfNormalizedValue,
  isUuidKey,
  loadVisualEvidenceForAsset,
  loadVisualEvidenceForPhoto,
  normalizeLookHazards,
  promoteVisualObservations,
  recordLookObservation,
  recordNameplateObservations,
  renderLookObservationSection,
  renderVisualEvidenceSection,
  type VisualEvidenceRow,
} from "../visual-evidence-context";

const UUID = "64a24de7-0000-4000-8000-000000000001";
const UUID2 = "64a24de7-0000-4000-8000-000000000002";
const FILE = "f11a1111-1111-4111-8111-111111111111";

describe("structured LOOK hazards", () => {
  it("accepts only bounded finite descriptors, deduplicates by highest score, and keeps taxonomy order", () => {
    expect(normalizeLookHazards([
      { code: "smoke", confidence: 0.91 },
      { code: "arcing", confidence: 0.7 },
      { code: "arcing", confidence: 0.99 },
      { code: "invented", confidence: 1 },
      { code: "exposed_conductor", confidence: 2 },
    ])).toEqual([
      { code: "arcing", confidence: 0.99 },
      { code: "smoke", confidence: 0.91 },
    ]);
  });

  it("hard-stops only at the explicit confidence threshold", () => {
    expect(blockingLookHazard([{ code: "arcing", confidence: 0.849 }])).toBeNull();
    expect(blockingLookHazard([{ code: "arcing", confidence: 0.85 }])).toEqual({ code: "arcing", confidence: 0.85 });
    expect(blockingLookHazard([
      { code: "arcing", confidence: 0.85 },
      { code: "smoke", confidence: 0.96 },
    ])).toEqual({ code: "smoke", confidence: 0.96 });
  });
});

describe("isUuidKey", () => {
  it("accepts a UUID and rejects a slug / null / empty", () => {
    expect(isUuidKey(UUID)).toBe(true);
    expect(isUuidKey("mike")).toBe(false);
    expect(isUuidKey(null)).toBe(false);
    expect(isUuidKey("")).toBe(false);
  });
});

describe("recordNameplateObservations — pre-DB guards (fail-open feed)", () => {
  it("returns null for a non-UUID asset key (never throws into the recognize route)", async () => {
    const out = await recordNameplateObservations({
      tenantId: "t", equipmentEntityId: "not-a-uuid", fileId: "f", photoHash: "h",
      facts: [{ field: "model", rawText: "GS10", value: "GS10", confidence: 0.9 }],
      createdBy: null, title: null,
    });
    expect(out).toBeNull();
  });
  it("returns null when there are no citable facts", async () => {
    const out = await recordNameplateObservations({
      tenantId: "t", equipmentEntityId: UUID, fileId: "f", photoHash: "h",
      facts: [{ field: "model", rawText: null, value: "   ", confidence: null }],
      createdBy: null, title: null,
    });
    expect(out).toBeNull();
  });

  it("returns a per-fact {observationId, field, value} for each recorded reading (Slice 2)", async () => {
    // session INSERT → evidence INSERT → one observation INSERT per fact.
    const ids = ["sess-1", "ev-1", "obs-mfr", "obs-model"];
    let i = 0;
    const query = vi.fn(async () => ({ rows: [{ id: ids[i++] }] }));
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    const out = await recordNameplateObservations({
      tenantId: "11111111-1111-4111-8111-111111111111",
      equipmentEntityId: UUID, fileId: FILE, photoHash: "h",
      facts: [
        { field: "manufacturer", rawText: "DURApulse", value: " DURApulse ", confidence: 0.94 },
        { field: "model", rawText: "GS10", value: "GS10", confidence: 0.9 },
      ],
      createdBy: null, title: null,
    });
    expect(out?.sessionId).toBe("sess-1");
    expect(out?.evidenceId).toBe("ev-1");
    // field↔value pairing preserved, value trimmed, one entry per fact — the
    // shape the recognize response hands the client to confirm exact readings.
    expect(out?.observations).toEqual([
      { observationId: "obs-mfr", field: "manufacturer", value: "DURApulse" },
      { observationId: "obs-model", field: "model", value: "GS10" },
    ]);
  });
});

describe("loadVisualEvidenceForAsset — guard + mapping", () => {
  const client = (rows: Record<string, unknown>[]) => ({ query: vi.fn(async () => ({ rows })) });

  it("returns [] for an unbound (null) or non-UUID key without querying", async () => {
    const c = client([]);
    expect(await loadVisualEvidenceForAsset(c, "t", null)).toEqual([]);
    expect(await loadVisualEvidenceForAsset(c, "t", "slug")).toEqual([]);
    expect(c.query).not.toHaveBeenCalled();
  });

  it("maps review_state → trust and carries the photo file id for open-original", async () => {
    const c = client([
      { observation_id: "o1", session_id: "s1", text: "manufacturer: DURApulse", obs_kind: "property",
        confidence: 0.94, review_state: "unreviewed", created_at: "2026-09-16T00:00:00Z",
        photo_hash: "deadbeef", file_id: "file-cv101" },
      { observation_id: "o2", session_id: "s1", text: "model: GS10", obs_kind: "property",
        confidence: 0.9, review_state: "confirmed", created_at: "2026-09-16T00:00:01Z",
        photo_hash: "deadbeef", file_id: "file-cv101" },
    ]);
    const out = await loadVisualEvidenceForAsset(c, "t", UUID);
    expect(out[0]).toMatchObject({ text: "manufacturer: DURApulse", trust: "candidate", fileId: "file-cv101" });
    expect(out[1]).toMatchObject({ text: "model: GS10", trust: "verified" });
    // The query is keyed on the asset id, never a label/tag.
    const sql = ((c.query.mock.calls[0] as unknown[])[0] as string);
    expect(sql).toMatch(/vs\.asset_id = \$2::uuid/);
    expect(sql).toMatch(/evidence_state NOT IN \('REJECTED', 'SUPERSEDED'\)/);
    expect(sql).not.toMatch(/display_name|asset_tag|uns_path/);
  });
});

describe("promoteVisualObservations — guards short-circuit before any write", () => {
  // A guard that reaches the DB is a guard that could broaden matching
  // (invariant: "do not silently broaden matching when an identifier is
  // unavailable"). withTenantContext is the ONLY door to the database, so
  // asserting it is never entered is the real "no write" proof. Reset (drains
  // any leaked mockImplementationOnce from an earlier test) and reinstall a
  // safe default so the guard cases can't crash on an inherited impl.
  beforeEach(() => {
    vi.mocked(withTenantContext).mockReset();
    vi.mocked(withTenantContext).mockImplementation(async (_t, fn) =>
      (fn as (c: unknown) => unknown)({ query: vi.fn(async () => ({ rows: [] })) }),
    );
  });

  it("promotes nothing (never enters the DB) for an unbound / non-UUID bound asset", async () => {
    expect(await promoteVisualObservations({ tenantId: "t", boundEntityId: null, fileId: FILE, observationIds: [UUID] })).toEqual({ promotedIds: [] });
    expect(await promoteVisualObservations({ tenantId: "t", boundEntityId: "mike", fileId: FILE, observationIds: [UUID] })).toEqual({ promotedIds: [] });
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it("promotes nothing (never enters the DB) for a non-UUID fileId — no photo identity to scope to", async () => {
    expect(await promoteVisualObservations({ tenantId: "t", boundEntityId: UUID, fileId: "not-a-uuid", observationIds: [UUID] })).toEqual({ promotedIds: [] });
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it("drops malformed ids; when NONE survive it promotes nothing without entering the DB", async () => {
    expect(
      await promoteVisualObservations({ tenantId: "t", boundEntityId: UUID, fileId: FILE, observationIds: ["", "not-a-uuid", "'; DROP TABLE observation;--"] }),
    ).toEqual({ promotedIds: [] });
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it("issues the UPDATE with ONLY the valid ids, scoped to (tenant, bound asset, file), and returns the promoted ids", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: UUID }] }));
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    const out = await promoteVisualObservations({
      tenantId: "11111111-1111-4111-8111-111111111111",
      boundEntityId: UUID,
      fileId: FILE,
      // one malformed id mixed in — it must be filtered out of the query params.
      observationIds: [UUID, "not-a-uuid", UUID2],
    });
    expect(out).toEqual({ promotedIds: [UUID] });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    // The malformed id is not sent; the valid subset is, in order.
    expect(params[0]).toEqual([UUID, UUID2]);
    expect(params[1]).toBe("11111111-1111-4111-8111-111111111111");
    expect(params[2]).toBe(UUID);
    expect(params[3]).toBe(FILE);
    // Canonical-identity scoping is in the SQL, and it matches ONLY on the exact
    // ids + asset + file — never a field name, label, tag, or capture type.
    expect(sql).toMatch(/observation_id = ANY\(\$1::uuid\[\]\)/);
    expect(sql).toMatch(/review_state = 'unreviewed'/);
    expect(sql).toMatch(/evidence_state NOT IN \('REJECTED', 'SUPERSEDED'\)/);
    expect(sql).toMatch(/superseded_by IS NULL/);
    expect(sql).toMatch(/vs\.asset_id = \$3::uuid/);
    expect(sql).toMatch(/capture_meta->>'file_id' = \$4/);
    expect(sql).not.toMatch(/normalized_value|raw_value|display_name|asset_tag|obs_kind/);
  });
});

describe("fieldOfNormalizedValue — parses the persisted '<field>: <value>' shape or refuses", () => {
  it("returns the field for the shape recordNameplateObservations writes", () => {
    expect(fieldOfNormalizedValue("model: GS10")).toBe("model");
    expect(fieldOfNormalizedValue("catalogNumber: 25B-D010N104: rev C")).toBe("catalogNumber"); // first ': ' only
  });
  it("returns null (→ correction skipped) for anything else", () => {
    expect(fieldOfNormalizedValue(null)).toBeNull();
    expect(fieldOfNormalizedValue("GS10")).toBeNull();
    expect(fieldOfNormalizedValue(": GS10")).toBeNull();
    expect(fieldOfNormalizedValue("bad field: x")).toBeNull();
  });
});

describe("correctVisualObservations — correction changes which observation is active, never destroys evidence", () => {
  beforeEach(() => {
    vi.mocked(withTenantContext).mockReset();
    vi.mocked(withTenantContext).mockImplementation(async (_t, fn) =>
      (fn as (c: unknown) => unknown)({ query: vi.fn(async () => ({ rows: [] })) }),
    );
  });
  const base = { tenantId: "11111111-1111-4111-8111-111111111111", boundEntityId: UUID, fileId: FILE, correctedBy: "u_1" };

  it("never enters the DB for an unbound asset, a non-UUID fileId, malformed ids, or empty values", async () => {
    expect(await correctVisualObservations({ ...base, boundEntityId: null, corrections: [{ observationId: UUID2, value: "X" }] })).toEqual({ corrected: [], mismatched: [] });
    expect(await correctVisualObservations({ ...base, fileId: "nope", corrections: [{ observationId: UUID2, value: "X" }] })).toEqual({ corrected: [], mismatched: [] });
    expect(await correctVisualObservations({ ...base, corrections: [{ observationId: "not-a-uuid", value: "X" }] })).toEqual({ corrected: [], mismatched: [] });
    expect(await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "   " }] })).toEqual({ corrected: [], mismatched: [] });
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it("skips (no INSERT, no UPDATE) when the guarded SELECT finds no live target", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    const out = await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "GS10" }] });
    expect(out).toEqual({ corrected: [], mismatched: [] });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/FOR UPDATE/);
    // Liveness is decided in code (a superseded target may be a satisfied replay); the SQL scopes ownership only.
    expect(sql).not.toMatch(/review_state = 'unreviewed'/);
    expect(sql).toMatch(/o\.tenant_id = \$2/);
    expect(sql).toMatch(/vs\.asset_id = \$3::uuid/);
    expect(sql).toMatch(/capture_meta->>'file_id' = \$4/);
    expect(params).toEqual([UUID2, base.tenantId, UUID, FILE]);
  });

  it("skips a value equal to the recorded one — that is a confirm, not a correction", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: UUID2, session_id: "s", evidence_id: "e", normalized_value: "model: GS10", review_state: "unreviewed", evidence_state: "VISIBLE", superseded_by: null }] }));
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    const out = await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: " GS10 " }] });
    expect(out).toEqual({ corrected: [], mismatched: [] });
    expect(query).toHaveBeenCalledTimes(1); // SELECT only
  });

  it("skips a row whose normalized_value is not '<field>: <value>' rather than guessing a field", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: UUID2, session_id: "s", evidence_id: "e", normalized_value: "GS1O", review_state: "unreviewed", evidence_state: "VISIBLE", superseded_by: null }] }));
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    expect(await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "GS10" }] })).toEqual({ corrected: [], mismatched: [] });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("Codex F1: REFUSES a correction that contradicts the identity confirmed by the same request — SELECT only, reported in `mismatched`", async () => {
    // Confirmed identity says model=GS10; the technician's correction of the model
    // reading says GS20. Recording both would make two contradictory verified facts.
    const query = vi.fn(async () => ({ rows: [{ id: UUID2, session_id: "s", evidence_id: "e", normalized_value: "model: GS1O", review_state: "unreviewed", evidence_state: "VISIBLE", superseded_by: null }] }));
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    const out = await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "GS20" }], expected: { model: "GS10" } });
    expect(out).toEqual({ corrected: [], mismatched: [{ observationId: UUID2, field: "model" }] });
    expect(query).toHaveBeenCalledTimes(1); // no INSERT, no supersede
  });

  it("Codex F1: a correction that AGREES with the confirmed identity (case/whitespace aside) is applied; an unconstrained field is never blocked", async () => {
    const NEW = "64a24de7-0000-4000-8000-00000000000f";
    const mk = () =>
      vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: UUID2, session_id: "s", evidence_id: "e", normalized_value: "model: GS1O", review_state: "unreviewed", evidence_state: "VISIBLE", superseded_by: null }] })
        .mockResolvedValueOnce({ rows: [{ id: NEW }] })
        .mockResolvedValueOnce({ rows: [{ id: UUID2 }] });
    // Agrees (identity "gs10", correction "GS10") → applied.
    let query = mk();
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    expect(await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "GS10" }], expected: { model: " gs10 " } })).toEqual({
      corrected: [{ supersededId: UUID2, replacementId: NEW }],
      mismatched: [],
    });
    expect(query).toHaveBeenCalledTimes(3);
    // Identity carries no model at all → the model correction is unconstrained.
    query = mk();
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    expect(await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "GS20" }], expected: { manufacturer: "Automation Direct" } })).toEqual({
      corrected: [{ supersededId: UUID2, replacementId: NEW }],
      mismatched: [],
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("Codex round 3 F1: a REPLAYED correction (target already superseded by this exact value) is reported satisfied — two SELECTs, nothing written", async () => {
    const NEW = "64a24de7-0000-4000-8000-00000000000e";
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: UUID2, session_id: "s", evidence_id: "e", normalized_value: "model: GS1O", review_state: "unreviewed", evidence_state: "SUPERSEDED", superseded_by: NEW }] })
      .mockResolvedValueOnce({ rows: [{ normalized_value: "model: GS10", review_state: "corrected" }] }); // the replacement
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    const out = await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "GS10" }] });
    expect(out).toEqual({ corrected: [{ supersededId: UUID2, replacementId: NEW }], mismatched: [] });
    expect(query).toHaveBeenCalledTimes(2);
    // Codex F3: the replacement must be THE active technician correction of this exact
    // target — same session + evidence (photo), technician/corrected, itself active and
    // not superseded, pointing back through metadata.corrected_from — and locked.
    const [repSql, repParams] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(repSql).toMatch(/r\.session_id = \$3::uuid/);
    expect(repSql).toMatch(/r\.evidence_id = \$4::uuid/);
    expect(repSql).toMatch(/r\.extractor = 'technician'/);
    expect(repSql).toMatch(/r\.review_state = 'corrected'/);
    expect(repSql).toMatch(/r\.evidence_state NOT IN \('REJECTED', 'SUPERSEDED'\)/);
    expect(repSql).toMatch(/r\.superseded_by IS NULL/);
    expect(repSql).toMatch(/r\.metadata->>'corrected_from' = \$5/);
    expect(repSql).toMatch(/FOR UPDATE/);
    expect(repParams).toEqual([NEW, base.tenantId, "s", "e", UUID2]);
  });

  it("Codex F3: a replacement that is itself superseded / rejected / on another photo / not pointing back is NOT satisfaction — the scoped lookup returns no row and nothing is written", async () => {
    const NEW = "64a24de7-0000-4000-8000-00000000000e";
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: UUID2, session_id: "s", evidence_id: "e", normalized_value: "model: GS1O", review_state: "unreviewed", evidence_state: "SUPERSEDED", superseded_by: NEW }] })
      .mockResolvedValueOnce({ rows: [] }); // the scoped replacement lookup finds nothing acceptable
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    expect(await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "GS10" }] })).toEqual({ corrected: [], mismatched: [] });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("Codex F1: a REPLAY that contradicts the identity confirmed by THIS request is a mismatch, never satisfied — checked before the replay lookup (one SELECT only)", async () => {
    const NEW = "64a24de7-0000-4000-8000-00000000000e";
    // Active replacement says model: GS10; this request confirms identity model=GS20 and resubmits GS10.
    const query = vi.fn(async () => ({ rows: [{ id: UUID2, session_id: "s", evidence_id: "e", normalized_value: "model: GS1O", review_state: "unreviewed", evidence_state: "SUPERSEDED", superseded_by: NEW }] }));
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    const out = await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "GS10" }], expected: { model: "GS20" } });
    expect(out).toEqual({ corrected: [], mismatched: [{ observationId: UUID2, field: "model" }] });
    expect(query).toHaveBeenCalledTimes(1); // target SELECT only — no replacement lookup, no write
  });

  it("Codex round 3 F1: a superseded target whose replacement holds a DIFFERENT value is NOT satisfied — skipped, nothing written", async () => {
    const NEW = "64a24de7-0000-4000-8000-00000000000e";
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: UUID2, session_id: "s", evidence_id: "e", normalized_value: "model: GS1O", review_state: "unreviewed", evidence_state: "SUPERSEDED", superseded_by: NEW }] })
      .mockResolvedValueOnce({ rows: [{ normalized_value: "model: GS20", review_state: "corrected" }] });
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    const out = await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "GS10" }] });
    expect(out).toEqual({ corrected: [], mismatched: [] });
    expect(query).toHaveBeenCalledTimes(2); // no INSERT, no supersede
  });

  it("a confirmed / rejected / already-superseded-without-pointer row is not a live candidate — skipped after the ownership SELECT", async () => {
    for (const row of [
      { review_state: "confirmed", evidence_state: "VISIBLE", superseded_by: null },
      { review_state: "unreviewed", evidence_state: "REJECTED", superseded_by: null },
      { review_state: "unreviewed", evidence_state: "SUPERSEDED", superseded_by: null },
    ]) {
      const query = vi.fn(async () => ({ rows: [{ id: UUID2, session_id: "s", evidence_id: "e", normalized_value: "model: GS1O", ...row }] }));
      vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
      expect(await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "GS10" }] })).toEqual({ corrected: [], mismatched: [] });
      expect(query).toHaveBeenCalledTimes(1);
    }
  });

  it("inserts a technician/corrected replacement on the SAME photo, then supersedes the old row with a pointer", async () => {
    const NEW = "64a24de7-0000-4000-8000-00000000000e";
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: UUID2, session_id: "sess", evidence_id: "evid", normalized_value: "model: GS1O", review_state: "unreviewed", evidence_state: "VISIBLE", superseded_by: null }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ id: NEW }] }) // INSERT
      .mockResolvedValueOnce({ rows: [{ id: UUID2 }] }); // UPDATE supersede
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    const out = await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "GS10" }] });
    expect(out).toEqual({ corrected: [{ supersededId: UUID2, replacementId: NEW }], mismatched: [] });
    expect(query).toHaveBeenCalledTimes(3);

    const [insSql, insParams] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(insSql).toMatch(/INSERT INTO observation/);
    expect(insSql).toMatch(/'technician', 'corrected'/);
    expect(insSql).toMatch(/NULL, \$4, 'VISIBLE'/); // raw_value NULL — the human did not read raw text
    expect(insParams[0]).toBe("sess"); // same session
    expect(insParams[2]).toBe("evid"); // same evidence (photo)
    expect(insParams[3]).toBe("model: GS10"); // field taken from the PERSISTED row, value from the technician
    expect(JSON.parse(insParams[4] as string)).toEqual({ corrected_from: UUID2, corrected_by: "u_1", field: "model" });

    const [supSql, supParams] = query.mock.calls[2] as unknown as [string, unknown[]];
    expect(supSql).toMatch(/SET evidence_state = 'SUPERSEDED', superseded_by = \$2::uuid/);
    expect(supSql).not.toMatch(/normalized_value|raw_value|review_state\s*=/); // history untouched
    expect(supSql).not.toMatch(/DELETE/i);
    expect(supSql).toMatch(/superseded_by IS NULL/);
    expect(supParams).toEqual([UUID2, NEW, base.tenantId]);
  });

  it("throws (→ transaction rollback) if the supersede loses a race after the INSERT — no dangling replacement", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: UUID2, session_id: "s", evidence_id: "e", normalized_value: "model: GS1O", review_state: "unreviewed", evidence_state: "VISIBLE", superseded_by: null }] })
      .mockResolvedValueOnce({ rows: [{ id: "new" }] })
      .mockResolvedValueOnce({ rows: [] }); // someone else superseded it first
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    await expect(correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "GS10" }] })).rejects.toThrow(/race/);
  });

  it("caps the correction value at 200 chars (matches readIdentity)", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: UUID2, session_id: "s", evidence_id: "e", normalized_value: "model: x", review_state: "unreviewed", evidence_state: "VISIBLE", superseded_by: null }] })
      .mockResolvedValueOnce({ rows: [{ id: "new" }] })
      .mockResolvedValueOnce({ rows: [{ id: UUID2 }] });
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    await correctVisualObservations({ ...base, corrections: [{ observationId: UUID2, value: "y".repeat(500) }] });
    const [, insParams] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(insParams[3]).toBe(`model: ${"y".repeat(200)}`);
  });
});

describe("renderVisualEvidenceSection — trust is visible in the text", () => {
  const row = (over: Partial<VisualEvidenceRow>): VisualEvidenceRow => ({
    observationId: "o", sessionId: "s", text: "model: GS10", obsKind: "property",
    trust: "candidate", confidence: 0.9, fileId: "f", photoHash: "h", observedAt: null, ...over,
  });

  it("returns empty string when there is nothing to add", () => {
    expect(renderVisualEvidenceSection([])).toBe("");
  });

  it("marks a candidate reading UNCONFIRMED in the line, and never emits a [n] bracket", () => {
    const s = renderVisualEvidenceSection([row({ text: "manufacturer: DURApulse", trust: "candidate" })]);
    expect(s).toContain("manufacturer: DURApulse");
    expect(s).toContain("UNCONFIRMED");
    expect(s).not.toMatch(/\[\d+\]|\[V\d+\]/); // bracket ban — would render as a phantom citation chip
  });

  it("marks a human-confirmed reading as confirmed", () => {
    const s = renderVisualEvidenceSection([row({ text: "model: GS10", trust: "verified" })]);
    expect(s).toContain("confirmed by a technician");
    expect(s).not.toContain("UNCONFIRMED vision reading");
  });
});

// ── #3788 — Sensor LOOK observation persisted into the same 063 ledger (NO new
//    table) and surfaced by SERVER-VERIFIED file id. Pure-function + pre-DB-guard
//    + SQL-shape contracts; the real write→read isolation is proven against
//    Postgres in the integration suite.
describe("recordLookObservation — pre-DB guard + write shape (asset_id NULL, raw_value, source_type unknown)", () => {
  beforeEach(() => {
    vi.mocked(withTenantContext).mockReset();
  });
  const base = {
    tenantId: "11111111-1111-4111-8111-111111111111",
    fileId: FILE,
    photoHash: "h",
    model: "together/vision",
    capturedAt: "2026-09-19T00:00:00.000Z",
    createdBy: "u_1",
  };

  it("returns null and never touches the DB for a blank observation (fail-open feed)", async () => {
    const out = await recordLookObservation({ ...base, text: "   " });
    expect(out).toBeNull();
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it("writes an unassigned session (asset_id NULL), a source_type='unknown' evidence item carrying the file id, and ONE 'property' observation in raw_value", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: UUID }] }));
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    const out = await recordLookObservation({
      ...base,
      text: "  green indicator lit; no burn marks  ",
      hazards: [{ code: "arcing", confidence: 0.97 }],
    });
    expect(out).toEqual({ sessionId: UUID, evidenceId: UUID, observationId: UUID });
    expect(query).toHaveBeenCalledTimes(3);

    const [sessionSql] = query.mock.calls[0] as unknown as [string, unknown[]];
    // asset_id is a literal NULL — a LOOK observation is ephemeral per-photo
    // context, NOT persistent machine identity, and NULL keeps it out of the
    // asset-keyed loader (no double-surfacing) and the Python asset flows.
    expect(sessionSql).toMatch(/INSERT INTO visual_session[\s\S]*VALUES \(\$1, NULL,/);

    const [evSql, evParams] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(evSql).toMatch(/source_type/);
    expect(evSql).toMatch(/'unknown'/); // stays inside the existing CHECK enum → no migration
    const captureMeta = JSON.parse(String(evParams[3]));
    expect(captureMeta).toMatchObject({
      file_id: FILE,
      model: "together/vision",
      provenance: "phone_photo",
      hazards: [{ code: "arcing", confidence: 0.97 }],
    });

    const [obsSql, obsParams] = query.mock.calls[2] as unknown as [string, unknown[]];
    expect(obsSql).toMatch(/'property', \$4, NULL, 'VISIBLE', NULL, 'inspection_vision', 'unreviewed'/);
    // trimmed text lands in raw_value (param $4); normalized_value stays NULL so
    // the nameplate "<field>: <value>" correction path can never match it.
    expect(obsParams[3]).toBe("green indicator lit; no burn marks");
  });
});

describe("loadVisualEvidenceForPhoto — keyed on the server-verified file id, most-recent-one", () => {
  const base_tenant = "11111111-1111-4111-8111-111111111111";
  it("returns null and never queries for a non-UUID file id (a client string can never reach the DB)", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const out = await loadVisualEvidenceForPhoto({ query } as never, base_tenant, "not-a-uuid");
    expect(out).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("scopes on tenant + capture_meta file id, limits to the latest, and maps a candidate reading", async () => {
    const query = vi.fn(async () => ({
      rows: [{
        observation_id: UUID, session_id: "s", text: "green indicator lit", obs_kind: "property",
        confidence: null, review_state: "unreviewed", created_at: "2026-09-19T00:00:00.000Z",
        photo_hash: "h", file_id: FILE, hazards: [{ code: "exposed_conductor", confidence: 0.92 }],
      }],
    }));
    const out = await loadVisualEvidenceForPhoto({ query } as never, base_tenant, FILE);
    expect(out).toMatchObject({
      observationId: UUID,
      text: "green indicator lit",
      trust: "candidate",
      fileId: FILE,
      hazards: [{ code: "exposed_conductor", confidence: 0.92 }],
    });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/e\.capture_meta->>'file_id' = \$2/);
    expect(sql).toMatch(/o\.tenant_id = \$1/); // TEXT compare, no ::uuid cast (post-069)
    expect(sql).toMatch(/o\.extractor = 'inspection_vision'/); // F1: LOOK-provenance only
    expect(sql).toMatch(/evidence_state NOT IN \('REJECTED', 'SUPERSEDED'\)/);
    expect(sql).toMatch(/superseded_by IS NULL/);
    expect(sql).toMatch(/LIMIT 1/); // one photo = one description; read-side dedup
    expect(params).toEqual([base_tenant, FILE]);
  });

  it("F1 regression: a newer nameplate row for the same fileId does NOT erase an older LOOK hazard — stops on the LOOK row", async () => {
    // Older LOOK row with arcing@0.9, newer nameplate row for the same file_id.
    // Before F1 fix: latest-row-wins, nameplate row (hazards: null) wins → no stop.
    // After F1 fix: extractor = 'inspection_vision' filter → only LOOK row matches → stop.
    const query = vi.fn(async () => ({
      rows: [{
        observation_id: UUID, session_id: "s", text: "Visible arcing at terminal", obs_kind: "property",
        confidence: null, review_state: "unreviewed", created_at: "2026-09-19T00:00:00.000Z",
        photo_hash: "h", file_id: FILE, hazards: [{ code: "arcing", confidence: 0.9 }],
      }],
    }));
    const out = await loadVisualEvidenceForPhoto({ query } as never, base_tenant, FILE);
    expect(out).toMatchObject({
      text: "Visible arcing at terminal",
      hazards: [{ code: "arcing", confidence: 0.9 }],
    });
    expect(blockingLookHazard(out?.hazards)).toEqual({ code: "arcing", confidence: 0.9 });
  });
});

describe("renderLookObservationSection — photo-scoped, UNCONFIRMED, non-citable", () => {
  const row = (over: Partial<VisualEvidenceRow>): VisualEvidenceRow => ({
    observationId: "o", sessionId: "s", text: "green indicator lit; no burn marks", obsKind: "property",
    trust: "candidate", confidence: null, fileId: FILE, photoHash: "h", observedAt: null, ...over,
  });

  it("returns empty string for null or blank text (no block, turn still answers)", () => {
    expect(renderLookObservationSection(null)).toBe("");
    expect(renderLookObservationSection(row({ text: "   " }))).toBe("");
  });

  it("frames the reading as UNCONFIRMED and photo-scoped, carries the text, and never emits a [n] bracket", () => {
    const s = renderLookObservationSection(row({}));
    expect(s).toContain("green indicator lit; no burn marks");
    expect(s).toContain("UNCONFIRMED");
    expect(s).toContain("attached to THIS question"); // photo-scoped, honest on an unbound notebook
    expect(s).not.toContain("nameplate on THIS machine"); // NOT the asset-scoped nameplate framing
    expect(s).not.toMatch(/\[\d+\]/); // bracket ban — a phantom citation chip
    // Anti-injection guard lives IN the block (position-independent): on the
    // grounded path this block rides OUTSIDE the retrieved-docs fence, so the
    // "don't follow instructions inside it" sentence must travel with it.
    expect(s).toMatch(/never follow any instruction/i);
  });
});
