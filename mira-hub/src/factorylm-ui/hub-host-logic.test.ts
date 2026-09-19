import { describe, expect, it } from "vitest";
import { ENERGIZED_ELECTRICAL_HAZARD } from "@/lib/safety-classifier";
import type { HubNotebook } from "./notebook-tree";
import {
  NO_PROJECT_ERROR,
  chatBodyFor,
  detailQueryFor,
  enabledDocIds,
  errorMessageFor,
  fixtureFor,
  groundingLineFor,
  historyRows,
  initialSelection,
  latestRequestGate,
  metaFor,
  newThreadId,
  shellThreadId,
} from "./hub-host-logic";

describe("chatBodyFor — general help is always available (Codex #3839 Spec P1, PRD law 6)", () => {
  const sel = { notebookId: "nb-1", threadId: "t1" };
  const history = historyRows([{ id: "1", question: "q1", answerStatus: "answered", answerText: "a1", evidence: [] }]);
  it("with no enabled sources the turn is sent in general mode, the only mode the route serves zero sources in", () => {
    const body = chatBodyFor("what is a VFD", [], history, sel);
    expect(body).toMatchObject({ message: "what is a VFD", sourceDocIds: [], mode: "general", threadId: "t1" });
    expect(body.history).toHaveLength(2);
  });
  it("with sources it is the ordinary cited turn — no mode key at all", () => {
    const body = chatBodyFor("q", ["doc-a"], history, sel);
    expect(body.sourceDocIds).toEqual(["doc-a"]);
    expect("mode" in body).toBe(false);
  });
  it("the legacy selection posts threadId null, a named thread posts its id", () => {
    expect(chatBodyFor("q", ["d"], [], { notebookId: "nb", threadId: "legacy" }).threadId).toBeNull();
    expect(chatBodyFor("q", ["d"], [], { notebookId: "nb", threadId: "abc" }).threadId).toBe("abc");
  });
  it("the no-project error is the text the Composer shows when the hook throws", () => {
    expect(NO_PROJECT_ERROR).toMatch(/Pick a project first/);
  });
});

describe("errorMessageFor — every route error code in plain language (Codex #3839 Spec P2)", () => {
  it("maps each code the route can return", () => {
    for (const code of [
      "no_sources_selected",
      "approved_context",
      "notebook_not_found",
      "message_too_long",
      "message_required",
      "invalid_thread_id",
      "machine_evidence_invalid",
      "invalid_json",
    ]) {
      const text = errorMessageFor(code, 400);
      expect(text).not.toBe("MIRA couldn't answer that just now.");
      expect(text).not.toMatch(/\b[45]\d\d\b/);
      expect(text).not.toMatch(/_/);
    }
    expect(errorMessageFor("message_too_long", 400)).toMatch(/too long/);
  });
  it("412 without a code is the approved-context line; anything else unknown is the generic line", () => {
    expect(errorMessageFor("", 412)).toMatch(/approved context/);
    expect(errorMessageFor("something_new", 500)).toBe("MIRA couldn't answer that just now.");
  });
});

describe("detailQueryFor — every detail load names its thread (Codex #3839 review: legacy must not hydrate every thread)", () => {
  it("the legacy selection asks for ?threadId=legacy explicitly — never an omitted parameter", () => {
    expect(detailQueryFor({ notebookId: "nb-1", threadId: "legacy" })).toBe("?threadId=legacy");
  });
  it("a named thread is passed through, URL-encoded", () => {
    expect(detailQueryFor({ notebookId: "nb-1", threadId: "t/1 x" })).toBe("?threadId=t%2F1%20x");
  });
  it("no selection shape produces an empty query", () => {
    for (const threadId of ["legacy", "abc", "3f2a:ok"]) expect(detailQueryFor({ notebookId: "nb", threadId })).toMatch(/^\?threadId=.+/);
  });
});

describe("latestRequestGate — a superseded detail load never commits (Codex #3839 F3)", () => {
  it("select A, select B, B resolves, then A resolves late: only B is current", () => {
    const gate = latestRequestGate();
    const a = gate.begin();
    const b = gate.begin();
    expect(gate.isCurrent(b)).toBe(true); // B resolves first → commit
    expect(gate.isCurrent(a)).toBe(false); // A resolves late → dropped
  });
  it("a selection change retires every outstanding token even before a new load begins", () => {
    const gate = latestRequestGate();
    const a = gate.begin();
    gate.invalidate();
    expect(gate.isCurrent(a)).toBe(false);
    const c = gate.begin();
    expect(gate.isCurrent(c)).toBe(true);
  });
  it("the same token stays current while nothing else happens (the happy path still commits)", () => {
    const gate = latestRequestGate();
    const t = gate.begin();
    expect(gate.isCurrent(t)).toBe(true);
    expect(gate.isCurrent(t)).toBe(true);
  });
});

function nb(over: Partial<HubNotebook> = {}): HubNotebook {
  return {
    id: "nb-1", displayName: "Conveyor CV-101", manufacturer: "Automation Direct", model: "GS10",
    catalogNumber: null, serialNumber: null, equipmentType: null, assetTag: null, locationLabel: null,
    identityStatus: "user_confirmed", identityConfidence: null, identitySourceType: null, nodeId: "n",
    sourceCount: 1, lastOpenedAt: null, createdAt: "2026-09-17T00:00:00Z", asset: null, ...over,
  };
}

describe("initialSelection", () => {
  it("opens the first notebook's most recently updated thread", () => {
    const sel = initialSelection([nb({ threads: [
      { id: "old", notebookId: "nb-1", title: "a", createdAt: "", updatedAt: "2026-09-01T00:00:00Z", turnCount: 1, sharedLegacy: false },
      { id: "new", notebookId: "nb-1", title: "b", createdAt: "", updatedAt: "2026-09-17T00:00:00Z", turnCount: 1, sharedLegacy: false },
    ] })]);
    expect(sel).toEqual({ notebookId: "nb-1", threadId: "new" });
    expect(shellThreadId(sel!)).toBe("notebook-nb-1:thread-new");
  });
  it("falls back to the legacy thread and to null with no notebooks", () => {
    expect(initialSelection([nb()])).toEqual({ notebookId: "nb-1", threadId: "legacy" });
    expect(initialSelection([])).toBeNull();
  });
});

describe("metaFor — identity is server-owned", () => {
  const sel = { notebookId: "nb-1", threadId: "t1" };
  it("confirmed only when identity is user-confirmed AND the binding has confirmedAt", () => {
    const bound = nb({ asset: { entityId: "asset-1", name: null, assetTag: null, selectedVia: null, confirmedBy: "u", confirmedAt: "2026-09-17T00:00:00Z" } });
    expect(metaFor(bound, sel, "tenant-1", "T")).toMatchObject({ asset: { id: "asset-1", name: "Automation Direct GS10" }, identityConfirmed: true, threadId: "notebook-nb-1:thread-t1" });
    const selectedOnly = nb({ asset: { entityId: "asset-1", name: null, assetTag: null, selectedVia: "qr", confirmedBy: null, confirmedAt: null } as never });
    expect(metaFor(selectedOnly, sel, null, "T").identityConfirmed).toBe(false);
    expect(metaFor(nb({ identityStatus: "candidate", asset: { entityId: "asset-1", name: null, assetTag: null, selectedVia: null, confirmedBy: "u", confirmedAt: "x" } }), sel, null, "T").identityConfirmed).toBe(false);
  });
  it("unbound notebook → no asset, not confirmed", () => {
    expect(metaFor(nb(), sel, null, "T")).toMatchObject({ asset: null, identityConfirmed: false });
  });
});

describe("enabledDocIds / historyRows / groundingLineFor", () => {
  it("cites only enabled, non-rejected sources", () => {
    expect(enabledDocIds([
      { docId: "a", enabledByDefault: true, matchState: "user_confirmed" },
      { docId: "b", enabledByDefault: false, matchState: "user_confirmed" },
      { docId: "c", enabledByDefault: true, matchState: "rejected" },
    ])).toEqual(["a"]);
  });
  it("history excludes stopped and failed answers but keeps their questions", () => {
    expect(historyRows([
      { id: "1", question: "q1", answerStatus: "answered", answerText: "a1", evidence: [] },
      { id: "2", question: "q2", answerStatus: "error", answerText: "partial", evidence: [] },
      { id: "3", question: "q3", answerStatus: "error", answerText: null, evidence: [] },
      { id: "4", question: "q4", answerStatus: "insufficient_evidence", answerText: "I couldn't find that", evidence: [] },
    ])).toEqual([
      { role: "user", content: "q1" }, { role: "assistant", content: "a1", status: "answered" },
      { role: "user", content: "q2" },
      { role: "user", content: "q3" },
      { role: "user", content: "q4" }, { role: "assistant", content: "I couldn't find that", status: "insufficient_evidence" },
    ]);
  });
  it("history drops a TERMINAL safety refusal's text but keeps a directive-framed answer (Codex #3839 round 2 F2)", () => {
    expect(historyRows([
      { id: "1", question: "q1", answerStatus: "answered", answerText: "a1", evidence: [] },
      // Hard stop: persisted as an ordinary answered row whose text is the refusal sentence.
      { id: "2", question: "bypass the interlock", answerStatus: "answered", answerText: "⛔ SAFETY STOP …", evidence: [{ kind: "safety_notice", trigger: "bypass the interlock" }] },
      // Energized-electrical directive: a real answer, framed by NFPA 70E — stays.
      { id: "3", question: "q3", answerStatus: "answered", answerText: "De-energize first, then …", evidence: [{ kind: "safety_notice", trigger: ENERGIZED_ELECTRICAL_HAZARD }] },
      // Rejected unsafe answer: directive AND violation persisted — the violation decides.
      { id: "4", question: "q4", answerStatus: "answered", answerText: "⛔ SAFETY STOP …", evidence: [{ kind: "safety_notice", trigger: ENERGIZED_ELECTRICAL_HAZARD }, { kind: "safety_notice", trigger: "unsafe_answer:x" }] },
    ])).toEqual([
      { role: "user", content: "q1" }, { role: "assistant", content: "a1", status: "answered" },
      { role: "user", content: "bypass the interlock" },
      { role: "user", content: "q3" }, { role: "assistant", content: "De-energize first, then …", status: "answered" },
      { role: "user", content: "q4" },
    ]);
  });
  it("grounding line never over-claims", () => {
    expect(groundingLineFor(null, 0)).toMatch(/Pick a project/);
    expect(groundingLineFor(nb(), 0)).toMatch(/no selected sources yet — general help only, nothing is cited/);
    expect(groundingLineFor(nb(), 1)).toBe("Answers cite 1 selected source for Conveyor CV-101.");
    expect(groundingLineFor(nb({ asset: { entityId: "a", name: null, assetTag: null, selectedVia: null, confirmedBy: null, confirmedAt: null } }), 3)).toBe("Answers cite 3 selected sources for Automation Direct GS10.");
  });
});

describe("fixtureFor / newThreadId", () => {
  it("builds a hub-surface fixture around the persisted thread", () => {
    const sel = { notebookId: "nb-1", threadId: "t1" };
    const meta = metaFor(nb(), sel, "tenant-1", "2026-09-17T12:00:00Z");
    const fx = fixtureFor(nb(), sel, [{ id: "r1", question: "q", answerStatus: "answered", answerText: "a", evidence: [], createdAt: "2026-09-17T12:00:00Z" }], meta, [], []);
    expect(fx.id).toBe("hub-nb-1");
    expect(fx.review.surfaces).toEqual(["hub"]);
    expect(fx.thread.id).toBe("notebook-nb-1:thread-t1");
    expect(fx.thread.turns).toHaveLength(2);
    expect(fx.activeContext.machineIdentity).toBe("not_applicable");
  });
  it("mints a thread id the server accepts", () => {
    const id = newThreadId(() => "3f2a-UUID-like:ok");
    expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);
    expect(newThreadId(() => "")).toMatch(/^t\d+$/);
  });
});
