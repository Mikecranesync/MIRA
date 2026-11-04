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
      // EGM F01: the two preparation steps right before the head goes back are part of the reinstall.
      "reinstall|SERVICING THE PLUNGERS|3",
      "reinstall|SERVICING THE PLUNGERS|4",
      "reinstall|SERVICING THE PLUNGERS|5",
      "reinstall|SERVICING THE PLUNGERS|6",
      "reinstall|SERVICING THE PLUNGERS|7",
      "reinstall|SERVICING THE PLUNGERS|8",
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
    // Restriction blockers quote the manual; the reinstall (F01) and check-list (F04) blockers are tested below.
    const blockers = (p.blockers ?? []).filter((b) => b.basis.startsWith("The manual says:"));
    expect(blockers.length).toBe(3); // early style, some installations, and the uncovered model 8590 (F14)
    expect(blockers.every((b) => b.label === "unknown" && b.value === null && b.source?.page === 3)).toBe(true);
    expect(blockers.some((b) => b.basis.includes("8590"))).toBe(true);
    expect(blockers.some((b) => b.basis.includes("early style"))).toBe(true);
    expect(blockers.some((b) => b.basis.includes("For some installations"))).toBe(true);
    const step = p.steps.find((x) => (x.text.value ?? "").startsWith("Fit the Spacer Spring."))!;
    expect(step.applicability?.label).toBe("unknown");
    expect(step.text.label).toBe("proposed");
    expect(step.text.basis).toMatch(/restriction the documents cannot settle/);
  });
});

describe("D6 — a clear hazard analysis and only the torque values the steps use", () => {
  it("JHA holds the CAUTION and the WARNING only, never the notes", () => {
    const p = build("8520");
    const hazards = p.safety.cautions.filter((c) => /^(Before any service|Every system needs)/.test(c.value ?? "")).map((c) => c.value);
    expect(hazards.length).toBe(2);
    expect(p.jha?.map((r) => r.hazard.value)).toEqual(hazards);
    expect(p.safety.cautions.every((c) => !/^(The 85|Hold the head|Do not oil)/.test(c.value ?? ""))).toBe(true);
  });
  it("a NOTE the parser could not read stays in Safety as unknown, but is not a hazard row", () => {
    const text = FIXTURES["manual-85v2.txt"].replace(
      "NOTE: Hold the head level so the Plungers are not scratched.\n",
      "NOTE: Hold the head level so the Plungers are not scratched.\nRemoval of Inlet Head\n",
    );
    const p = build("8520", undefined, manual(text));
    expect(p.safety.cautions.some((c) => c.label === "unknown" && /^NOTE on p\.2 .*could not be placed/.test(c.basis))).toBe(true);
    expect(p.jha?.every((r) => r.hazard.label !== "unknown" && /^(Before any service|Every system needs)/.test(r.hazard.value ?? ""))).toBe(true);
    expect(p.jha?.length).toBe(2);
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

// Codex EGM review of eaef9b876 (2026-11-02), reproduced on the invented manual before fixing.
describe("EGM round 1 — findings reproduced on the fixture", () => {
  it("F01: the preparation steps right before the reinstall are kept, as Proposed", () => {
    const p = build("8520");
    const reinstall = p.steps.filter((s) => s.phase === "reinstall").map((s) => s.text.value);
    expect(reinstall.slice(0, 3)).toEqual([
      "Turn the shaft by hand until the two end Plungers stand out the same amount.",
      "Oil the Plungers.",
      "Slide the Inlet Head back over the Plungers.",
    ]);
    expect(p.steps.filter((s) => s.phase === "reinstall").every((s) => s.inclusion?.label === "proposed")).toBe(true);
  });
  it("F01: the earlier steps of that block are one open question, never called 'not needed'", () => {
    const p = build("8520");
    expect(texts(p)).not.toContain("Push the Seal Retainers onto the Plungers.");
    const b = (p.blockers ?? []).filter((x) => /SERVICING THE PLUNGERS/.test(x.basis) && /steps 1.2/.test(x.basis));
    expect(b.length).toBe(1);
    expect(b[0].label).toBe("unknown");
    expect(b[0].value).toBeNull();
    const lo = p.leftOut?.find((f) => f.value === "Push the Seal Retainers onto the Plungers.");
    expect(lo).toBeDefined();
    expect(lo!.basis).not.toMatch(/part of other work/);
  });
  it("F02: a step that tightens 'in this order' points to the manual's diagram, not copied", () => {
    const p = build("8520");
    const s = p.steps.find((x) => (x.text.value ?? "").endsWith("Torque per chart in this order."))!;
    const n = (s.notes ?? []).find((x) => /diagram/i.test(x.text.value ?? ""));
    expect(n).toBeDefined();
    expect(n!.text.label).toBe("proposed");
    expect(n!.text.value).toMatch(/p\.4/);
    expect(n!.text.value).not.toMatch(/2 4|1 3/);
  });
  it("F03: a note after a step that was left out goes with it, not under the next kept step", () => {
    const p = build("8520");
    expect(noteTexts(p)).not.toContain("Seat the gasket before the retainer.");
    expect(p.leftOut?.some((f) => f.value === "Seat the gasket before the retainer.")).toBe(true);
  });
  it("F04: the check-list line 'service X at every seal servicing' is an open question, not extra work", () => {
    const p = build("8520");
    const b = (p.blockers ?? []).find((x) => /pressure limiter at every seal servicing/.test(x.basis));
    expect(b).toBeDefined();
    expect(b!.label).toBe("unknown");
    expect(b!.source?.page).toBe(5);
    expect(p.scope.map((s) => s.value)).toEqual(["seals"]);
    expect(texts(p).some((t) => /limiter/i.test(t))).toBe(false);
  });
  // Codex review round 3 (F2): the capitals line below this WARNING may be the address block or more
  // of the warning, so it is shown in full as far as read, but Proposed with the reason, not Verified.
  it("F05: a standalone WARNING heading is read, shown (not Verified: its end is uncertain), and is a hazard row", () => {
    const p = build("8520");
    const w = p.safety.cautions.find((c) => (c.value ?? "").startsWith("Every system needs a pressure-limiting device"));
    expect(w).toBeDefined();
    expect(w!.label).toBe("proposed");
    expect(w!.basis).toMatch(/85V PUMPS EUROPE BV.*may be part of it/);
    expect(w!.value).toBe("Every system needs a pressure-limiting device and a separate relief device on the outlet side. Without them the pump or the hose can burst.");
    expect(p.jha?.some((r) => r.hazard.value === w!.value)).toBe(true);
  });
  it("F05 control: a bare WARNING with nothing readable under it stays in Safety as unknown", () => {
    const text = FIXTURES["manual-85v2.txt"].replace("REMOVING THE OUTLET HEAD\n", "WARNING\nREMOVING THE OUTLET HEAD\n");
    const p = build("8520", undefined, manual(text));
    expect(p.safety.cautions.some((c) => c.label === "unknown" && /^WARNING on p\.2/.test(c.basis))).toBe(true);
  });
  it("F14: a note naming a model number the manual does not cover is not settled for this pump", () => {
    const p = build("8520");
    const n = p.steps.flatMap((x) => x.notes ?? []).find((x) => x.text.value === "Models 8520, 8590 take the short Inlet Adapter.");
    if (n) expect(n.text.label).not.toBe("verified");
    expect(shownAsVerified(p)).not.toContain("Models 8520, 8590 take the short Inlet Adapter.");
  });
  it("F40: a negated job ('no valve service') does not add valve work", () => {
    const p = build("8520", "Reseal only; no valve service.");
    expect(p.scope.map((s) => s.value)).toEqual(["seals"]);
    expect(p.steps.some((s) => s.topic === "valves")).toBe(false);
    expect(build("8520", "Reseal it, do not touch the valves.").scope.map((s) => s.value)).toEqual(["seals"]);
  });
  it("F40 control: a negation later in a clause keeps the work asked for before it", () => {
    expect(build("8520", "Reseal pump without removing the valves.").scope.map((s) => s.value)).toEqual(["seals"]);
    expect(build("8520", "Replace all seals except the valve seats.").scope.map((s) => s.value)).toEqual(["seals"]);
  });
});
