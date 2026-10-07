/**
 * F004 contract v2 §3 — the deterministic precedence table, the capability and
 * flag gates, and the ownership predicates of the fallback-link lookup.
 *
 * Run: cd mira-hub && ./node_modules/.bin/vitest run src/capabilities/__tests__/grounding-status.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildGroundingStatus,
  countUnresolvedMarkers,
  declaresGroundingStatus,
  groundingStatusEnabled,
  returnedDocIdsOf,
  showGroundingStatus,
  withoutUndeclaredGroundingStatus,
  type GroundingStatusInputs,
} from "../grounding-status";

const queries = vi.hoisted(() => ({ calls: [] as { sql: string; values: unknown[] }[], rows: [] as unknown[] }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string, values: unknown[]) => {
        queries.calls.push({ sql, values });
        return { rows: queries.rows };
      }),
    }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));

import { getFallbackSourceTurn } from "@/lib/equipment-notebooks";

const DOC = "33333333-3333-4333-8333-333333333333";
const passage = { docId: DOC, sourceUrl: "node:m", sourcePage: 4 };

/** An unbound notebook, the manual selected, one passage retrieved, answered. */
const base: GroundingStatusInputs = {
  terminalSafetyStop: false,
  stopped: false,
  modelCalled: true,
  served: true,
  refused: false,
  general: false,
  retrievalAttempted: true,
  retrievalUnavailable: false,
  scopeDocIds: [DOC],
  passages: [passage],
  emittedCitations: [],
  unresolvedMarkerCount: 0,
  notebookBound: false,
  fallbackOf: null,
};
const b = (over: Partial<GroundingStatusInputs>) => buildGroundingStatus({ ...base, ...over });

describe("B1 — the §3 precedence table, row by row", () => {
  const rows: [string, Partial<GroundingStatusInputs>, Record<string, unknown>][] = [
    ["1 safety stop beats everything", { terminalSafetyStop: true, stopped: true, emittedCitations: [{ docId: DOC }] }, { outcome: "safety_stop", citation: { status: "not_applicable" } }],
    ["2 stop beats provider error and citations", { stopped: true, served: false, emittedCitations: [{ docId: DOC }] }, { outcome: "stopped" }],
    ["3 provider error", { served: false }, { outcome: "provider_error", citation: { status: "not_applicable" } }],
    ["4 abstain, library unreachable", { modelCalled: false, served: false, passages: [], retrievalUnavailable: true }, { outcome: "abstained_retrieval_unavailable", retrieval: { status: "unavailable" } }],
    ["5 abstain, no passages", { modelCalled: false, served: false, passages: [] }, { outcome: "abstained_no_passages", retrieval: { status: "no_passages", passageCount: 0 } }],
    ["6 refused with passages", { refused: true }, { outcome: "refused_with_passages", retrieval: { status: "passages_found" }, citation: { status: "refused" } }],
    ["7 refused without passages", { refused: true, passages: [] }, { outcome: "refused_without_passages", retrieval: { status: "no_passages" } }],
    ["8 citation linked", { emittedCitations: [{ docId: DOC }] }, { outcome: "answered_citation_linked", citation: { status: "linked", linkedDocIds: [DOC] }, manualCited: true }],
    ["9 passages, uncited", { unresolvedMarkerCount: 2 }, { outcome: "answered_uncited_with_passages", citation: { status: "uncited", unresolvedMarkerCount: 2 } }],
    ["10 general mode", { general: true, retrievalAttempted: false, passages: [] }, { outcome: "answered_without_manual", retrieval: { status: "not_attempted", notAttemptedReason: "general_mode" } }],
    ["10 no manual scope", { retrievalAttempted: false, passages: [], scopeDocIds: [] }, { outcome: "answered_without_manual", retrieval: { status: "not_attempted", notAttemptedReason: "no_manual_scope" } }],
  ];
  for (const [name, over, expected] of rows) {
    it(`row ${name}`, () => expect(b(over)).toMatchObject(expected));
  }
});

describe("B2 — manualCited is derived from the citation status only", () => {
  it("is true only for a linked citation", () => {
    expect(b({ emittedCitations: [{ docId: DOC }] }).manualCited).toBe(true);
    for (const over of [{}, { refused: true }, { served: false }, { modelCalled: false, served: false, passages: [] }, { stopped: true }]) {
      expect(b(over).manualCited).toBe(false);
    }
  });
  it("passages alone never make an answer cited", () => {
    expect(b({ passages: [passage, passage, passage] })).toMatchObject({ manualCited: false, citation: { status: "uncited" } });
  });
});

describe("B3/B4 — when the general-guidance action is offered (rule F)", () => {
  it("never after a safety stop, a stop or a provider error", () => {
    expect(b({ terminalSafetyStop: true }).fallback.offered).toBe(false);
    expect(b({ stopped: true }).fallback.offered).toBe(false);
    expect(b({ served: false }).fallback.offered).toBe(false);
  });
  it("offered after an abstain, a refusal or an uncited answer on an unbound notebook with a selected manual", () => {
    expect(b({ modelCalled: false, served: false, passages: [] }).fallback.offered).toBe(true);
    expect(b({ refused: true }).fallback.offered).toBe(true);
    expect(b({}).fallback.offered).toBe(true);
  });
  it("never on a bound notebook, with no manual selected, in general mode, or after a linked citation", () => {
    expect(b({ notebookBound: true }).fallback.offered).toBe(false);
    expect(b({ notebookBound: true, refused: true }).fallback.offered).toBe(false);
    expect(b({ scopeDocIds: [] }).fallback.offered).toBe(false);
    expect(b({ general: true, refused: true }).fallback.offered).toBe(false);
    expect(b({ emittedCitations: [{ docId: DOC }] }).fallback.offered).toBe(false);
  });
  it("records the link it was asked from", () => {
    expect(b({ general: true, fallbackOf: "t-1" }).fallback).toEqual({ offered: false, of: "t-1" });
  });
});

describe("B5 — content-free and bounded", () => {
  it("carries ids and counts only, never text", () => {
    const json = JSON.stringify(b({ passages: [{ ...passage, content: "secret manual text" } as never] }));
    expect(json).not.toMatch(/secret manual text|"content"|"text"|"answer"/);
  });
  it("caps id lists at 32", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ docId: `d${i}` }));
    const e = b({ passages: many, scopeDocIds: many.map((m) => m.docId), emittedCitations: many });
    expect(e.retrieval.returnedDocIds).toHaveLength(32);
    expect(e.retrieval.scopeDocIds).toHaveLength(32);
    expect(e.citation.linkedDocIds).toHaveLength(32);
    expect(e.retrieval.passageCount).toBe(50);
  });
  it("OEM passages are identified by url + page, like the evidence packet", () => {
    expect(returnedDocIdsOf([{ docId: null, sourceUrl: "https://oem/x.pdf", sourcePage: 9 }, { docId: DOC }])).toEqual([
      "https://oem/x.pdf#p9",
      DOC,
    ]);
  });
});

describe("unresolved citation markers", () => {
  it("counts distinct markers that match no retrieved passage", () => {
    const cites = [{ citationId: "1" }, { citationId: "2" }];
    expect(countUnresolvedMarkers("a [1] b [7] c [7] d [9]", cites)).toBe(2);
    expect(countUnresolvedMarkers("a [1] b [2]", cites)).toBe(0);
    expect(countUnresolvedMarkers("no markers", cites)).toBe(0);
  });
});

describe("flag and capability gates", () => {
  it("the flag is off unless explicitly on", () => {
    expect(groundingStatusEnabled({})).toBe(false);
    expect(groundingStatusEnabled({ NOTEBOOK_GROUNDING_STATUS_ENABLED: "0" })).toBe(false);
    expect(groundingStatusEnabled({ NOTEBOOK_GROUNDING_STATUS_ENABLED: "1" })).toBe(true);
    expect(groundingStatusEnabled({ NOTEBOOK_GROUNDING_STATUS_ENABLED: "true" })).toBe(true);
  });
  it("only an exact capability declaration counts", () => {
    expect(declaresGroundingStatus(["grounding_status_v1"])).toBe(true);
    expect(declaresGroundingStatus("x, grounding_status_v1")).toBe(true);
    expect(declaresGroundingStatus(["grounding_status_v2"])).toBe(false);
    expect(declaresGroundingStatus(undefined)).toBe(false);
    expect(declaresGroundingStatus([{ toString: () => "grounding_status_v1" }])).toBe(false);
  });
  it("shown only when BOTH the flag is on and the client declared it", () => {
    expect(showGroundingStatus(["grounding_status_v1"], { NOTEBOOK_GROUNDING_STATUS_ENABLED: "1" })).toBe(true);
    expect(showGroundingStatus(["grounding_status_v1"], {})).toBe(false);
    expect(showGroundingStatus([], { NOTEBOOK_GROUNDING_STATUS_ENABLED: "1" })).toBe(false);
  });
  it("saved history drops the entry for anyone it is not shown to, and only that entry", () => {
    const ev = [{ citationId: "1", docId: DOC }, { kind: "grounding_status" }, { kind: "safety_notice", trigger: "x" }];
    expect(withoutUndeclaredGroundingStatus(ev, false)).toEqual([ev[0], ev[2]]);
    expect(withoutUndeclaredGroundingStatus(ev, true)).toEqual(ev);
  });
});

describe("T7 — getFallbackSourceTurn is scoped by tenant, notebook, turn, STRICT owner and thread", () => {
  it("binds every predicate to its own parameter and excludes legacy ownerless rows", async () => {
    queries.calls = [];
    queries.rows = [{ id: "t-1", evidence: [{ kind: "grounding_status" }] }];
    const row = await getFallbackSourceTurn("ten", "nb", { ownerUserId: "u1", threadId: "thrd-1", turnId: "t-1" });
    expect(row).toEqual({ id: "t-1", evidence: [{ kind: "grounding_status" }] });
    const { sql, values } = queries.calls[0]!;
    const where = sql.replace(/\s+/g, " ");
    expect(where).toContain("tenant_id = $1::uuid");
    expect(where).toContain("notebook_id = $2::uuid");
    expect(where).toContain("id = $3::uuid");
    expect(where).toContain("owner_user_id = $4");
    expect(where).not.toMatch(/owner_user_id IS NULL/i);
    expect(where).toContain("thread_id IS NOT DISTINCT FROM $5");
    expect(where).toContain("client_request_state = 'complete'");
    expect(values).toEqual(["ten", "nb", "t-1", "u1", "thrd-1"]);
  });
  it("the legacy (pre-thread) conversation is matched as a NULL thread, not as the literal 'legacy'", async () => {
    queries.calls = [];
    queries.rows = [];
    await getFallbackSourceTurn("ten", "nb", { ownerUserId: "u1", threadId: null, turnId: "t-1" });
    expect(queries.calls[0]!.values[4]).toBeNull();
  });
  it("returns null without querying when there is no owner", async () => {
    queries.calls = [];
    expect(await getFallbackSourceTurn("ten", "nb", { ownerUserId: "  ", threadId: null, turnId: "t-1" })).toBeNull();
    expect(queries.calls).toHaveLength(0);
  });
});
