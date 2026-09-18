import { describe, expect, it } from "vitest";
import type { HubNotebook } from "./notebook-tree";
import {
  enabledDocIds,
  fixtureFor,
  groundingLineFor,
  historyRows,
  initialSelection,
  metaFor,
  newThreadId,
  shellThreadId,
} from "./hub-host-logic";

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
  it("grounding line never over-claims", () => {
    expect(groundingLineFor(null, 0)).toMatch(/Pick a project/);
    expect(groundingLineFor(nb(), 0)).toMatch(/no selected sources yet — answers will abstain/);
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
