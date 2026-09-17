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
  isUuidKey,
  loadVisualEvidenceForAsset,
  promoteVisualObservations,
  recordNameplateObservations,
  renderVisualEvidenceSection,
  type VisualEvidenceRow,
} from "../visual-evidence-context";

const UUID = "64a24de7-0000-4000-8000-000000000001";
const UUID2 = "64a24de7-0000-4000-8000-000000000002";
const FILE = "f11a1111-1111-4111-8111-111111111111";

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
