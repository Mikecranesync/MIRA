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
  BringToJobItemRow,
  ReturnToServiceSection,
  StepRow,
  TemplateNotesSection,
  canFinishJob,
  conflictValues,
  enabledFromListStatus,
  openItemsSummary,
  pendingPrintWarning,
  receiptBannerText,
  responseStillTargetsSelectedJob,
  shouldAcceptProposal,
  shouldShowPill,
  visibleProposals,
  stepNeedsConfirm,
  stepConfirmDetail,
} from "../LivingSheet";
import type { JobSheetItem } from "@/capabilities/living-sheet/types";
import type { SheetStepView, SheetView } from "@/capabilities/living-sheet/reduce";
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

describe("conflictValues — R2-19 PROPERTY: every conflict panel shows the server's actual competing content, never a sequence-number fallback, for every field the server CAN resolve", () => {
  it("a conflicting step_marked includes the server's own note on the step, not just done/not-done", () => {
    const event: SheetWriteEvent = { kind: "step_marked", payload: { stepId: "s-1", done: true, note: "torqued to spec" } };
    const serverView = emptyView({
      seq: 5,
      steps: [{ id: "s-1", text: "x", checkoff: "none", torqueRef: null, source: null, done: true, doneBy: "Mo", doneAt: "2026-11-03T00:00:00.000Z", note: "already torqued", history: [] }],
    });
    const { theirs } = conflictValues(event, serverView);
    expect(theirs).toBe("Step is done (by Mo) — already torqued");
  });

  it("a conflicting handover_written shows the server's ACTUAL current handover text and author, not a seq", () => {
    const event: SheetWriteEvent = { kind: "handover_written", payload: { text: "Belt is loose" } };
    const serverView = emptyView({
      seq: 7,
      handover: { current: { text: "Already noted by day shift", by: "Pat", at: "2026-11-03T00:00:00.000Z", eventId: "e-9" }, history: [] },
    });
    const { mine, theirs } = conflictValues(event, serverView);
    expect(mine).toBe("Belt is loose");
    expect(theirs).toBe("Already noted by day shift (by Pat)");
  });

  it("a conflicting question_resolved shows the server's ACTUAL recorded answer and who gave it, when the question is already resolved", () => {
    const event: SheetWriteEvent = { kind: "question_resolved", payload: { noteId: "q-1", resolution: "Yes, replaced" } };
    const serverView = emptyView({
      seq: 4,
      questions: [{ id: "q-1", text: "Did it get replaced?", by: "Mo", at: "2026-11-01T00:00:00.000Z", eventId: "e-1", resolved: true, resolution: "No, repaired instead", resolvedBy: "Jess", resolvedAt: "2026-11-02T00:00:00.000Z" }],
    });
    const { mine, theirs } = conflictValues(event, serverView);
    expect(mine).toBe("Answer: Yes, replaced");
    expect(theirs).toBe("Already answered: No, repaired instead (by Jess)");
  });

  it("a conflicting question_resolved says plainly when the server still shows it open — never fabricates an answer", () => {
    const event: SheetWriteEvent = { kind: "question_resolved", payload: { noteId: "q-1", resolution: "Yes" } };
    const serverView = emptyView({
      seq: 4,
      questions: [{ id: "q-1", text: "Did it get replaced?", by: "Mo", at: "2026-11-01T00:00:00.000Z", eventId: "e-1", resolved: false, resolution: null, resolvedBy: null, resolvedAt: null }],
    });
    const { theirs } = conflictValues(event, serverView);
    expect(theirs).toBe("Still open — no answer recorded yet");
  });

  it("adversarial: a question_resolved whose noteId the server view doesn't have at all still falls back plainly instead of crashing", () => {
    const event: SheetWriteEvent = { kind: "question_resolved", payload: { noteId: "q-missing", resolution: "Yes" } };
    const serverView = emptyView({ seq: 4, questions: [] });
    const { theirs } = conflictValues(event, serverView);
    expect(theirs).toBe("current sheet, seq 4");
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

describe("shouldAcceptProposal (R2-34) — PROPERTY: a proposal can be accepted once; a repeat call for an id already claimed does nothing", () => {
  it("the reviewer's example: a fresh proposal, nothing claimed yet, is accepted", () => {
    expect(shouldAcceptProposal("p1", new Set())).toBe(true);
  });
  it("a double tap: the SAME id already claimed is rejected on the second call", () => {
    expect(shouldAcceptProposal("p1", new Set(["p1"]))).toBe(false);
  });
  it("a rerender firing the handler again for an already-claimed id is rejected, same as a double tap", () => {
    const claimed = new Set(["p1"]);
    expect(shouldAcceptProposal("p1", claimed)).toBe(false);
    expect(shouldAcceptProposal("p1", claimed)).toBe(false);
  });
  it("a DIFFERENT proposal id is unaffected by another id being claimed", () => {
    expect(shouldAcceptProposal("p2", new Set(["p1"]))).toBe(true);
  });
  it("an empty-string id is handled like any other id (claimed once, rejected after)", () => {
    expect(shouldAcceptProposal("", new Set())).toBe(true);
    expect(shouldAcceptProposal("", new Set([""]))).toBe(false);
  });
});

describe("responseStillTargetsSelectedJob (R2-05) — PROPERTY: no response for job A can change state while job B is selected", () => {
  it("the reviewer's example: a response for the currently open job is applied", () => {
    expect(responseStillTargetsSelectedJob("job-1", "job-1")).toBe(true);
  });
  it("a response for job A arriving after the technician switched to job B is rejected", () => {
    expect(responseStillTargetsSelectedJob("job-A", "job-B")).toBe(false);
  });
  it("a response arriving after the sheet was closed entirely (null selected) is rejected", () => {
    expect(responseStillTargetsSelectedJob("job-1", null)).toBe(false);
  });
  it("two different jobIds that happen to share no relation are still compared by plain equality, never loosely", () => {
    expect(responseStillTargetsSelectedJob("job-1", "job-10")).toBe(false);
  });
  it("a response for job A while job A is STILL selected, after some OTHER unrelated state changed, is applied", () => {
    expect(responseStillTargetsSelectedJob("job-1", "job-1")).toBe(true);
  });
});

describe("pendingPrintWarning (R2-17) — PROPERTY: shows 'N changes not yet saved' while anything is queued, null once nothing is", () => {
  it("the reviewer's example: one pending entry warns in the singular", () => {
    expect(pendingPrintWarning(1)).toBe("1 change not yet saved — it will not appear on the print");
  });
  it("more than one pending entry warns in the plural", () => {
    expect(pendingPrintWarning(2)).toBe("2 changes not yet saved — they will not appear on the print");
  });
  it("zero pending entries shows no banner at all", () => {
    expect(pendingPrintWarning(0)).toBeNull();
  });
  it("a negative count (should never happen, but must not crash) is treated as nothing pending", () => {
    expect(pendingPrintWarning(-1)).toBeNull();
  });
  it("a large pending count still pluralizes correctly", () => {
    expect(pendingPrintWarning(42)).toBe("42 changes not yet saved — they will not appear on the print");
  });
});

describe("StepRow (R2-13, SSR) — the execution view renders the step's source/drawing reference", () => {
  function step(over: Partial<SheetStepView> = {}): SheetStepView {
    return {
      id: "s-1", text: "Torque bearing caps", checkoff: "none", torqueRef: null, source: null,
      done: false, doneBy: null, doneAt: null, note: null, history: [],
      ...over,
    };
  }

  it("the reviewer's example: a step with a source/drawing reference renders it", () => {
    const html = renderToStaticMarkup(<ul><StepRow step={step({ source: "Drawing C3-LW, sheet 2" })} onToggle={() => {}} /></ul>);
    expect(html).toContain("Drawing C3-LW, sheet 2");
    expect(html).toContain('data-testid="sheet-step-source-s-1"');
  });

  it("a step with no source renders nothing extra — never fabricates a reference", () => {
    const html = renderToStaticMarkup(<ul><StepRow step={step({ source: null })} onToggle={() => {}} /></ul>);
    expect(html).not.toContain("sheet-step-source-s-1");
  });

  it("a step with an empty-string source also renders nothing (falsy, not a real reference)", () => {
    const html = renderToStaticMarkup(<ul><StepRow step={step({ source: "" })} onToggle={() => {}} /></ul>);
    expect(html).not.toContain("sheet-step-source-s-1");
  });
});

describe("BringToJobItemRow (R2-13, SSR) — item annotations are shown, never dropped", () => {
  function item(over: Partial<JobSheetItem> = {}): JobSheetItem {
    return { id: "it-1", kind: "part", item: "Derailleur hanger bolt", spec: "M10", qty: 1, source: "Bike Shop Co", notes: null, ...over };
  }

  it("the job-sheet-import fixture's exact annotation ('Only if bent.') renders", () => {
    const html = renderToStaticMarkup(<ul><BringToJobItemRow item={item({ notes: "Only if bent." })} /></ul>);
    expect(html).toContain("Only if bent.");
    expect(html).toContain('data-testid="sheet-item-notes-it-1"');
  });

  it("an item with no annotation renders nothing extra", () => {
    const html = renderToStaticMarkup(<ul><BringToJobItemRow item={item({ notes: null })} /></ul>);
    expect(html).not.toContain("sheet-item-notes-it-1");
  });

  it("still shows the item name/spec/qty regardless of annotation presence", () => {
    const html = renderToStaticMarkup(<ul><BringToJobItemRow item={item()} /></ul>);
    expect(html).toContain("Derailleur hanger bolt");
    expect(html).toContain("M10");
  });
});

describe("ReturnToServiceSection (R2-13, SSR) — the template's return-to-service checks, missing entirely from execution before this fix", () => {
  it("an empty list renders nothing at all", () => {
    expect(renderToStaticMarkup(<ReturnToServiceSection checks={[]} />)).toBe("");
  });
  it("a populated list renders every check", () => {
    const html = renderToStaticMarkup(<ReturnToServiceSection checks={["Guard reinstalled", "E-stop tested"]} />);
    expect(html).toContain("Guard reinstalled");
    expect(html).toContain("E-stop tested");
    expect(html).toContain('data-testid="living-sheet-return-to-service"');
  });
});

describe("TemplateNotesSection (R2-13, SSR) — the template's own notes, missing entirely from execution before this fix", () => {
  it("null text renders nothing", () => {
    expect(renderToStaticMarkup(<TemplateNotesSection text={null} />)).toBe("");
  });
  it("empty-string text renders nothing", () => {
    expect(renderToStaticMarkup(<TemplateNotesSection text={""} />)).toBe("");
  });
  it("populated text renders", () => {
    const html = renderToStaticMarkup(<TemplateNotesSection text="Isolate upstream valve before starting." />);
    expect(html).toContain("Isolate upstream valve before starting.");
    expect(html).toContain('data-testid="living-sheet-template-notes"');
  });
});

describe("R2-13 combined — a fixture with every execution-side section populated renders all of them together", () => {
  it("return-to-service, template notes, an item annotation, and a step's source all show up from one template", () => {
    const returnToService = ["Guard reinstalled", "E-stop tested"];
    const templateNotes = "Isolate upstream valve before starting.";
    const item: JobSheetItem = { id: "it-1", kind: "part", item: "Derailleur hanger bolt", spec: "M10", qty: 1, source: "Bike Shop Co", notes: "Only if bent." };
    const step: SheetStepView = {
      id: "s-1", text: "Torque bearing caps", checkoff: "torque", torqueRef: "t1", source: "Drawing C3-LW, sheet 2",
      done: false, doneBy: null, doneAt: null, note: null, history: [],
    };
    const html = renderToStaticMarkup(
      <div>
        <ReturnToServiceSection checks={returnToService} />
        <TemplateNotesSection text={templateNotes} />
        <ul>
          <BringToJobItemRow item={item} />
        </ul>
        <ul>
          <StepRow step={step} onToggle={() => {}} />
        </ul>
      </div>,
    );
    expect(html).toContain("Guard reinstalled");
    expect(html).toContain("Isolate upstream valve before starting.");
    expect(html).toContain("Only if bent.");
    expect(html).toContain("Drawing C3-LW, sheet 2");
  });
});
