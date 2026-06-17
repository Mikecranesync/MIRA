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

import { decideSuggestion, unsPathToLtree } from "../suggestion-accept";

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

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (/SELECT[\s\S]*FROM ai_suggestions/.test(sql)) {
      return { rows: suggestionRow ? [suggestionRow] : [] };
    }
    if (/INSERT INTO kg_entities/.test(sql)) {
      return { rows: [{ id: "kg-1" }] };
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

  it("verify of a tag_mapping transitions status but creates no entity", async () => {
    suggestionRow = kgEntitySuggestion({ suggestion_type: "tag_mapping" });
    const res = await decideSuggestion(TENANT, "u1", ID, "verify", "");
    expect(res).toMatchObject({ kind: "ok", status: "accepted", entityId: null });
    expect(transitionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trigger: "accept" }),
    );
    expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO kg_entities/.test(sql))).toBe(false);
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
