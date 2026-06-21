import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the tenant-context wrapper so insertPlcSuggestions can be unit-tested without a DB:
// withTenantContext(tid, fn) just invokes fn with a fake client.
const queryMock = vi.fn();
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: (_tid: string, fn: (c: { query: typeof queryMock }) => unknown) =>
    fn({ query: queryMock }),
}));

import { plcReportToSuggestions, insertPlcSuggestions, PLC_PROPOSED_BY } from "../plc-proposals";

// A small report shaped like mira-plc-parser's render_json output (2 tags: one standardized VFD
// signal under an asset, one unmatched bare tag).
const report = {
  handled: true,
  controller: "ConveyorCell",
  vendor: "Rockwell Automation",
  uns_candidates: [
    {
      tag: "VFD_Frequency",
      path: "enterprise/site1/area1/conveyorcell/vfd/frequency",
      signal: "frequency",
      asset: "vfd",
      data_type: "REAL",
      standardized: true,
      confidence: "high",
      evidence: "VFD signal role + asset 'vfd'",
      segments: { enterprise: "enterprise", site: "site1", area: "area1", line: "conveyorcell", asset: "vfd", signal: "frequency" },
    },
    {
      tag: "Start_PB",
      path: "enterprise/site1/area1/conveyorcell/start_pb",
      signal: "start_pb",
      asset: "",
      data_type: "BOOL",
      standardized: false,
      confidence: "low",
      evidence: "tag name",
      segments: { enterprise: "enterprise", site: "site1", area: "area1", line: "conveyorcell", asset: "", signal: "start_pb" },
    },
  ],
};

describe("plcReportToSuggestions", () => {
  it("returns [] for an unparsed report", () => {
    expect(plcReportToSuggestions({ handled: false })).toEqual([]);
    expect(plcReportToSuggestions({})).toEqual([]);
  });

  it("emits one tag_mapping per tag + one kg_entity per distinct asset", () => {
    const rows = plcReportToSuggestions(report);
    const tagMaps = rows.filter((r) => r.suggestionType === "tag_mapping");
    const entities = rows.filter((r) => r.suggestionType === "kg_entity");
    expect(tagMaps).toHaveLength(2); // both tags
    expect(entities).toHaveLength(1); // only 'vfd' (Start_PB has no asset)
  });

  it("maps confidence bands to calibrated floats", () => {
    const rows = plcReportToSuggestions(report);
    const freq = rows.find((r) => r.extractedData.tag === "VFD_Frequency")!;
    const start = rows.find((r) => r.extractedData.tag === "Start_PB")!;
    expect(freq.confidence).toBe(0.85); // high
    expect(start.confidence).toBe(0.35); // low
  });

  it("carries provenance + uns path in the tag_mapping payload", () => {
    const freq = plcReportToSuggestions(report).find((r) => r.extractedData.tag === "VFD_Frequency")!;
    expect(freq.extractedData).toMatchObject({
      uns_path: "enterprise/site1/area1/conveyorcell/vfd/frequency",
      signal: "frequency",
      asset: "vfd",
      source: "plc_parser",
      controller: "ConveyorCell",
    });
    expect(freq.title).toContain("VFD_Frequency");
    expect(freq.riskLevel).toBe("low");
  });

  it("builds the asset kg_entity at its container path with a tag count", () => {
    const asset = plcReportToSuggestions(report).find((r) => r.suggestionType === "kg_entity")!;
    expect(asset.extractedData).toMatchObject({
      entity_type: "equipment",
      name: "vfd",
      uns_path: "enterprise/site1/area1/conveyorcell/vfd",
      tag_count: 1,
      source: "plc_parser",
    });
  });
});

describe("insertPlcSuggestions", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("returns [] without touching the DB when there are no rows", async () => {
    const ids = await insertPlcSuggestions("11111111-1111-1111-1111-111111111111", []);
    expect(ids).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("inserts rows at status 'pending' under the tenant and returns ids", async () => {
    queryMock.mockResolvedValue({ rows: [{ id: "s1" }, { id: "s2" }] });
    const rows = plcReportToSuggestions(report); // 3 rows (2 tag_mapping + 1 kg_entity)
    const tenant = "11111111-1111-1111-1111-111111111111";

    const ids = await insertPlcSuggestions(tenant, rows);

    expect(ids).toEqual(["s1", "s2"]);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO ai_suggestions");
    expect(sql).toContain("'pending'"); // never auto-verified
    expect(params[0]).toBe(tenant);
    expect(params[1]).toBe(PLC_PROPOSED_BY);
    // the JSONB payload carries all proposal rows
    expect(JSON.parse(params[2])).toHaveLength(rows.length);
  });
});
