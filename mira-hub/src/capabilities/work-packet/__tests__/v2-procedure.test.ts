/**
 * v2-procedure.test.ts — Work Packet V2, real parser + real builder on the invented 85-frame manual
 * (./fixtures/manual-85v2.ts). Reproduces the V1 defects found on a real 3520 reseal packet
 * (2026-11-02): notes for other models shown as Verified, wrong-model figures, "reseal" pulling in
 * valve work, head removal/reinstall missing from the sequence, unsettled bulletin restrictions
 * shown as Verified, every note repeated in the JHA, and a torque value no step uses.
 */
import { describe, expect, it } from "vitest";
import { FIXTURES, fixturePages } from "./fixtures";
import { buildDraftPacket } from "../draft";
import { verifyPacket } from "../verify";
import { applyEdit } from "../edits";
import type { DocText, DraftInput, PageFigure, WorkPacket } from "../types";

const PNG = "data:image/png;base64,AAAA";
const FIGS: Record<number, PageFigure[]> = {
  3: [
    { image: PNG, caption: ["8531, 8535, 8537, 8541, 8545", "Spacer and Guide Ring Layout"] },
    { image: PNG, caption: ["8520, 8521, 8527", "Guide Cylinder and Seal Layout"] },
    { image: PNG, caption: ["8650", "Lip Seal Layout"] },
  ],
};

function manual(text = FIXTURES["manual-85v2.txt"]): DocText {
  const pages = fixturePages(text).map((p) => (FIGS[p.page] ? { ...p, figures: FIGS[p.page] } : p));
  return { docId: "sm", fileId: null, filename: "manual-85v2.pdf", pages, via: "file" };
}

function build(model: string, description = "Pump leaking at the shaft — reseal it per the manufacturer's procedure.", doc: DocText = manual()): WorkPacket {
  const input: DraftInput = {
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-v2",
    now: "2026-11-02T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model, catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO-V2", title: "Reseal", description, assetTag: null, site: null, synthetic: true },
    docs: [doc],
    hazardFlags: [],
  };
  const r = buildDraftPacket(input);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}

const texts = (p: WorkPacket) => p.steps.map((s) => s.text.value ?? "");
const noteTexts = (p: WorkPacket) => p.steps.flatMap((s) => (s.notes ?? []).map((n) => n.text.value ?? ""));
const shownAsVerified = (p: WorkPacket) => [
  ...p.safety.cautions.filter((c) => c.label === "verified").map((c) => c.value ?? ""),
  ...p.steps.flatMap((s) => (s.notes ?? []).filter((n) => n.text.label === "verified").map((n) => n.text.value ?? "")),
  ...p.steps.filter((s) => s.text.label === "verified").map((s) => s.text.value ?? ""),
];

describe("D3 — 'reseal' is seal work, not valve work", () => {
  it("scope is seals only; no valve steps, no valve torque", () => {
    const p = build("8520");
    expect(p.scope.map((s) => s.value)).toEqual(["seals"]);
    expect(p.steps.some((s) => s.topic === "valves")).toBe(false);
    expect(texts(p)).not.toContain("Remove the six (6) Valve Caps.");
    expect(p.measurements.map((m) => m.name.value)).not.toContain("Valve Caps");
  });
  it("control: asking for valve work still gets the valve steps", () => {
    expect(texts(build("8520", "reseal and valve service"))).toContain("Remove the six (6) Valve Caps.");
  });
});

describe("D4 — the complete applicable job sequence, in the manual's order", () => {
  it("before-you-start caution, head removal, seal work, head reinstall — nothing invented", () => {
    const p = build("8520");
    expect(p.steps.map((s) => `${s.phase}|${s.section}|${s.n}`)).toEqual([
      "removal|REMOVING THE OUTLET HEAD|1",
      "removal|REMOVING THE OUTLET HEAD|2",
      "removal|REMOVING THE INLET HEAD|1",
      "removal|REMOVING THE INLET HEAD|2",
      "service|SERVICING THE SEALS|1",
      "service|SERVICING THE SEALS|2",
      "service|SERVICING THE SEALS|3",
      "service|SERVICING THE SEALS|1",
      "service|SERVICING THE SEALS|2",
      "service|SERVICING THE SEALS|1",
      "service|SERVICING THE SEALS|2",
      "reinstall|SERVICING THE PLUNGERS|2",
      "reinstall|SERVICING THE PLUNGERS|3",
      "reinstall|SERVICING THE PLUNGERS|4",
      "reinstall|SERVICING THE PLUNGERS|5",
    ]);
    // Every step is the manual's own line, cited.
    const lines = FIXTURES["manual-85v2.txt"].split("\n");
    for (const s of p.steps) {
      // Verified = this exact model; a line that also names other models, or one limited by an
      // unsettled restriction, is the manual's own words but only Proposed for this pump.
      expect(s.text.label).toBe(s.applicability ? "proposed" : "verified");
      expect(lines.some((l) => l.endsWith(s.text.value ?? "\u0000"))).toBe(true);
    }
    // No step twice.
    const keys = p.steps.map((s) => `${s.text.source?.page}|${s.text.source?.line}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("the plunger work before the reinstall is left out and said so; inclusion is a proposal", () => {
    const p = build("8520");
    expect(texts(p)).not.toContain("Thread on the Plunger Retainer. Torque per chart.");
    const reinstall = p.steps.filter((s) => s.phase === "reinstall");
    expect(reinstall.every((s) => s.inclusion?.label === "proposed")).toBe(true);
    expect(p.leftOut?.some((f) => f.value === "Thread on the Plunger Retainer. Torque per chart.")).toBe(true);
    const removal = p.steps.filter((s) => s.phase === "removal");
    expect(removal.every((s) => s.inclusion?.label === "proposed" && /Inlet Head|Outlet Head/.test(s.inclusion.basis))).toBe(true);
  });
  it("the start-up note rides with its step and in return to service", () => {
    const p = build("8520");
    const last = p.steps.at(-1)!;
    expect((last.notes ?? []).map((n) => n.text.value)).toContain("Do not oil the wicks at first start-up.");
    expect(p.restoration?.some((r) => r.value === "Do not oil the wicks at first start-up.")).toBe(true);
    expect(p.restoration?.some((r) => /After service, open the water supply/.test(r.value ?? ""))).toBe(true);
  });
});

describe("D1 — notes for other models are never shown for this pump", () => {
  it("8520: other-model notes are left out, not Verified anywhere", () => {
    const p = build("8520");
    const shown = shownAsVerified(p).join("\n");
    for (const t of [
      "The 8545, 8541 do not have Guide Rings.",
      "Fit the Lip Spacer on the plunger, not in the head bore.",
      "The 8560 valve stack is one piece and lifts out whole.",
      "Press the Lip Seal into the head bore.",
    ]) {
      expect(shown).not.toContain(t);
    }
    expect(p.leftOut?.some((f) => f.value === "The 8545, 8541 do not have Guide Rings.")).toBe(true);
  });
  it("control: 8541 gets its own block and note, and not the 8520 ones", () => {
    const p = build("8541");
    expect(texts(p)).toContain("Press the Lip Seal into the head bore.");
    expect(noteTexts(p)).toContain("Fit the Lip Spacer on the plunger, not in the head bore.");
    expect(noteTexts(p)).toContain("The 8545, 8541 do not have Guide Rings.");
    expect(texts(p)).not.toContain("Press the Lip Seal into the Inlet Adapter, spring up.");
    expect(texts(p)).not.toContain("Pull out the Guide Cylinder (8520, 8521, 8527) with two screwdrivers.");
  });
  it("8560: an 'except 8560' step is left out", () => {
    expect(texts(build("8560"))).not.toContain("Remove the Spacer Spring (except 8560).");
  });
  it("a note sits next to the step it follows", () => {
    const p = build("8520");
    const s = p.steps.find((x) => x.text.value === "Work the Inlet Head off the Plungers.")!;
    expect((s.notes ?? []).map((n) => n.text.value)).toEqual(["Hold the head level so the Plungers are not scratched."]);
  });
  it("a line that also covers other models is shown with a Proposed 'read your part' note", () => {
    const p = build("8520");
    const step = p.steps.find((x) => (x.text.value ?? "").startsWith("Press the Guide Cylinder"))!;
    expect(step.applicability?.label).toBe("proposed");
    expect(step.applicability?.value).toContain("8520");
    expect(step.text.label).toBe("proposed");
    const mixed = p.steps.flatMap((x) => x.notes ?? []).find((n) => (n.text.value ?? "").startsWith("Models 8531, 8535 use a Spacer."))!;
    expect(mixed.applicability?.label).toBe("proposed");
    expect(mixed.text.label).toBe("proposed");
    expect(mixed.text.basis).toMatch(/also names other models/);
  });
});

describe("D5 — restrictions the documents cannot settle become blockers", () => {
  it("bulletin / style / application restrictions are quoted, cited and left open", () => {
    const p = build("8520");
    const blockers = p.blockers ?? [];
    expect(blockers.length).toBe(2);
    expect(blockers.every((b) => b.label === "unknown" && b.value === null && b.source?.page === 3)).toBe(true);
    expect(blockers.some((b) => b.basis.includes("early style"))).toBe(true);
    expect(blockers.some((b) => b.basis.includes("For some installations"))).toBe(true);
    const step = p.steps.find((x) => (x.text.value ?? "").startsWith("Fit the Spacer Spring."))!;
    expect(step.applicability?.label).toBe("unknown");
    expect(step.text.label).toBe("proposed");
    expect(step.text.basis).toMatch(/restriction the documents cannot settle/);
  });
});

describe("D6 — a clear hazard analysis and only the torque values the steps use", () => {
  it("JHA holds the CAUTION only, never the notes", () => {
    const p = build("8520");
    expect(p.jha?.map((r) => r.hazard.value)).toEqual([p.safety.cautions[0].value]);
    expect(p.safety.cautions.every((c) => !/^(The 85|Hold the head|Do not oil)/.test(c.value ?? ""))).toBe(true);
  });
  it("a NOTE the parser could not read stays in Safety as unknown, but is not a hazard row", () => {
    const text = FIXTURES["manual-85v2.txt"].replace(
      "NOTE: Hold the head level so the Plungers are not scratched.\n",
      "NOTE: Hold the head level so the Plungers are not scratched.\nRemoval of Inlet Head\n",
    );
    const p = build("8520", undefined, manual(text));
    expect(p.safety.cautions.some((c) => c.label === "unknown" && /^NOTE on p\.2 .*could not be placed/.test(c.basis))).toBe(true);
    expect(p.jha?.map((r) => r.hazard.value)).toEqual([p.safety.cautions[0].value]);
  });
  it("control: a CAUTION the parser could not read is still a hazard row (unknown)", () => {
    const text = FIXTURES["manual-85v2.txt"].replace(
      "After service, open the water supply, start the drive and watch the gauge for leaks.\n",
      "After service, open the water supply, start the drive and watch the gauge for leaks.\nRemoval of Valve Cap\n",
    );
    const p = build("8520", undefined, manual(text));
    expect(p.safety.cautions.some((c) => c.label === "unknown" && /^CAUTION on p\.2 .*could not be placed/.test(c.basis))).toBe(true);
    expect(p.jha?.some((r) => r.hazard.label === "unknown" && /^CAUTION/.test(r.hazard.basis))).toBe(true);
  });
  it("torque rows are the ones the included steps tighten, linked to those steps", () => {
    const p = build("8520");
    expect(p.measurements.map((m) => m.name.value)).toEqual(["Inlet Head Screws", "Outlet Head Screws"]);
    const inlet = p.measurements[0];
    expect(inlet.link?.label).toBe("proposed");
    expect(inlet.steps?.map((i) => p.steps[i].text.value)).toEqual(["Fit the four (4) head screws and torque per chart."]);
    expect(p.leftOut?.some((f) => f.value === "Plunger Retainer")).toBe(true);
  });
});

describe("D2 — figures follow the caption's model list and the step they show", () => {
  it("wrong-model and unknown-model captions are left out; the 8520 figure sits with its step", () => {
    const p = build("8520");
    expect(p.figures?.map((f) => f.caption[1])).toEqual(["Guide Cylinder and Seal Layout"]);
    const fig = p.figures![0];
    expect(p.steps[fig.step!].text.value).toBe("Pull out the Guide Cylinder (8520, 8521, 8527) with two screwdrivers.");
    expect(fig.placement?.label).toBe("proposed");
    expect(p.leftOut?.filter((f) => /figure/i.test(f.basis)).length).toBe(2);
  });
});

describe("V2 packets keep the trust rules and the edit paths", () => {
  it("the assembled packet passes the verifier", () => {
    expect(verifyPacket(build("8520"))).toEqual([]);
  });
  it("a step note can be struck, and its return-to-service copy follows", () => {
    const p = build("8520");
    const i = p.steps.length - 1;
    const j = (p.steps[i].notes ?? []).findIndex((n) => n.text.value === "Do not oil the wicks at first start-up.");
    const out = applyEdit(p, { path: `steps[${i}].notes[${j}].text`, action: "strike" }, "Tech", "2026-11-02T13:00:00Z");
    const copy = out.restoration!.find((r) => r.copyOf === `steps[${i}].notes[${j}].text`)!;
    expect(copy.struck).toBe(true);
    expect(verifyPacket(out)).toEqual([]);
  });
});
