import { describe, expect, it } from "vitest";
import { pickRouteFor } from "./hub-host-logic";
import { pickStep, type BenchState } from "./bench-components-logic";

const mint = () => "fresh-thread";

describe("pickRouteFor (where an equipment Ask lands)", () => {
  const open = { notebookId: "n1", threadId: "t1" };
  const pressedIn = (version: number | null | "unknown") => ({ ...open, version });

  it("a component of the open notebook is picked in the open conversation, with what was seen at the press", () => {
    expect(pickRouteFor({ machineId: "n1", componentId: "c1" }, pressedIn(4), 3, open, 7, mint)).toEqual({
      kind: "route",
      open: null,
      pick: { notebookId: "n1", threadId: "t1", componentId: "c1", token: 7, expectedVersion: 4, expectedRevision: 3 },
    });
  });

  it("a never-selected conversation expects no selection (null), not whatever loads later", () => {
    const route = pickRouteFor({ machineId: "n1", componentId: "c1" }, pressedIn(null), 3, open, 7, mint);
    expect(route.kind === "route" && route.pick?.expectedVersion).toBeNull();
  });

  it("a component of another notebook opens that notebook in a fresh chat, expecting no selection there", () => {
    expect(pickRouteFor({ machineId: "n2", componentId: "c9" }, pressedIn(4), 2, open, 8, mint)).toEqual({
      kind: "route",
      open: { notebookId: "n2", threadId: "fresh-thread" },
      pick: { notebookId: "n2", threadId: "fresh-thread", componentId: "c9", token: 8, expectedVersion: null, expectedRevision: 2 },
    });
  });

  it("from home (nothing open) the notebook opens and the component is picked", () => {
    const route = pickRouteFor({ machineId: "n2", componentId: "c9" }, null, 1, null, 9, mint);
    expect(route.kind === "route" && route.open).toEqual({ notebookId: "n2", threadId: "fresh-thread" });
  });

  it("a whole machine opens its notebook without picking a component", () => {
    expect(pickRouteFor({ machineId: "n2", componentId: null }, pressedIn(4), null, open, 10, mint)).toEqual({
      kind: "route",
      open: { notebookId: "n2", threadId: "fresh-thread" },
      pick: null,
    });
  });

  it("an answer that arrives after another chat was opened moves nothing (#5625 r1 F3)", () => {
    expect(pickRouteFor({ machineId: "n1", componentId: "c1" }, pressedIn(4), 3, { notebookId: "n1", threadId: "t2" }, 11, mint))
      .toEqual({ kind: "dropped", reason: "conversation_changed" });
    expect(pickRouteFor({ machineId: "n1", componentId: "c1" }, pressedIn(4), 3, null, 12, mint))
      .toEqual({ kind: "dropped", reason: "conversation_changed" });
    expect(pickRouteFor({ machineId: "n2", componentId: "c9" }, null, 1, open, 13, mint))
      .toEqual({ kind: "dropped", reason: "conversation_changed" });
  });

  it("a press before the checklist reported is not guessed at", () => {
    expect(pickRouteFor({ machineId: "n1", componentId: "c1" }, pressedIn("unknown"), 3, open, 14, mint))
      .toEqual({ kind: "dropped", reason: "checklist_not_loaded" });
  });
});

function bench(selection: { componentId: string; current: boolean } | null): BenchState {
  return {
    components: [{ id: "c1" }, { id: "c2" }],
    selection: selection ? { ...selection, revision: 1, selectedVia: "picker", version: 3 } : null,
    selectionVersion: selection ? 3 : null,
  } as unknown as BenchState;
}

describe("pickStep (the checklist tries a pick once)", () => {
  const pick = { componentId: "c2", token: 1 };
  const ready = { bench: bench(null), available: true, busy: false, saving: false };

  it("selects a listed component", () => {
    expect(pickStep(pick, new Set(), ready)).toBe("select");
  });

  it("a consumed token is never tried again", () => {
    expect(pickStep(pick, new Set([1]), ready)).toBe("none");
  });

  it("waits while an answer streams, a change saves, or the list loads", () => {
    expect(pickStep(pick, new Set(), { ...ready, busy: true })).toBe("wait");
    expect(pickStep(pick, new Set(), { ...ready, saving: true })).toBe("wait");
    expect(pickStep(pick, new Set(), { ...ready, bench: null })).toBe("wait");
  });

  it("an unavailable checklist ends the pick instead of waiting forever", () => {
    expect(pickStep(pick, new Set(), { ...ready, bench: null, available: false })).toBe("unavailable");
  });

  it("a component not in this checklist is not selected", () => {
    expect(pickStep({ componentId: "c404", token: 1 }, new Set(), ready)).toBe("missing");
  });

  it("the already-selected, current component is left alone", () => {
    expect(pickStep(pick, new Set(), { ...ready, bench: bench({ componentId: "c2", current: true }) })).toBe("already");
  });

  it("a selection made under an older identity is selected again", () => {
    expect(pickStep(pick, new Set(), { ...ready, bench: bench({ componentId: "c2", current: false }) })).toBe("select");
  });
});
