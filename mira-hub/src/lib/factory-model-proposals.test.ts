// Vitest coverage for the Phase 1 FactoryModel -> ai_suggestions writer (Phase 5 PR-1).
//
// Run: cd mira-hub && npx vitest run src/lib/factory-model-proposals
//
// The pure transform is DB-free. The insert is exercised against a mocked withTenantContext to assert
// it INSERTs (never UPDATEs a status — ADR-0017 transitions go through the helper, not this writer).

import { describe, it, expect, vi } from "vitest";

const calls: { text: string; params?: unknown[] }[] = [];
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: async (_tenantId: string, fn: (c: unknown) => unknown) =>
    fn({
      query: async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        return { rows: [{ id: "sug-1" }], rowCount: 1 };
      },
    }),
}));

import {
  factoryModelToSuggestions,
  insertFactoryModelSuggestions,
  FACTORY_MODEL_PROPOSED_BY,
} from "@/lib/factory-model-proposals";

// A small SYNTHETIC FactoryModel (the factory_context shape). No licensed data.
const ASSET_UNS = "synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01";
const SAMPLE = {
  source: "discovery_corpus/fixtures/synthetic_factory_export.json",
  nodes: [
    {
      level: "asset",
      uns_path: ASSET_UNS,
      name: "Conveyor01",
      udt_type: "Models/Equipment/Process/Conveyor",
      suggestion: {
        confidence: "high",
        status: "suggested",
        statement: "Asset 'Conveyor01' is structurally present in the export.",
        approval_needed: "Confirm this asset and its placement.",
        evidence: [
          {
            source_file: "synthetic_factory_export.json",
            source_format: "ignition_json",
            locator: ".../Conveyor01",
            detail: "UdtInstance equipment boundary",
          },
        ],
      },
    },
    {
      level: "signal",
      uns_path: `${ASSET_UNS}.status.photoeye_blocked_value_value`,
      name: "Photoeye.Blocked.Value.Value",
      archetype: "live_bool",
      suggestion: {
        confidence: "medium",
        status: "suggested",
        statement: "Signal inferred as live_bool.",
        evidence: [{ source_format: "ignition_json", locator: ".../Photoeye" }],
      },
    },
    {
      level: "signal",
      uns_path: "", // static UDT metadata — no UNS path, must be skipped
      name: "Counts.Outfeed.Value.NumberFormat",
      archetype: "static_metadata",
      suggestion: { confidence: "high", status: "suggested", evidence: [] },
    },
    {
      level: "signal",
      uns_path: `${ASSET_UNS}.unclassified.weird_tag`,
      name: "Weird.Tag",
      archetype: "unknown",
      suggestion: { confidence: "low", status: "needs_review", evidence: [] },
    },
    {
      level: "line",
      uns_path: "synthetic_beverage_co.demo_site.bottling.bottlingline1",
      name: "BottlingLine1",
      suggestion: { confidence: "high", status: "suggested" },
    },
  ],
};

describe("factoryModelToSuggestions", () => {
  const rows = factoryModelToSuggestions(SAMPLE);

  it("emits a kg_entity per asset with the keys createKgEntity reads", () => {
    const assets = rows.filter((r) => r.suggestionType === "kg_entity");
    expect(assets.length).toBe(1);
    const a = assets[0];
    expect(a.extractedData.entity_type).toBe("equipment");
    expect(a.extractedData.name).toBe("Conveyor01");
    expect(a.extractedData.uns_path).toBe(ASSET_UNS);
    expect(a.confidence).toBeCloseTo(0.85);
    expect(a.status).toBe("pending");
  });

  it("emits a tag_mapping per live signal with a mappable data_type (createTagEntity)", () => {
    const photoeye = rows.find((r) => r.extractedData.tag === "Photoeye.Blocked.Value.Value");
    expect(photoeye).toBeTruthy();
    expect(photoeye!.suggestionType).toBe("tag_mapping");
    expect(photoeye!.extractedData.uns_path).toBe(`${ASSET_UNS}.status.photoeye_blocked_value_value`);
    expect(photoeye!.extractedData.data_type).toBe("BOOL");
    expect(photoeye!.status).toBe("pending");
  });

  it("skips static-metadata signals (no UNS path)", () => {
    expect(rows.find((r) => r.title.includes("NumberFormat"))).toBeUndefined();
  });

  it("marks uncertain (unknown-archetype) signals needs_review", () => {
    const weird = rows.find((r) => r.extractedData.tag === "Weird.Tag");
    expect(weird).toBeTruthy();
    expect(weird!.status).toBe("needs_review");
    expect(weird!.riskLevel).toBe("medium");
    expect(weird!.extractedData.data_type).toBe(""); // unresolved → won't materialize on accept
  });

  it("preserves evidence + confidence band + source in extracted_data", () => {
    const a = rows.find((r) => r.suggestionType === "kg_entity")!;
    expect(Array.isArray(a.extractedData.evidence)).toBe(true);
    expect((a.extractedData.evidence as unknown[]).length).toBe(1);
    expect(a.extractedData.confidence_band).toBe("high");
    expect(String(a.extractedData.source)).toContain("synthetic");
    expect(a.body).toContain("Evidence:");
  });

  it("never emits an approved/accepted status (no auto-approval)", () => {
    for (const r of rows) expect(["pending", "needs_review"]).toContain(r.status);
  });

  it("ignores container levels (enterprise/site/area/line/cell)", () => {
    expect(rows.find((r) => r.extractedData.name === "BottlingLine1")).toBeUndefined();
    expect(rows.length).toBe(3); // 1 asset + 2 signals (photoeye + weird); metadata + line skipped
  });

  it("returns [] for an empty / invalid model", () => {
    expect(factoryModelToSuggestions({})).toEqual([]);
    expect(factoryModelToSuggestions(null)).toEqual([]);
    expect(factoryModelToSuggestions({ nodes: [] })).toEqual([]);
  });
});

describe("insertFactoryModelSuggestions", () => {
  it("INSERTs into ai_suggestions with per-row status and NO raw status UPDATE", async () => {
    calls.length = 0;
    const rows = factoryModelToSuggestions(SAMPLE);
    const ids = await insertFactoryModelSuggestions("11111111-1111-1111-1111-111111111111", rows);
    expect(ids).toEqual(["sug-1"]);
    expect(calls.length).toBe(1);
    expect(calls[0].text).toMatch(/INSERT INTO ai_suggestions/);
    expect(calls[0].text).not.toMatch(/UPDATE\s+ai_suggestions/i);
    expect(calls[0].params).toContain(FACTORY_MODEL_PROPOSED_BY);

    // The payload carries both pending and needs_review — never accepted/approved.
    const payload = JSON.parse((calls[0].params as unknown[])[2] as string) as { status: string }[];
    const statuses = new Set(payload.map((p) => p.status));
    expect(statuses.has("pending")).toBe(true);
    expect(statuses.has("needs_review")).toBe(true);
    expect(statuses.has("accepted")).toBe(false);
    expect(statuses.has("approved")).toBe(false);
  });

  it("returns [] for an empty row set without touching the DB", async () => {
    calls.length = 0;
    const ids = await insertFactoryModelSuggestions("t", []);
    expect(ids).toEqual([]);
    expect(calls.length).toBe(0);
  });
});
