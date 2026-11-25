import { describe, expect, it } from "vitest";
import { openOffer, pickRouteFor } from "./hub-host-logic";
import { focusStep, type BenchState } from "./bench-components-logic";

const t = (machineId: string, componentId: string | null) => ({
  machineId, machineLabel: `Machine ${machineId}`, componentId, componentLabel: componentId ? `Part ${componentId}` : null, location: "",
});

describe("pickRouteFor (an answer only ever puts a button in the panel)", () => {
  const open = { notebookId: "n1", threadId: "t1" };
  const pressed = { conversation: open, generation: 4 };
  const now = { generation: 4, selection: open, answering: false };

  it("a part of the open notebook is offered as Show in checklist, never shown by itself (#5625 r4 F14)", () => {
    expect(pickRouteFor(t("n1", "c1"), pressed, now, 7)).toEqual({ kind: "offer", offer: { target: t("n1", "c1"), here: true, generation: 4, token: 7 } });
  });

  it("the open notebook as a whole needs nothing", () => {
    expect(pickRouteFor(t("n1", null), pressed, now, 8)).toEqual({ kind: "none" });
  });

  it("equipment in another notebook is offered as Open (#5625 r3 F12)", () => {
    expect(pickRouteFor(t("n2", "c9"), pressed, now, 9)).toEqual({ kind: "offer", offer: { target: t("n2", "c9"), here: false, generation: 4, token: 9 } });
    expect(pickRouteFor(t("n2", null), pressed, now, 10)).toMatchObject({ kind: "offer", offer: { here: false } });
  });

  it("from home (nothing open) it is an Open offer too", () => {
    const route = pickRouteFor(t("n2", "c9"), { conversation: null, generation: 0 }, { generation: 0, selection: null, answering: false }, 11);
    expect(route).toMatchObject({ kind: "offer", offer: { here: false } });
  });

  it("an answer that arrives after any conversation change does nothing, a return to the same chat included (#5625 r2 F3)", () => {
    expect(pickRouteFor(t("n1", "c1"), pressed, { ...now, generation: 6 }, 12)).toEqual({ kind: "dropped", reason: "conversation_changed" });
    expect(pickRouteFor(t("n1", "c1"), pressed, now, 13).kind).toBe("offer");
  });

  it("an answer that arrives while a chat answer streams does nothing", () => {
    expect(pickRouteFor(t("n2", "c9"), pressed, { ...now, answering: true }, 14)).toEqual({ kind: "dropped", reason: "answer_in_progress" });
  });
});

describe("openOffer (the technician's tap)", () => {
  const mint = () => "fresh-thread";
  const open = { notebookId: "n1", threadId: "t1" };
  const away = { target: t("n2", "c9"), here: false, generation: 4, token: 15 };

  it("another notebook opens in a fresh chat and shows the part there", () => {
    expect(openOffer(away, { generation: 4, selection: open }, mint)).toEqual({
      open: { notebookId: "n2", threadId: "fresh-thread" },
      focus: { notebookId: "n2", threadId: "fresh-thread", componentId: "c9", token: 15 },
    });
  });

  it("a part of the open notebook is shown in this chat; nothing is opened", () => {
    const here = { target: t("n1", "c1"), here: true, generation: 4, token: 16 };
    expect(openOffer(here, { generation: 4, selection: open }, mint)).toEqual({
      open: null,
      focus: { notebookId: "n1", threadId: "t1", componentId: "c1", token: 16 },
    });
  });

  it("a whole machine opens with nothing to show", () => {
    expect(openOffer({ ...away, target: t("n2", null) }, { generation: 4, selection: open }, mint)).toEqual({ open: { notebookId: "n2", threadId: "fresh-thread" }, focus: null });
  });

  it("an offer from an earlier conversation does nothing", () => {
    expect(openOffer(away, { generation: 5, selection: open }, mint)).toBeNull();
  });
});

describe("focusStep (the checklist shows a found component once)", () => {
  const focus = { componentId: "c2", token: 1 };
  const ready = { bench: bench(), available: true, readFailed: false, reread: false, editing: false };

  it("shows a listed component", () => {
    expect(focusStep(focus, new Set(), ready)).toBe("show");
  });

  it("a consumed token is never shown again", () => {
    expect(focusStep(focus, new Set([1]), ready)).toBe("none");
  });

  it("waits while the list is loading", () => {
    expect(focusStep(focus, new Set(), { ...ready, bench: null })).toBe("wait");
  });

  it("an open label editor is never closed for it: the hand-off waits (#5625 r4 F14)", () => {
    expect(focusStep(focus, new Set(), { ...ready, editing: true })).toBe("wait");
    expect(focusStep(focus, new Set(), { ...ready, editing: false })).toBe("show");
  });

  it("an earlier failed read gets one fresh read for this hand-off, then ends it (#5625 r2 F11, r4 F16)", () => {
    expect(focusStep(focus, new Set(), { ...ready, bench: null, readFailed: true })).toBe("refresh");
    expect(focusStep(focus, new Set(), { ...ready, bench: null, readFailed: true, reread: true })).toBe("failed");
    expect(focusStep({ componentId: "c404", token: 1 }, new Set(), { ...ready, readFailed: true, reread: true })).toBe("failed");
  });

  it("an unavailable checklist ends the hand-off", () => {
    expect(focusStep(focus, new Set(), { ...ready, bench: null, available: false })).toBe("unavailable");
  });

  it("a miss on the list already on screen reads it again once before saying missing (#5625 r3 F13)", () => {
    expect(focusStep({ componentId: "c404", token: 1 }, new Set(), ready)).toBe("refresh");
    expect(focusStep({ componentId: "c404", token: 1 }, new Set(), { ...ready, reread: true })).toBe("missing");
  });

  it("a retired component is not shown, after the same one re-read", () => {
    expect(focusStep({ componentId: "c3", token: 1 }, new Set(), ready)).toBe("refresh");
    expect(focusStep({ componentId: "c3", token: 1 }, new Set(), { ...ready, reread: true })).toBe("missing");
  });
});

function bench(): BenchState {
  return {
    components: [{ id: "c1", status: "confirmed" }, { id: "c2", status: "confirmed" }, { id: "c3", status: "retired" }],
    selection: null,
    selectionVersion: null,
  } as unknown as BenchState;
}
