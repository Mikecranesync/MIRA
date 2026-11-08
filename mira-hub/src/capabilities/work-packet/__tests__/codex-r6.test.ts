/**
 * Codex adversarial review round 6 on PR #5173 @ a91b6df57 (2026-11-04): findings F14, F6, F15.
 * F14: a step led by "On Model 7 ZQ30 …" (model split by a space) is this pump's step, not another's.
 * F6: "On Model 7 ZQ50 …" names a model the cover does not list — unresolved, never silently applies.
 * F15: a requested topic with no section in any attached manual leaves the packet incomplete.
 * Fixture is invented (7ZQ manual).
 */
import { describe, expect, it } from "vitest";
import { FIXTURES, fixturePages } from "./fixtures";
import { buildDraftPacket } from "../draft";
import { textApplicability } from "../applicability";
import type { WorkPacket } from "../types";

const BASE = FIXTURES["manual-7zq-notes.txt"];
const COVERED = ["7ZQ10", "7ZQ20", "7ZQ30"];

function run7(text: string, model: string, description = "Pump leaking at the shaft — reseal it per the manufacturer's procedure."): WorkPacket {
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-r6",
    now: "2026-11-04T13:00:00Z",
    identity: { manufacturer: "CAT Pumps", model, catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO-R6", title: "Reseal", description, assetTag: null, site: null, synthetic: true },
    docs: [{ docId: "zq", fileId: null, filename: "7zq.pdf", pages: fixturePages(text), via: "file" }],
    hazardFlags: [],
  });
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}

const stepTexts = (p: WorkPacket) => p.steps.map((s) => s.text.value ?? "");

describe("F14 — a step led by a space-split model name", () => {
  const text = BASE.replace("2. Lift out the Spacer.", "2. On Model 7 ZQ30 lift out the Spacer.");
  it("precondition: the fixture line was replaced", () => {
    expect(text).toContain("On Model 7 ZQ30 lift out the Spacer.");
  });
  it("is kept for 7ZQ30", () => {
    const p = run7(text, "7ZQ30");
    expect(stepTexts(p).some((t) => /lift out the Spacer/i.test(t))).toBe(true);
    expect((p.leftOut ?? []).some((f) => /lift out the Spacer/i.test(f.value ?? ""))).toBe(false);
  });
  it("control: is left out for 7ZQ10", () => {
    const p = run7(text, "7ZQ10");
    expect(stepTexts(p).some((t) => /lift out the Spacer/i.test(t))).toBe(false);
  });
});

describe("F6 — a space-split model the cover does not list", () => {
  it("is unresolved", () => {
    expect(textApplicability("On Model 7 ZQ50 use the long seal.", "7ZQ30", COVERED).kind).toBe("unresolved");
  });
  it("control: a listed model applies", () => {
    expect(textApplicability("On Model 7 ZQ30 use the long seal.", "7ZQ30", COVERED).kind).toBe("applies");
  });
});

describe("F15 — a requested topic the manual has no section for", () => {
  it("leaves the packet incomplete and says which topic", () => {
    const p = run7(BASE, "7ZQ30", "Pump leaking at the shaft and the valves are worn — reseal it and replace the valves per the manufacturer's procedure.");
    expect(p.scope.map((s) => s.value)).toEqual(expect.arrayContaining(["seals", "valves"]));
    expect(p.coverage?.complete).toBe(false);
    expect((p.blockers ?? []).some((b) => /valve/i.test(b.basis))).toBe(true);
  });
  it("control: seals alone against the same manual is not marked incomplete for a missing topic", () => {
    const p = run7(BASE, "7ZQ30");
    expect((p.blockers ?? []).some((b) => /no section for valves/i.test(b.basis))).toBe(false);
  });
});
