/**
 * Visual-evidence context (Slice 1). Pure-function contracts: the UUID guard,
 * the trust mapping, and the trust-visible-in-text renderer. The SQL execution
 * (write→read, isolation, active filter, label-independence) is proven
 * separately against real Postgres — a mock client returns rows regardless of
 * SQL, so it can prove the mapping, never the query. `recordNameplateObservations`
 * and `loadVisualEvidenceForAsset` are additionally guarded here for the paths
 * that return BEFORE touching the database.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
vi.mock("@/lib/workspace-files", () => ({ sha256Hex: (b: Buffer) => `sha:${b.length}` }));

import {
  isUuidKey,
  loadVisualEvidenceForAsset,
  recordNameplateObservations,
  renderVisualEvidenceSection,
  type VisualEvidenceRow,
} from "../visual-evidence-context";

const UUID = "64a24de7-0000-4000-8000-000000000001";

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
    const sql = (c.query.mock.calls[0][0] as string);
    expect(sql).toMatch(/vs\.asset_id = \$2::uuid/);
    expect(sql).toMatch(/evidence_state NOT IN \('REJECTED', 'SUPERSEDED'\)/);
    expect(sql).not.toMatch(/display_name|asset_tag|uns_path/);
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
