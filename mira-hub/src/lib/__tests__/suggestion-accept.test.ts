import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks referenced inside vi.mock factories must be created via vi.hoisted (factories are hoisted
// above top-level const declarations).
const { queryMock, transitionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  transitionMock: vi.fn(),
}));

// Fake DB client state: SELECT ai_suggestions returns the seeded row; INSERT kg_entities returns id.
let suggestionRow: Record<string, unknown> | null = null;

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: (_tid: string, fn: (c: { query: typeof queryMock }) => unknown) =>
    fn({ query: queryMock }),
}));
vi.mock("@/lib/proposal-transition", () => ({ applyHubProposalTransition: transitionMock }));

import { decideSuggestion, unsPathToLtree, mapTagDataType } from "../suggestion-accept";

const TENANT = "11111111-1111-1111-1111-111111111111";
const ID = "22222222-2222-2222-2222-222222222222";

function kgEntitySuggestion(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    suggestion_type: "kg_entity",
    status: "pending",
    extracted_data: {
      entity_type: "equipment",
      name: "vfd",
      uns_path: "enterprise/site1/area1/conveyorcell/vfd",
    },
    ...over,
  };
}

function tagMappingSuggestion(extracted: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  return {
    id: ID,
    suggestion_type: "tag_mapping",
    status: "pending",
    extracted_data: {
      tag: "Conv_Fault",
      uns_path: "enterprise/site1/area1/line1/conv/fault",
      signal: "fault",
      asset: "conv",
      data_type: "BOOL",
      confidence_band: "high",
      evidence: "VFD signal role + asset 'conv'",
      controller: "ConveyorControl",
      vendor: "Rockwell Automation",
      ...extracted,
    },
    ...over,
  };
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (/SELECT[\s\S]*FROM ai_suggestions/.test(sql)) {
      return { rows: suggestionRow ? [suggestionRow] : [] };
    }
    if (/INSERT INTO kg_entities/.test(sql)) {
      return { rows: [{ id: "kg-1" }] };
    }
    if (/INSERT INTO tag_entities/.test(sql)) {
      return { rows: [{ id: "tag-1" }] };
    }
    if (/INSERT INTO approved_tags/.test(sql)) {
      return { rows: [] };
    }
    return { rows: [] };
  });
  transitionMock.mockReset();
  transitionMock.mockResolvedValue({});
  suggestionRow = kgEntitySuggestion();
});

describe("unsPathToLtree", () => {
  it("converts slash topic paths to dot ltree label paths", () => {
    expect(unsPathToLtree("enterprise/site1/area1/conveyorcell/vfd")).toBe(
      "enterprise.site1.area1.conveyorcell.vfd",
    );
    expect(unsPathToLtree("/a//b/")).toBe("a.b");
  });
});

describe("mapTagDataType", () => {
  it("maps declared PLC/IEC types to the tag_entities enum (case-insensitive)", () => {
    expect(mapTagDataType("BOOL")).toBe("BOOL");
    expect(mapTagDataType("dint")).toBe("INT32");
    expect(mapTagDataType("WORD")).toBe("UINT16"); // bit-string → unsigned of matching width
    expect(mapTagDataType("REAL")).toBe("REAL");
    expect(mapTagDataType("LREAL")).toBe("LREAL");
  });
  it("returns null for empty/unknown types so the caller skips materialization", () => {
    expect(mapTagDataType("")).toBeNull();
    expect(mapTagDataType("WIDGET_T")).toBeNull();
    expect(mapTagDataType(undefined)).toBeNull();
    expect(mapTagDataType(123)).toBeNull();
  });
});

describe("decideSuggestion", () => {
  it("verify of a kg_entity creates a VERIFIED kg_entities row with a dotted uns_path", async () => {
    const res = await decideSuggestion(TENANT, "u1", ID, "verify", "looks right");
    expect(res).toEqual({ kind: "ok", decision: "verify", status: "accepted", entityId: "kg-1" });

    // status transitioned via the helper (not a raw UPDATE), targeting the ai_suggestion id
    expect(transitionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trigger: "accept", aiSuggestionId: ID }),
    );
    // entity created: verified + ltree-converted path
    const insert = queryMock.mock.calls.find(([sql]) => /INSERT INTO kg_entities/.test(sql))!;
    expect(insert[0]).toContain("'verified'");
    expect(insert[1]).toEqual([
      "equipment",
      "vfd",
      "enterprise.site1.area1.conveyorcell.vfd",
      TENANT,
    ]);
  });

  it("verify of a typed tag_mapping creates a VERIFIED tag_entities row (dotted path, mapped type)", async () => {
    suggestionRow = tagMappingSuggestion();
    const res = await decideSuggestion(TENANT, "u1", ID, "verify", "");
    expect(res).toEqual({ kind: "ok", decision: "verify", status: "accepted", entityId: "tag-1" });

    expect(transitionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trigger: "accept", aiSuggestionId: ID }),
    );
    const insert = queryMock.mock.calls.find(([sql]) => /INSERT INTO tag_entities/.test(sql))!;
    expect(insert[0]).toContain("'verified'");
    expect(insert[0]).toContain("ON CONFLICT (tenant_id, uns_path)");
    // [tenantId, unsPath(dotted), symbolic, dataType(mapped), source_address(=symbolic), evidence(json)]
    expect(insert[1].slice(0, 5)).toEqual([
      TENANT,
      "enterprise.site1.area1.line1.conv.fault",
      "Conv_Fault",
      "BOOL",
      "Conv_Fault",
    ]);
    // no kg_entities write for a tag_mapping
    expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO kg_entities/.test(sql))).toBe(false);
  });

  it("verify of a name-only tag_mapping (no declarable type) transitions but creates no tag_entity", async () => {
    suggestionRow = tagMappingSuggestion({ data_type: "" });
    const res = await decideSuggestion(TENANT, "u1", ID, "verify", "");
    expect(res).toMatchObject({ kind: "ok", status: "accepted", entityId: null });
    expect(transitionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trigger: "accept" }),
    );
    expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO tag_entities/.test(sql))).toBe(false);
  });

  it("verify of a tag_mapping with an unmappable type transitions but creates no tag_entity", async () => {
    suggestionRow = tagMappingSuggestion({ data_type: "WIDGET_T" });
    const res = await decideSuggestion(TENANT, "u1", ID, "verify", "");
    expect(res).toMatchObject({ kind: "ok", entityId: null });
    expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO tag_entities/.test(sql))).toBe(false);
  });

  it("reject of a tag_mapping transitions status and creates no tag_entity", async () => {
    suggestionRow = tagMappingSuggestion();
    const res = await decideSuggestion(TENANT, "u1", ID, "reject", "wrong tag");
    expect(res).toMatchObject({ kind: "ok", decision: "reject", status: "rejected", entityId: null });
    expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO tag_entities/.test(sql))).toBe(false);
  });

  it("reject transitions status and creates no entity", async () => {
    const res = await decideSuggestion(TENANT, "u1", ID, "reject", "wrong asset");
    expect(res).toMatchObject({ kind: "ok", decision: "reject", status: "rejected", entityId: null });
    expect(transitionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trigger: "reject", aiSuggestionId: ID }),
    );
    expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO kg_entities/.test(sql))).toBe(false);
  });

  it("kg_entity with no usable path/name transitions but skips entity creation", async () => {
    suggestionRow = kgEntitySuggestion({ extracted_data: { entity_type: "equipment" } });
    const res = await decideSuggestion(TENANT, "u1", ID, "verify", "");
    expect(res).toMatchObject({ kind: "ok", entityId: null });
    expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO kg_entities/.test(sql))).toBe(false);
  });

  it("returns not_found when the suggestion is absent (no transition)", async () => {
    suggestionRow = null;
    const res = await decideSuggestion(TENANT, "u1", ID, "verify", "");
    expect(res).toEqual({ kind: "not_found" });
    expect(transitionMock).not.toHaveBeenCalled();
  });

  it("returns wrong_state for an already-decided suggestion (no transition)", async () => {
    suggestionRow = kgEntitySuggestion({ status: "accepted" });
    const res = await decideSuggestion(TENANT, "u1", ID, "verify", "");
    expect(res).toEqual({ kind: "wrong_state", status: "accepted" });
    expect(transitionMock).not.toHaveBeenCalled();
  });
});

// T5 (master plan): accepted tag_mapping proposals feed the ingest allowlist. Seam 6,
// docs/discovery/integration-seams-register.md.
describe("decideSuggestion — T5 approved_tags ingest bridge", () => {
  function approvedTagsCalls() {
    return queryMock.mock.calls.filter(([sql]) => /INSERT INTO approved_tags/.test(sql));
  }

  it("verify of a typed tag_mapping upserts an ENABLED approved_tags row with the normalized path", async () => {
    suggestionRow = tagMappingSuggestion();
    const res = await decideSuggestion(TENANT, "u1", ID, "verify", "");
    expect(res).toMatchObject({ kind: "ok", decision: "verify", status: "accepted", entityId: "tag-1" });

    const calls = approvedTagsCalls();
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    expect(sql).toContain("ON CONFLICT (tenant_id, source_system, source_tag_path) DO UPDATE");
    expect(sql).toContain("enabled = true");
    // [tenantId, source_system, source_tag_path(raw symbol), normalized_tag_path, uns_path(dotted), notes]
    // (enabled=true is a literal in the SQL, not a bound param — see suggestion-accept.ts)
    expect(params).toEqual([
      TENANT,
      "ignition",
      "Conv_Fault",
      "conv_fault",
      "enterprise.site1.area1.line1.conv.fault",
      "plc_import_bridge",
    ]);
  });

  it("verify of a name-only tag_mapping (no declarable type) touches neither tag_entities nor approved_tags", async () => {
    suggestionRow = tagMappingSuggestion({ data_type: "" });
    await decideSuggestion(TENANT, "u1", ID, "verify", "");
    expect(approvedTagsCalls()).toHaveLength(0);
  });

  it("reject of a tag_mapping does NOT touch approved_tags", async () => {
    suggestionRow = tagMappingSuggestion();
    const res = await decideSuggestion(TENANT, "u1", ID, "reject", "wrong tag");
    expect(res).toMatchObject({ kind: "ok", decision: "reject", status: "rejected", entityId: null });
    expect(approvedTagsCalls()).toHaveLength(0);
  });

  it("verify of a kg_entity proposal does NOT touch approved_tags", async () => {
    const res = await decideSuggestion(TENANT, "u1", ID, "verify", "looks right");
    expect(res).toMatchObject({ kind: "ok", entityId: "kg-1" });
    expect(approvedTagsCalls()).toHaveLength(0);
  });

  it("re-accepting the same raw tag (a second suggestion) is idempotent — same upsert, no error", async () => {
    // First accept.
    suggestionRow = tagMappingSuggestion();
    const first = await decideSuggestion(TENANT, "u1", ID, "verify", "");
    expect(first).toMatchObject({ kind: "ok", entityId: "tag-1" });

    // Second accept — e.g. a re-import producing a new ai_suggestions row for the same raw tag
    // (tag_entities' own ON CONFLICT (tenant_id, uns_path) already upserts this case; the
    // approved_tags upsert must tolerate it the same way).
    const ID2 = "33333333-3333-3333-3333-333333333333";
    suggestionRow = tagMappingSuggestion({}, { id: ID2 });
    const second = await decideSuggestion(TENANT, "u1", ID2, "verify", "");
    expect(second).toMatchObject({ kind: "ok", entityId: "tag-1" });

    const calls = approvedTagsCalls();
    expect(calls).toHaveLength(2);
    // Both upserts target the identical conflict key and set enabled=true — idempotent by
    // construction (ON CONFLICT DO UPDATE), never a duplicate-key error.
    expect(calls[0][1]).toEqual(calls[1][1]);
  });
});
