/**
 * Follow-ups from the Codex review of #5173: #5200 (F6), #5201 (F15), #5202 (F16).
 * FICTIONAL fixture models only (7ZQ10 / 7ZQ20 / 7ZQ30 covered).
 */
import { describe, expect, it } from "vitest";

import { textApplicability } from "../applicability";
import { buildDraftPacket } from "../draft";
import type { WorkPacket } from "../types";
import { FIXTURES, fixturePages } from "./fixtures";

const COVERED = ["7ZQ10", "7ZQ20", "7ZQ30"];

describe("#5200 — a space-split unknown model later in a model list is never 'applies'", () => {
  it("'Models 7ZQ30, 7 ZQ50' is unresolved", () => {
    expect(textApplicability("Models 7ZQ30, 7 ZQ50 use the long seal.", "7ZQ30", COVERED).kind).toBe("unresolved");
  });
  it("a list without the Models marker is unresolved too", () => {
    expect(textApplicability("7ZQ30 and 7 ZQ50 use the long seal.", "7ZQ30", COVERED).kind).toBe("unresolved");
  });
  it("control: a spaced covered model in the list still applies", () => {
    expect(textApplicability("Models 7ZQ10, 7 ZQ30 use the long seal.", "7ZQ30", COVERED).kind).toBe("applies");
  });
  it("control: a non-model number after a model is not read as a model", () => {
    expect(textApplicability("Model 7ZQ30: use 2 seals.", "7ZQ30", COVERED).kind).toBe("applies");
  });
});

describe("#5200 — conjunction controls", () => {
  it("'7ZQ30 or 7ZQ50' (unspaced unknown after 'or') is unresolved", () => {
    expect(textApplicability("Use on 7ZQ30 or 7ZQ50 only.", "7ZQ30", COVERED).kind).toBe("unresolved");
  });
  it("control: '7ZQ10 and 7ZQ20' does not apply to 7ZQ30", () => {
    expect(textApplicability("Models 7ZQ10 and 7ZQ20 use the short seal.", "7ZQ30", COVERED).kind).not.toBe("applies");
  });
});

const BASE = FIXTURES["manual-7zq-notes.txt"];
const VALVES_JOB = "Pump leaking at the shaft and the valves are worn — reseal it and replace the valves per the manufacturer's procedure.";

function run7(text: string, model: string, description: string): WorkPacket {
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-5201",
    now: "2026-11-05T13:00:00Z",
    identity: { manufacturer: "CAT Pumps", model, catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO-5201", title: "Reseal", description, assetTag: null, site: null, synthetic: true },
    docs: [{ docId: "zq", fileId: null, filename: "7zq.pdf", pages: fixturePages(text), via: "file" }],
    hazardFlags: [],
  });
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}

const withValves = (models: string) =>
  BASE.replace("===== PAGE 3 =====\n", `===== PAGE 3 =====\nSERVICING THE VALVES\nModels ${models}\n1. Remove the Valve Plug.\n2. Lift out the Valve Assembly.\n`);

describe("#5201 — a topic is covered only by a section for this model", () => {
  it("precondition: the valves block was inserted", () => {
    expect(withValves("7ZQ10")).toContain("SERVICING THE VALVES\nModels 7ZQ10\n1. Remove the Valve Plug.");
  });
  it("valves headed only for 7ZQ10 leave a 7ZQ30 packet incomplete, with a blocker naming valves", () => {
    const p = run7(withValves("7ZQ10"), "7ZQ30", VALVES_JOB);
    expect(p.scope.map((s) => s.value)).toEqual(expect.arrayContaining(["seals", "valves"]));
    expect(p.coverage?.complete).toBe(false);
    expect((p.blockers ?? []).some((b) => /no section for valves that applies to this pump/i.test(b.basis))).toBe(true);
    const row = p.coverage?.sections.find((c) => c.heading === "No section for valves");
    expect(row?.reasons.join(" ")).toMatch(/only section for valves is for other models/);
  });
  it("control: valves headed for 7ZQ30 are covered", () => {
    const p = run7(withValves("7ZQ30"), "7ZQ30", VALVES_JOB);
    expect(p.coverage?.sections.some((c) => c.heading === "No section for valves")).toBe(false);
    expect((p.steps ?? []).some((s) => /Valve Plug/.test(s.text.value ?? ""))).toBe(true);
  });
});

describe("#5202 — a step led by a model the cover does not list is never silently dropped", () => {
  const SEALS_JOB = "Pump leaking at the shaft — reseal it per the manufacturer's procedure.";
  const unlisted = BASE.replace("2. Lift out the Spacer.", "2. On Model 7 ZQ50 lift out the Spacer.");
  const otherCovered = BASE.replace("2. Lift out the Spacer.", "2. On Model 7ZQ10 lift out the Spacer.");
  it("precondition: the fixture lines were replaced", () => {
    expect(unlisted).toContain("2. On Model 7 ZQ50 lift out the Spacer.");
    expect(otherCovered).toContain("2. On Model 7ZQ10 lift out the Spacer.");
  });
  it("an unlisted lead (7 ZQ50) is not filed as 'step for other models'", () => {
    const p = run7(unlisted, "7ZQ30", SEALS_JOB);
    expect((p.leftOut ?? []).some((f) => /lift out the Spacer/i.test(f.value ?? "") && /other models/.test(f.basis))).toBe(false);
  });
  it("an unlisted lead blocks the packet and names the model", () => {
    const p = run7(unlisted, "7ZQ30", SEALS_JOB);
    expect((p.blockers ?? []).some((b) => /7 ?ZQ50/.test(b.basis))).toBe(true);
    expect(p.steps.some((s) => /lift out the Spacer/i.test(s.text.value ?? "") && s.text.label === "verified")).toBe(false);
  });
  it("control: a step led by another covered model (7ZQ10) is still left out as other models", () => {
    const p = run7(otherCovered, "7ZQ30", SEALS_JOB);
    expect(p.steps.some((s) => /lift out the Spacer/i.test(s.text.value ?? ""))).toBe(false);
    expect((p.leftOut ?? []).some((f) => /lift out the Spacer/i.test(f.value ?? "") && /other models/.test(f.basis))).toBe(true);
  });
});
