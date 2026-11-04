/**
 * Red-first tests for the Living Work Sheet panel (TASK-S3). This repo's
 * vitest environment is "node" (no jsdom/@testing-library — confirmed via
 * vitest.config.ts and package.json). Following the established pattern for
 * testing a complex interactive panel without jsdom
 * (work-packet-panel-review-fixes.test.tsx, MachineObservations.tsx itself
 * has zero component-level tests): test the PURE exported helpers directly,
 * and use renderToStaticMarkup only for the static, no-effects-run SSR shape
 * (proves "renders nothing" when the gate hasn't resolved yet).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LivingSheet,
  canFinishJob,
  conflictValues,
  enabledFromListStatus,
  openItemsSummary,
  receiptBannerText,
  shouldShowPill,
  visibleProposals,
  stepNeedsConfirm,
  stepConfirmDetail,
} from "../LivingSheet";
import type { SheetView } from "@/capabilities/living-sheet/reduce";
import type { SheetProposal } from "@/capabilities/living-sheet/propose";
import type { SheetWriteEvent } from "../living-sheet-client";

function emptyView(over: Partial<SheetView> = {}): SheetView {
  return {
    jobId: "job-1",
    seq: 1,
    title: "Belt swap",
    machine: { entityId: "e-1", name: "Conveyor 3" },
    templateRevisionId: null,
    templateStatus: null,
    template: {
      title: "Belt swap", machineLabel: null, component: null, jobType: null, estHours: null,
      crewSize: null, isolationPoints: null, cautions: null, returnToService: [], items: [],
      torques: [], steps: [], author: null, notes: null,
    },
    steps: [], readings: [], parts: [], notes: [], questions: [], photos: [],
    handover: { current: null, history: [] },
    finished: null,
    openSteps: 0,
    openQuestions: 0,
    warnings: [],
    ...over,
  };
}

describe("shouldShowPill", () => {
  it("shows only once the gate has resolved true; null (loading) and false (disabled) both hide it", () => {
    expect(shouldShowPill(null)).toBe(false);
    expect(shouldShowPill(false)).toBe(false);
    expect(shouldShowPill(true)).toBe(true);
  });
});

describe("openItemsSummary", () => {
  it("reports no open items on a clean view", () => {
    expect(openItemsSummary(emptyView())).toEqual({ openSteps: 0, openQuestions: 0, hasOpen: false });
  });
  it("flags hasOpen when either count is non-zero", () => {
    expect(openItemsSummary(emptyView({ openSteps: 2 })).hasOpen).toBe(true);
    expect(openItemsSummary(emptyView({ openQuestions: 1 })).hasOpen).toBe(true);
  });
});

describe("canFinishJob", () => {
  it("allows finishing outright when nothing is open", () => {
    expect(canFinishJob(false, false)).toBe(true);
  });
  it("blocks finishing with open items until the acknowledgement is ticked", () => {
    expect(canFinishJob(true, false)).toBe(false);
    expect(canFinishJob(true, true)).toBe(true);
  });
});

describe("receiptBannerText", () => {
  it("is plural-correct and names the review action", () => {
    expect(receiptBannerText(1)).toBe("1 suggestion for the job sheet — Review");
    expect(receiptBannerText(2)).toBe("2 suggestions for the job sheet — Review");
  });
});

describe("LivingSheet (SSR shape)", () => {
  it("renders nothing before the capability gate resolves (no effects run under SSR)", () => {
    const html = renderToStaticMarkup(
      <LivingSheet notebookId="nb-1" technicianName={null} onSheetOpenChange={() => {}} receipt={null} />,
    );
    expect(html).toBe("");
  });
});

describe("enabledFromListStatus — the actual 404-disabled gate", () => {
  it("a 404 from GET /sheets means the capability is off", () => {
    expect(enabledFromListStatus(404)).toBe(false);
  });
  it("any other status means the gate has resolved on (loading/jobs can still show their own error)", () => {
    expect(enabledFromListStatus(200)).toBe(true);
    expect(enabledFromListStatus(500)).toBe(true);
  });
});

describe("visibleProposals — Accept/Skip must actually remove a proposal from view", () => {
  const proposals: SheetProposal[] = [
    { proposalId: "p1", risk: "low", reason: "r1", quote: "q1", event: { kind: "note_added", payload: { noteId: "n1", text: "x", noteKind: "note" } } },
    { proposalId: "p2", risk: "needs_tap", reason: "r2", quote: "q2", event: { kind: "part_logged", payload: { partEntryId: "pe1", item: "x", action: "used", qty: null } } },
  ];
  it("with nothing handled, shows everything", () => {
    expect(visibleProposals(proposals, new Set())).toEqual(proposals);
  });
  it("filters out any proposalId already accepted or skipped", () => {
    expect(visibleProposals(proposals, new Set(["p1"]))).toEqual([proposals[1]]);
    expect(visibleProposals(proposals, new Set(["p1", "p2"]))).toEqual([]);
  });
});

describe("conflictValues — F22: the conflict panel shows both competing values", () => {
  it("a conflicting reading_corrected shows mine (the queued value) and theirs (the server's current value), not just seq numbers", () => {
    const event: SheetWriteEvent = { kind: "reading_corrected", payload: { readingId: "r-1", value: 4.8, unit: "A", reason: null } };
    const serverView = emptyView({
      seq: 9,
      readings: [
        {
          id: "r-1", what: "Motor current",
          current: { value: 48, unit: "A", by: "Jess", at: "2026-11-03T00:00:00.000Z", eventId: "e-1" },
          history: [],
          source: { kind: "tech", ref: null },
        },
      ],
    });
    const { mine, theirs } = conflictValues(event, serverView);
    expect(mine).toBe("4.8 A");
    expect(theirs).toBe("48 A (by Jess)");
  });

  it("a conflicting step_marked shows mine and the server's current done/not-done state", () => {
    const event: SheetWriteEvent = { kind: "step_marked", payload: { stepId: "s-1", done: true, note: null } };
    const serverView = emptyView({
      seq: 5,
      steps: [{ id: "s-1", text: "x", checkoff: "none", torqueRef: null, source: null, done: true, doneBy: "Mo", doneAt: "2026-11-03T00:00:00.000Z", note: null, history: [] }],
    });
    const { mine, theirs } = conflictValues(event, serverView);
    expect(mine).toBe("Step marked done");
    expect(theirs).toBe("Step is done (by Mo)");
  });

  it("falls back to a plain seq-based description when the server view can't resolve the specific field (never fabricates a value)", () => {
    const event: SheetWriteEvent = { kind: "handover_written", payload: { text: "Belt is loose" } };
    const serverView = emptyView({ seq: 7 });
    const { mine, theirs } = conflictValues(event, serverView);
    expect(mine).toBe("Belt is loose");
    expect(theirs).toBe("current sheet, seq 7");
  });

  it("a null serverView (the sheet failed to load) never crashes and says so plainly", () => {
    const event: SheetWriteEvent = { kind: "part_logged", payload: { partEntryId: "p1", item: "O-ring", action: "used", qty: null } };
    const { theirs } = conflictValues(event, null);
    expect(theirs).toBe("unknown — the sheet could not be loaded");
  });
});

describe("torque / thread-locker / measurement steps confirm before marking done", () => {
  const torques = [
    { id: "t1", what: "Bearing cap bolts", value: 85, unit: "ft-lb", pattern: "star pattern", threadLocker: null, tool: "Torque wrench", source: "Shop sheet C3-LW" },
    { id: "t2", what: "Set screw", value: 12, unit: "ft-lb", pattern: null, threadLocker: "medium", tool: null, source: null },
  ];
  const step = (checkoff: "none" | "torque" | "loctite" | "measurement" | "photo", torqueRef: string | null, done = false) =>
    ({ id: "s", text: "Torque bearing cap bolts", checkoff, torqueRef, source: null, done, doneBy: null, doneAt: null, note: null, history: [] });
  it("needs a confirm only when ticking ON a torque, loctite or measurement step", () => {
    expect(stepNeedsConfirm(step("torque", "Bearing cap bolts"))).toBe(true);
    expect(stepNeedsConfirm(step("loctite", "Set screw"))).toBe(true);
    expect(stepNeedsConfirm(step("measurement", null))).toBe(true);
    expect(stepNeedsConfirm(step("none", null))).toBe(false);
    expect(stepNeedsConfirm(step("torque", "Bearing cap bolts", true))).toBe(false);
  });
  it("shows the template torque value and its source, matched by what or id", () => {
    expect(stepConfirmDetail(step("torque", "Bearing cap bolts"), torques)).toEqual({
      what: "Bearing cap bolts", value: "85 ft-lb", pattern: "star pattern", threadLocker: null, source: "Shop sheet C3-LW",
    });
    expect(stepConfirmDetail(step("loctite", "t2"), torques)?.threadLocker).toBe("medium");
  });
  it("an unsourced torque says so plainly; a missing reference returns null", () => {
    expect(stepConfirmDetail(step("loctite", "Set screw"), torques)?.source).toBe("no source — unverified");
    expect(stepConfirmDetail(step("measurement", null), torques)).toBeNull();
  });
});
