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
  enabledFromListStatus,
  openItemsSummary,
  receiptBannerText,
  shouldShowPill,
  visibleProposals,
} from "../LivingSheet";
import type { SheetView } from "@/capabilities/living-sheet/reduce";
import type { SheetProposal } from "@/capabilities/living-sheet/propose";

function emptyView(over: Partial<SheetView> = {}): SheetView {
  return {
    jobId: "job-1",
    seq: 1,
    title: "Belt swap",
    machine: { entityId: "e-1", name: "Conveyor 3" },
    templateRevisionId: null,
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
