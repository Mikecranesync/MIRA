/**
 * Repair list group 1 (egm-review, 2026-11-02), each written red first. Fixtures are invented.
 * F09 — a kit item whose part number depends on the seal material is Proposed, "NBR; material
 *       unconfirmed", and points at the seal-material open question; a part that is the same in
 *       every material column stays Verified.
 * F31 — a note that heads a block is repeated before the first step of every block it heads, even
 *       when that block's steps sit under per-model sub-blocks.
 * F22 — a warning that names the action of the step it follows is shown before that step; a note
 *       that heads a block is shown before its first step; any other note stays after its step.
 */
import { describe, expect, it } from "vitest";
import { FIXTURES, fixturePages } from "./fixtures";
import { buildDraftPacket } from "../draft";
import type { DocText, WorkPacket } from "../types";

function build(docs: [string, string][], model: string, description: string): WorkPacket {
  const d: DocText[] = docs.map(([key, filename], i) => ({ docId: `d${i}`, fileId: null, filename, pages: fixturePages(FIXTURES[key]), via: "file" }));
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111", packetId: "pk-g1", now: "2026-11-03T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model, catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO-G1", title: "Reseal", description, assetTag: null, site: null, synthetic: true },
    docs: d, hazardFlags: [],
  });
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}

describe("F09 — seal parts are not Verified while the seal material is unknown", () => {
  const p = build([["datasheet-9xp1000.txt", "9xp1000.pdf"]], "9XP1000", "Replace the seals and the valves.");
  const item = (desc: string) => p.parts.find((x) => x.item !== null && x.description.value === desc)!;

  it("a part that differs by material column is Proposed, tagged NBR / material unconfirmed", () => {
    const lp = item("Seal, Low-Pressure");
    expect(lp.partNumber.value).toBe("100006");
    expect(lp.partNumber.label).toBe("proposed");
    expect(lp.partNumber.basis).toMatch(/^NBR; material unconfirmed/);
    expect(lp.partNumber.basis).toContain("seal material");
  });

  it("links to the seal-material open question, which stays in the packet", () => {
    expect(p.unknowns.some((u) => /seal material is unknown/.test(u.basis))).toBe(true);
    expect(item("Seal, Low-Pressure").partNumber.basis).toContain("see Unknowns: seal material");
  });

  it("control: a part with the same number in every material column stays Verified", () => {
    const seat = item("Seat");
    expect(seat.partNumber.value).toBe("100008");
    expect(seat.partNumber.label).toBe("verified");
  });
});

const RESEAL = "Pump leaking at the shaft — reseal it per the manufacturer's procedure.";
const TB901 = /See Tech Bulletin 901/;

describe("F31 — a bulletin note heads every block it is printed over", () => {
  const p = build([["manual-7zq-notes.txt", "7zq.pdf"]], "7ZQ10", RESEAL);
  const stepWith = (re: RegExp) => p.steps.filter((s) => (s.notes ?? []).some((n) => re.test(n.text.value ?? "")));

  it("is beside the first packing reassembly step and the first Lo-Pressure Seal step for this model", () => {
    const hits = stepWith(TB901).map((s) => `${s.subheading}#${s.n}`);
    expect(hits).toEqual(["Reassembly of the Packings#1", "Models 7ZQ10, 7ZQ20#1"]);
  });

  it("is not repeated into another model's block, nor left in Safety", () => {
    const other = build([["manual-7zq-notes.txt", "7zq.pdf"]], "7ZQ30", RESEAL);
    const hits = other.steps.filter((s) => (s.notes ?? []).some((n) => TB901.test(n.text.value ?? ""))).map((s) => `${s.subheading}#${s.n}`);
    expect(hits).toEqual(["Reassembly of the Packings#1", "Models 7ZQ30#1"]);
    expect(p.safety.cautions.some((c) => TB901.test(c.value ?? ""))).toBe(false);
  });
});

describe("F22 — a warning comes before the action it protects", () => {
  const p = build([["manual-7zq-notes.txt", "7zq.pdf"]], "7ZQ10", RESEAL);
  const note = (re: RegExp) => {
    const s = p.steps.find((x) => (x.notes ?? []).some((n) => re.test(n.text.value ?? "")))!;
    return { step: s, note: s.notes!.find((n) => re.test(n.text.value ?? ""))! };
  };

  it("a warning naming the step's tool or part is placed before that step", () => {
    const pliers = note(/reverse pliers may damage/);
    expect(pliers.step.text.value).toMatch(/^With a reverse pliers/);
    expect(pliers.note.placement).toBe("before");
    const support = note(/Support the Inlet Head/);
    expect(support.step.text.value).toMatch(/^Tap the rear of the Inlet Head/);
    expect(support.note.placement).toBe("before");
  });

  it("a note that heads a block is placed before its first step", () => {
    expect(note(TB901).note.placement).toBe("before");
  });

  it("control: a plain note about what may happen stays after its step", () => {
    expect(note(/Spacer may stay/).note.placement).toBe("after");
  });

  it("control: a warning about a different part stays after the step it follows", () => {
    const screws = note(/Do not reuse the old Head Screws/);
    expect(screws.step.text.value).toMatch(/^Oil the Plungers/);
    expect(screws.note.placement).toBe("after");
  });
});
