/**
 * Pure-model tests for living-sheet-print.ts (S5). No DOM, no React — just
 * printModel(view, opts) -> PrintModel. Red-first evidence for this file is
 * saved to .planning/2026-11-04-living-sheet/S5S6-red-evidence.txt.
 */
import { describe, expect, it } from "vitest";
import { printModel } from "../living-sheet-print";
import type { SheetView } from "@/capabilities/living-sheet/reduce";
import type { JobSheetBody } from "@/capabilities/living-sheet/types";

function template(over: Partial<JobSheetBody> = {}): JobSheetBody {
  return {
    title: "PM — Pump 07",
    machineLabel: "Pump 07",
    component: null,
    jobType: "pm",
    estHours: null,
    crewSize: null,
    isolationPoints: null,
    cautions: null,
    returnToService: [],
    items: [],
    torques: [],
    steps: [],
    author: null,
    notes: null,
    ...over,
  };
}

function baseView(over: Partial<SheetView> = {}): SheetView {
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    seq: 3,
    title: "PM — Pump 07",
    machine: { entityId: "cmms-pump07", name: "Pump 07" },
    templateRevisionId: null,
    templateStatus: null,
    template: template(),
    steps: [],
    readings: [],
    parts: [],
    notes: [],
    questions: [],
    photos: [],
    handover: { current: null, history: [] },
    finished: null,
    openSteps: 0,
    openQuestions: 0,
    warnings: [],
    ...over,
  };
}

const OPTS = { printedAt: "2026-11-03 09:15 AM", seq: 3 };

describe("printModel — header", () => {
  it("includes the snapshot seq", () => {
    const m = printModel(baseView({ seq: 7 }), { ...OPTS, seq: 7 });
    expect(m.header).toContain("#7");
  });

  it("includes the job id (short), title, machine name and printed time", () => {
    const m = printModel(baseView(), { ...OPTS, jobIdShort: "11111111", machineName: "Pump 07" });
    expect(m.header).toContain("11111111");
    expect(m.header).toContain("PM — Pump 07");
    expect(m.header).toContain("Pump 07");
    expect(m.header).toContain("2026-11-03 09:15 AM");
  });

  it("defaults jobIdShort to the first 8 characters of the job id when not supplied", () => {
    const m = printModel(baseView({ jobId: "abcdef12-3456-4111-8111-111111111111" }), OPTS);
    expect(m.header).toContain("abcdef12");
  });
});

describe("printModel — draft banner", () => {
  it("shows the draft banner when templateStatus is draft", () => {
    const m = printModel(baseView({ templateStatus: "draft" }), OPTS);
    expect(m.sections.some((s) => s.kind === "banner" && /DRAFT job sheet — not reviewed/.test(s.text))).toBe(true);
  });

  it("omits the banner when templateStatus is reviewed", () => {
    const m = printModel(baseView({ templateStatus: "reviewed" }), OPTS);
    expect(m.sections.some((s) => s.kind === "banner")).toBe(false);
  });

  it("F04: shows a distinct 'not from a reviewed job sheet' banner for an ad-hoc job (templateStatus null) — it was never reviewed, it just never had a template to review", () => {
    const m = printModel(baseView({ templateStatus: null }), OPTS);
    const banner = m.sections.find((s) => s.kind === "banner");
    expect(banner).toMatchObject({ kind: "banner", text: "Not from a reviewed job sheet" });
    // Distinct from the draft banner's wording.
    expect(banner).not.toMatchObject({ text: expect.stringContaining("DRAFT") });
  });
});

describe("printModel — safety", () => {
  it("uses the template's isolation points verbatim when present", () => {
    const m = printModel(baseView({ template: template({ isolationPoints: "Lock MCC-3, breaker 7." }) }), OPTS);
    const safety = m.sections.find((s) => s.kind === "safety");
    expect(safety).toMatchObject({ kind: "safety", text: "Lock MCC-3, breaker 7." });
  });

  it("falls back to the standard notice when isolation points are not written", () => {
    const m = printModel(baseView({ template: template({ isolationPoints: null }) }), OPTS);
    const safety = m.sections.find((s) => s.kind === "safety");
    expect(safety).toMatchObject({ text: "Not written — follow your site's lockout procedure" });
  });
});

describe("printModel — F13: stored procedural template content that was previously never printed", () => {
  // Example drawn from the §12 fixture the EGM reviewer inspected.
  it("prints cautions, return-to-service checks, template notes, torque pattern/tool/thread-locker, and a bring-list item's source", () => {
    const view = baseView({
      template: template({
        cautions: "Wheel is heavy; two-person lift",
        returnToService: ["Jog motor, confirm no abnormal noise", "Verify guard reinstalled"],
        notes: "Torque sequence must follow the star pattern — see shop manual p.44.",
        items: [{ id: "i1", kind: "part", item: "Gasket", spec: null, qty: 1, source: "warehouse bin 12", notes: null }],
        torques: [
          { id: "t1", what: "Wheel bolts", value: 85, unit: "ft-lb", pattern: "star", threadLocker: "blue 242", tool: "3/4 impact", source: "Manual p.12" },
        ],
      }),
    });
    const m = printModel(view, OPTS);

    const cautions = m.sections.find((s) => s.kind === "cautions");
    expect(cautions).toMatchObject({ kind: "cautions", text: "Wheel is heavy; two-person lift" });

    const checks = m.sections.find((s) => s.kind === "checks");
    expect(checks).toMatchObject({
      kind: "checks",
      items: ["Jog motor, confirm no abnormal noise", "Verify guard reinstalled"],
    });

    const templateNotes = m.sections.find((s) => s.kind === "templateNotes");
    expect(templateNotes).toMatchObject({
      kind: "templateNotes",
      text: "Torque sequence must follow the star pattern — see shop manual p.44.",
    });

    const torques = m.sections.find((s) => s.kind === "torques");
    expect(torques).toMatchObject({ items: [{ pattern: "star", threadLocker: "blue 242", tool: "3/4 impact" }] });

    const bringToJob = m.sections.find((s) => s.kind === "bringToJob");
    expect(bringToJob).toMatchObject({ items: [{ source: "warehouse bin 12" }] });

    // All of it is reachable through the single plainText surface too.
    expect(m.plainText).toContain("Wheel is heavy; two-person lift");
    expect(m.plainText).toContain("Jog motor, confirm no abnormal noise");
    expect(m.plainText).toContain("star pattern");
    expect(m.plainText).toContain("star");
    expect(m.plainText).toContain("blue 242");
    expect(m.plainText).toContain("warehouse bin 12");
  });

  it("omits cautions/checks/templateNotes sections entirely when the template has none (no empty section clutter)", () => {
    const m = printModel(baseView({ template: template({ cautions: null, returnToService: [], notes: null }) }), OPTS);
    expect(m.sections.some((s) => s.kind === "cautions")).toBe(false);
    expect(m.sections.some((s) => s.kind === "checks")).toBe(false);
    expect(m.sections.some((s) => s.kind === "templateNotes")).toBe(false);
  });
});

describe("printModel — steps", () => {
  it("a done step carries by/at", () => {
    const view = baseView({
      template: template({ steps: [{ id: "s1", text: "Check seal", checkoff: "none", torqueRef: null, source: null }] }),
      steps: [
        {
          id: "s1",
          text: "Check seal",
          checkoff: "none",
          torqueRef: null,
          source: null,
          done: true,
          doneBy: "Tech One",
          doneAt: "2026-11-03T14:00:00.000Z",
          note: null,
          history: [],
        },
      ],
    });
    const m = printModel(view, OPTS);
    const steps = m.sections.find((s) => s.kind === "steps");
    expect(steps).toMatchObject({ kind: "steps", items: [{ id: "s1", done: true, doneBy: "Tech One", doneAt: "2026-11-03T14:00:00.000Z" }] });
  });

  it("an undone step has no by/at (empty box)", () => {
    const view = baseView({
      template: template({ steps: [{ id: "s1", text: "Check seal", checkoff: "none", torqueRef: null, source: null }] }),
      steps: [
        { id: "s1", text: "Check seal", checkoff: "none", torqueRef: null, source: null, done: false, doneBy: null, doneAt: null, note: null, history: [] },
      ],
    });
    const m = printModel(view, OPTS);
    const steps = m.sections.find((s) => s.kind === "steps");
    expect(steps).toMatchObject({ items: [{ done: false, doneBy: null, doneAt: null }] });
  });
});

describe("printModel — readings (superseded values kept)", () => {
  it("keeps every earlier value, each marked superseded, alongside the current value", () => {
    const view = baseView({
      readings: [
        {
          id: "r1",
          what: "Discharge pressure",
          current: { value: 4.8, unit: "psi", by: "Tech One", at: "2026-11-03T14:05:00.000Z", eventId: "e2" },
          history: [
            { value: 48, unit: "psi", by: "Tech One", at: "2026-11-03T14:00:00.000Z", eventId: "e1", superseded: true },
            { value: 4.8, unit: "psi", by: "Tech One", at: "2026-11-03T14:05:00.000Z", eventId: "e2", superseded: false },
          ],
          source: { kind: "tech", ref: null },
        },
      ],
    });
    const m = printModel(view, OPTS);
    const readings = m.sections.find((s) => s.kind === "readings");
    expect(readings?.kind).toBe("readings");
    if (readings?.kind !== "readings") throw new Error("expected readings section");
    expect(readings.items[0]!.current.value).toBe(4.8);
    expect(readings.items[0]!.history).toHaveLength(2);
    expect(readings.items[0]!.history.some((h) => h.value === 48 && h.superseded === true)).toBe(true);
  });
});

describe("printModel — notes and questions", () => {
  it("an unresolved question carries resolved:false", () => {
    const view = baseView({
      questions: [
        { id: "q1", text: "Is this bearing original?", by: "Tech One", at: "2026-11-03T14:00:00.000Z", eventId: "e1", resolved: false, resolution: null, resolvedBy: null, resolvedAt: null },
      ],
    });
    const m = printModel(view, OPTS);
    const questions = m.sections.find((s) => s.kind === "questions");
    expect(questions).toMatchObject({ items: [{ resolved: false }] });
  });

  it("a resolved question carries its resolution", () => {
    const view = baseView({
      questions: [
        { id: "q1", text: "Is this bearing original?", by: "Tech One", at: "2026-11-03T14:00:00.000Z", eventId: "e1", resolved: true, resolution: "Yes, OEM part.", resolvedBy: "Tech Two", resolvedAt: "2026-11-03T14:30:00.000Z" },
      ],
    });
    const m = printModel(view, OPTS);
    const questions = m.sections.find((s) => s.kind === "questions");
    expect(questions).toMatchObject({ items: [{ resolved: true, resolution: "Yes, OEM part." }] });
  });
});

describe("printModel — parts, photos, handover", () => {
  it("passes through logged parts", () => {
    const view = baseView({
      parts: [{ id: "p1", item: "Seal kit", action: "used", qty: 1, by: "Tech One", at: "2026-11-03T14:00:00.000Z", eventId: "e1" }],
    });
    const m = printModel(view, OPTS);
    const parts = m.sections.find((s) => s.kind === "parts");
    expect(parts).toMatchObject({ items: [{ item: "Seal kit", action: "used" }] });
  });

  it("photos carry caption and by/at", () => {
    const view = baseView({
      photos: [{ id: "ph1", fileId: "file-1", caption: "before teardown", by: "Tech One", at: "2026-11-03T14:00:00.000Z", eventId: "e1" }],
    });
    const m = printModel(view, OPTS);
    const photos = m.sections.find((s) => s.kind === "photos");
    expect(photos).toMatchObject({ items: [{ caption: "before teardown", by: "Tech One" }] });
  });

  it("handover carries the current entry verbatim", () => {
    const view = baseView({
      handover: {
        current: { text: "Bearing on order, ETA Thursday.", by: "Tech One", at: "2026-11-03T18:00:00.000Z", eventId: "e9" },
        history: [{ text: "Bearing on order, ETA Thursday.", by: "Tech One", at: "2026-11-03T18:00:00.000Z", eventId: "e9" }],
      },
    });
    const m = printModel(view, OPTS);
    const handover = m.sections.find((s) => s.kind === "handover");
    expect(handover).toMatchObject({ current: { text: "Bearing on order, ETA Thursday." } });
  });
});

describe("printModel — torques: no source is printed as unverified", () => {
  it("a torque with a source keeps it verbatim", () => {
    const view = baseView({ template: template({ torques: [{ id: "t1", what: "Bolt A", value: 35, unit: "ft-lb", pattern: null, threadLocker: null, tool: null, source: "Manual p.12" }] }) });
    const m = printModel(view, OPTS);
    const torques = m.sections.find((s) => s.kind === "torques");
    expect(torques).toMatchObject({ items: [{ sourceText: "Manual p.12" }] });
  });

  it("a torque with no source prints 'no source — unverified'", () => {
    const view = baseView({ template: template({ torques: [{ id: "t1", what: "Bolt A", value: null, unit: null, pattern: null, threadLocker: null, tool: null, source: null }] }) });
    const m = printModel(view, OPTS);
    const torques = m.sections.find((s) => s.kind === "torques");
    expect(torques).toMatchObject({ items: [{ sourceText: "no source — unverified" }] });
  });
});

describe("printModel — footer", () => {
  it("carries the disclaimer and both signature lines", () => {
    const m = printModel(baseView(), OPTS);
    expect(m.footer.disclaimer).toBe("This sheet records what was reported. It does not authorize return to service.");
    expect(m.footer.signatureLines).toEqual(expect.arrayContaining(["Technician", "Supervisor"]));
  });
});

describe("printModel — banned words", () => {
  const BANNED = ["fixed", "safe to run", "safe to operate", "repaired successfully"];

  function bannedWordRegex(phrase: string): RegExp {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped.replace(/ /g, "\\s+")}\\b`, "i");
  }

  it("never emits any banned word or phrase in the full text, across every section", () => {
    const view = baseView({
      template: template({
        isolationPoints: "Lock MCC-3.",
        steps: [{ id: "s1", text: "Check seal", checkoff: "torque", torqueRef: "t1", source: null }],
        torques: [{ id: "t1", what: "Bolt A", value: 35, unit: "ft-lb", pattern: null, threadLocker: "blue", tool: "3/8 wrench", source: "Manual p.12" }],
        items: [{ id: "i1", kind: "part", item: "Seal kit", spec: "OEM", qty: 1, source: "warehouse", notes: "bring spare" }],
      }),
      steps: [
        {
          id: "s1",
          text: "Check seal",
          checkoff: "torque",
          torqueRef: "t1",
          source: null,
          done: true,
          doneBy: "Tech One",
          doneAt: "2026-11-03T14:00:00.000Z",
          note: "all good",
          history: [{ done: true, note: "all good", by: "Tech One", at: "2026-11-03T14:00:00.000Z", eventId: "e1" }],
        },
      ],
      readings: [
        {
          id: "r1",
          what: "Discharge pressure",
          current: { value: 4.8, unit: "psi", by: "Tech One", at: "2026-11-03T14:05:00.000Z", eventId: "e2" },
          history: [
            { value: 48, unit: "psi", by: "Tech One", at: "2026-11-03T14:00:00.000Z", eventId: "e1", superseded: true },
            { value: 4.8, unit: "psi", by: "Tech One", at: "2026-11-03T14:05:00.000Z", eventId: "e2", superseded: false },
          ],
          source: { kind: "tech", ref: null },
        },
      ],
      notes: [{ id: "n1", text: "Belt tension checked.", by: "Tech One", at: "2026-11-03T14:00:00.000Z", eventId: "e3" }],
      questions: [{ id: "q1", text: "Original bearing?", by: "Tech One", at: "2026-11-03T14:00:00.000Z", eventId: "e4", resolved: true, resolution: "Yes.", resolvedBy: "Tech Two", resolvedAt: "2026-11-03T14:30:00.000Z" }],
      parts: [{ id: "p1", item: "Seal kit", action: "replaced", qty: 1, by: "Tech One", at: "2026-11-03T14:00:00.000Z", eventId: "e5" }],
      photos: [{ id: "ph1", fileId: "file-1", caption: "before teardown", by: "Tech One", at: "2026-11-03T14:00:00.000Z", eventId: "e6" }],
      handover: { current: { text: "Bearing on order.", by: "Tech One", at: "2026-11-03T18:00:00.000Z", eventId: "e9" }, history: [] },
    });
    const m = printModel(view, OPTS);
    for (const phrase of BANNED) {
      expect(m.plainText, `must not contain "${phrase}"`).not.toMatch(bannedWordRegex(phrase));
    }
  });

  it("control: a banned word embedded in free text (notes) IS caught by the regex itself", () => {
    // Proves the regex in this test file actually fires on the words it bans —
    // not just that printModel happens to avoid them by construction.
    expect("the pump is fixed now").toMatch(bannedWordRegex("fixed"));
    expect("safe to run the line").toMatch(bannedWordRegex("safe to run"));
  });
});
