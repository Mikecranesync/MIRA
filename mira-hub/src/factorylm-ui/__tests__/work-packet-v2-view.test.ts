// Work Packet V2 view helpers — phased numbered steps with their notes, figures and torque; the
// readiness summary; the measurement table that keeps the manual value, a technician's correction,
// approval and the measured value in separate columns. Built from the real builder on the invented
// 85-frame manual. Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-v2-view
import { describe, expect, it } from "vitest";
import { FIXTURES, fixturePages } from "@/capabilities/work-packet/__tests__/fixtures";
import { buildDraftPacket } from "@/capabilities/work-packet/draft";
import { applyEdit } from "@/capabilities/work-packet/edits";
import { emptyRecord, recordMeasurement } from "@/capabilities/work-packet/job-record";
import type { DocText, PageFigure, WorkPacket } from "@/capabilities/work-packet/types";
import { measurementRows, phasedSteps, readinessSummary, unplacedFigures } from "../work-packet-v2-view";

const PNG = "data:image/png;base64,AAAA";
const FIGS: Record<number, PageFigure[]> = {
  3: [
    { image: PNG, caption: ["8520, 8521, 8527", "Guide Cylinder and Seal Layout"] },
    { image: PNG, caption: ["Plunger Layout"] },
  ],
};

function packet(): WorkPacket {
  const pages = fixturePages(FIXTURES["manual-85v2.txt"]).map((p) => (FIGS[p.page] ? { ...p, figures: FIGS[p.page] } : p));
  const doc: DocText = { docId: "sm", fileId: null, filename: "manual-85v2.pdf", pages, via: "file" };
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-v2",
    now: "2026-11-02T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model: "8520", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO-V2", title: "Reseal", description: "Pump leaking at the shaft — reseal it.", assetTag: null, site: null, synthetic: true },
    docs: [doc],
    hazardFlags: [],
  });
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}

describe("phasedSteps — numbered actions in three parts, each step carrying its own notes, figures and torque", () => {
  it("groups removal / service / reinstall in order and numbers steps 1..N across the packet", () => {
    const p = packet();
    const groups = phasedSteps(p);
    expect(groups.map((g) => g.phase)).toEqual(["removal", "service", "reinstall"]);
    const numbers = groups.flatMap((g) => g.steps.map((s) => s.number));
    expect(numbers).toEqual(p.steps.map((_, i) => i + 1));
    expect(groups.flatMap((g) => g.steps.map((s) => s.index))).toEqual(p.steps.map((_, i) => i));
  });
  it("a note sits with the step it follows; a placed figure sits with its step; torque links to the step that tightens", () => {
    const p = packet();
    const all = phasedSteps(p).flatMap((g) => g.steps);
    const head = all.find((s) => p.steps[s.index].text.value === "Work the Inlet Head off the Plungers.")!;
    expect(head.notes.map((n) => p.steps[head.index].notes![n].text.value)).toEqual(["Hold the head level so the Plungers are not scratched."]);
    const guide = all.find((s) => (p.steps[s.index].text.value ?? "").startsWith("Pull out the Guide Cylinder"))!;
    expect(guide.figures.map((f) => f.caption[1])).toEqual(["Guide Cylinder and Seal Layout"]);
    const screws = all.find((s) => p.steps[s.index].text.value === "Fit the four (4) head screws and torque per chart.")!;
    expect(screws.measurements.map((m) => p.measurements[m].name.value)).toEqual(["Inlet Head Screws"]);
  });
  it("a figure matched to no step is listed once, by page — never attached to a guessed step", () => {
    const p = packet();
    const placed = phasedSteps(p).flatMap((g) => g.steps.flatMap((s) => s.figures));
    const loose = unplacedFigures(p);
    expect(loose.map((f) => f.caption[0])).toEqual(["Plunger Layout"]);
    expect(placed.some((f) => f.caption[0] === "Plunger Layout")).toBe(false);
  });
  it("control: a V1 packet (no phases) is one group, with figures after a section's last step as before", () => {
    const p = packet();
    const v1: WorkPacket = {
      ...p, version: 1,
      steps: p.steps.map(({ phase: _phase, n: _n, notes: _notes, applicability: _a, inclusion: _i, ...s }) => s),
      figures: (p.figures ?? []).map(({ step: _s, placement: _p, ...f }) => f),
    };
    const groups = phasedSteps(v1);
    expect(groups).toHaveLength(1);
    expect(groups[0].phase).toBeNull();
    expect(groups[0].steps).toHaveLength(p.steps.length);
    expect(unplacedFigures(v1)).toEqual([]);
  });
});

describe("readinessSummary — any blocker or unknown means 'needs review'; it is never 'ready'", () => {
  it("counts blockers, unknowns and pending approval", () => {
    const s = readinessSummary(packet());
    expect(s.status).toBe("needs_review");
    expect(s.lines.some((l) => /5 open questions/.test(l))).toBe(true);
    expect(s.lines.some((l) => /supervisor approval: pending/i.test(l))).toBe(true);
    expect(s.lines.join(" ")).not.toMatch(/safe|ready for service|return(ed)? to service is (approved|authorized)/i);
  });
  it("control: even with nothing open it stays a draft until a supervisor approves", () => {
    // Qualifications and return-to-service acceptance limits are open items too (Codex EGM F18).
    const p = { ...packet(), blockers: [], unknowns: [], qualifications: [], restoration: [], safety: { ...packet().safety, cautions: packet().safety.cautions.filter((c) => c.label !== "unknown") } };
    const s = readinessSummary(p);
    expect(s.status).toBe("draft");
    expect(s.lines.some((l) => /supervisor approval: pending/i.test(l))).toBe(true);
  });
});

describe("measurementRows — the manual's value, a correction, approval and the measured value stay apart", () => {
  it("untouched: the manual column holds the manual value; no correction; not approved; nothing measured", () => {
    const p = packet();
    const [row] = measurementRows(p, emptyRecord(p.packetId));
    expect(row.item).toBe("Inlet Head Screws");
    expect(row.manual.value).toBe(p.measurements[0].value.value);
    expect(row.manual.label).toBe("verified");
    expect(row.correction).toBeNull();
    expect(row.approval).toMatch(/not approved/i);
    expect(row.measured).toBeNull();
    expect(row.steps).toEqual(p.measurements[0].steps!.map((i) => i + 1));
  });
  it("after a correction and a measurement, the manual value is still shown as printed", () => {
    const p0 = packet();
    const printed = p0.measurements[0].value.value;
    const p = applyEdit(p0, { path: "measurements[0].value", action: "set", value: "99 in-lbs" }, "tech@x", "2026-11-02T13:00:00Z");
    const rec = recordMeasurement(emptyRecord(p.packetId), 0, "98 in-lbs", "tech@x", "2026-11-02T13:05:00Z");
    const [row] = measurementRows(p, rec);
    expect(row.manual.value).toBe(printed);
    expect(row.manual.label).toBeNull();
    expect(row.correction?.value).toBe("99 in-lbs");
    expect(row.correction?.by).toBe("tech@x");
    expect(row.measured?.value).toBe("98 in-lbs");
    // a second correction still keeps the printed value, not the first correction
    const p2 = applyEdit(p, { path: "measurements[0].value", action: "set", value: "100 in-lbs" }, "tech@y", "2026-11-02T13:10:00Z");
    expect(measurementRows(p2, rec)[0].manual.value).toBe(printed);
    expect(measurementRows(p2, rec)[0].correction?.value).toBe("100 in-lbs");
  });
  it("EGM F07: marking the value unknown first still keeps the printed value in the manual column", () => {
    const p0 = packet();
    const printed = p0.measurements[0].value.value;
    const p1 = applyEdit(p0, { path: "measurements[0].value", action: "mark_unknown" }, "tech@x", "2026-11-02T13:00:00Z");
    const p2 = applyEdit(p1, { path: "measurements[0].value", action: "set", value: "99 in-lbs" }, "tech@y", "2026-11-02T13:10:00Z");
    const [row] = measurementRows(p2, null);
    expect(row.manual.value).toBe(printed);
    expect(row.correction).toEqual({ value: "99 in-lbs", by: "tech@y", at: "2026-11-02T13:10:00Z" });
  });
  it("EGM F07: marking unknown after a correction is credited to whoever marked it, not the earlier setter", () => {
    const p0 = packet();
    const p1 = applyEdit(p0, { path: "measurements[0].value", action: "set", value: "99 in-lbs" }, "tech@x", "2026-11-02T13:00:00Z");
    const p2 = applyEdit(p1, { path: "measurements[0].value", action: "mark_unknown" }, "tech@y", "2026-11-02T13:10:00Z");
    const [row] = measurementRows(p2, null);
    expect(row.manual.value).toBe(p0.measurements[0].value.value);
    expect(row.correction).toEqual({ value: null, by: "tech@y", at: "2026-11-02T13:10:00Z" });
  });
});
