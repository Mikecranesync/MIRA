import { describe, expect, it } from "vitest";
import { pickRouteFor } from "./hub-host-logic";
import { focusStep, type BenchState } from "./bench-components-logic";

const mint = () => "fresh-thread";

describe("pickRouteFor (where an equipment Ask lands)", () => {
  const open = { notebookId: "n1", threadId: "t1" };
  const pressed = { conversation: open, generation: 4 };
  const now = { generation: 4, selection: open, answering: false };

  it("a component of the open notebook is shown in the open conversation's checklist", () => {
    expect(pickRouteFor({ machineId: "n1", componentId: "c1" }, pressed, now, 7, mint)).toEqual({
      kind: "route",
      open: null,
      focus: { notebookId: "n1", threadId: "t1", componentId: "c1", token: 7 },
    });
  });

  it("a component of another notebook opens that notebook in a fresh chat and is shown there", () => {
    expect(pickRouteFor({ machineId: "n2", componentId: "c9" }, pressed, now, 8, mint)).toEqual({
      kind: "route",
      open: { notebookId: "n2", threadId: "fresh-thread" },
      focus: { notebookId: "n2", threadId: "fresh-thread", componentId: "c9", token: 8 },
    });
  });

  it("from home (nothing open) the notebook opens and the component is shown", () => {
    const route = pickRouteFor({ machineId: "n2", componentId: "c9" }, { conversation: null, generation: 0 }, { generation: 0, selection: null, answering: false }, 9, mint);
    expect(route).toMatchObject({ kind: "route", open: { notebookId: "n2", threadId: "fresh-thread" }, focus: { componentId: "c9" } });
  });

  it("a whole machine opens its notebook and shows nothing", () => {
    expect(pickRouteFor({ machineId: "n2", componentId: null }, pressed, now, 10, mint)).toEqual({
      kind: "route",
      open: { notebookId: "n2", threadId: "fresh-thread" },
      focus: null,
    });
  });

  it("an answer that arrives after any conversation change moves nothing, a return to the same chat included (#5625 r2 F3)", () => {
    // A → B → A: the IDs match again, the generation does not.
    expect(pickRouteFor({ machineId: "n2", componentId: "c9" }, pressed, { ...now, generation: 6 }, 11, mint))
      .toEqual({ kind: "dropped", reason: "conversation_changed" });
    // Control: same generation, same IDs → routed.
    expect(pickRouteFor({ machineId: "n2", componentId: "c9" }, pressed, now, 12, mint).kind).toBe("route");
  });

  it("an answer that arrives while a chat answer streams moves nothing (opening a chat would stop it)", () => {
    expect(pickRouteFor({ machineId: "n2", componentId: "c9" }, pressed, { ...now, answering: true }, 13, mint))
      .toEqual({ kind: "dropped", reason: "answer_in_progress" });
  });
});

describe("focusStep (the checklist shows a found component once)", () => {
  const focus = { componentId: "c2", token: 1 };
  const ready = { bench: bench(), available: true, readFailed: false };

  it("shows a listed component", () => {
    expect(focusStep(focus, new Set(), ready)).toBe("show");
  });

  it("a consumed token is never shown again", () => {
    expect(focusStep(focus, new Set([1]), ready)).toBe("none");
  });

  it("waits while the list is loading", () => {
    expect(focusStep(focus, new Set(), { ...ready, bench: null })).toBe("wait");
  });

  it("a failed read ends the hand-off instead of waiting for a later read (#5625 r2 F11)", () => {
    expect(focusStep(focus, new Set(), { ...ready, bench: null, readFailed: true })).toBe("failed");
  });

  it("an unavailable checklist ends the hand-off", () => {
    expect(focusStep(focus, new Set(), { ...ready, bench: null, available: false })).toBe("unavailable");
  });

  it("a component not in this checklist, or retired, is not shown", () => {
    expect(focusStep({ componentId: "c404", token: 1 }, new Set(), ready)).toBe("missing");
    expect(focusStep({ componentId: "c3", token: 1 }, new Set(), ready)).toBe("missing");
  });
});

function bench(): BenchState {
  return {
    components: [{ id: "c1", status: "confirmed" }, { id: "c2", status: "confirmed" }, { id: "c3", status: "retired" }],
    selection: null,
    selectionVersion: null,
  } as unknown as BenchState;
}
