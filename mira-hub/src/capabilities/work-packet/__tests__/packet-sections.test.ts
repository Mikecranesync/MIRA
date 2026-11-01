/**
 * packet-sections.test.ts — the rest of the #4982 Work Packet: illustrated steps, job hazard
 * analysis, qualifications and return to service. Real parsers + real builder on the invented 9XP
 * fixtures (never real CAT documents). Nothing here is generated: every line is the manufacturer's
 * own text with its page, or Unknown for what the site decides.
 */
import { describe, expect, it } from "vitest";
import { FIXTURES, fixturePages } from "./fixtures";
import { buildDraftPacket } from "../draft";
import { verifyPacket } from "../verify";
import type { DocText, DraftInput, PageFigure, WorkPacket } from "../types";

const PNG = "data:image/png;base64,AAAA";

function doc(name: string, docId: string, figures: Record<number, PageFigure[]> = {}, via: DocText["via"] = "file"): DocText {
  const pages = fixturePages(FIXTURES[name]).map((p) => (figures[p.page] ? { ...p, figures: figures[p.page] } : p));
  return { docId, fileId: null, filename: name, pages, via };
}

function build(docs: DocText[], description: string, hazardFlags: string[] = []): WorkPacket {
  const input: DraftInput = {
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-1",
    now: "2026-11-01T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model: "9XP1000", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO-1", title: "Valve service", description, assetTag: null, site: null, synthetic: true },
    docs,
    hazardFlags,
  };
  const result = buildDraftPacket(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("refused");
  return result.packet;
}

const sheet = () => doc("datasheet-9xp1000.txt", "ds");

describe("illustrated steps — the manufacturer's photos on the page the steps are printed on", () => {
  const photos: PageFigure[] = [
    { image: PNG, caption: ["9XP1000, 9XP1010", "Removal of Valve Assembly"] },
    { image: PNG, caption: ["All Models", "Removal of Valve Plugs"] },
  ];

  it("a section's page photos are attached to that section, once, with their captions and page", () => {
    const p = build([sheet(), doc("manual-cpstyle.txt", "sm", { 2: photos })], "valve service");
    expect(p.steps.some((s) => s.section === "SERVICING THE VALVES")).toBe(true);
    expect(p.figures).toEqual([
      { section: "SERVICING THE VALVES", docId: "sm", filename: "manual-cpstyle.txt", page: 2, image: PNG, caption: ["9XP1000, 9XP1010", "Removal of Valve Assembly"] },
      { section: "SERVICING THE VALVES", docId: "sm", filename: "manual-cpstyle.txt", page: 2, image: PNG, caption: ["All Models", "Removal of Valve Plugs"] },
    ]);
  });

  it("photos on a page with no selected steps are not attached", () => {
    const p = build([sheet(), doc("manual-cpstyle.txt", "sm", { 1: photos })], "valve service");
    expect(p.figures).toEqual([]);
  });

  it("a document known only by its text has no photos", () => {
    const p = build([sheet(), doc("manual-cpstyle.txt", "sm", {}, "chunks")], "valve service");
    expect(p.figures).toEqual([]);
  });
});

describe("job hazard analysis", () => {
  it("one row per manufacturer caution: the hazard is the caution itself, cited; controls are the site's", () => {
    const p = build([sheet(), doc("manual-cpstyle.txt", "sm")], "valve service");
    const verified = p.safety.cautions.filter((c) => c.label === "verified");
    expect(verified.length).toBeGreaterThan(0);
    expect(p.jha).toHaveLength(p.safety.cautions.length);
    for (const [i, c] of p.safety.cautions.entries()) {
      expect(p.jha![i].hazard).toEqual(c);
      expect(p.jha![i].task.value).toBe(`Manual p.${c.source!.page}`);
      expect(p.jha![i].controls).toMatchObject({ value: null, label: "unknown" });
    }
  });

  it("a work-order hazard flag is a row too, never verified", () => {
    const p = build([sheet(), doc("manual-cpstyle.txt", "sm")], "valve service", ["pressure"]);
    const row = p.jha!.at(-1)!;
    expect(row.hazard).toMatchObject({ value: "pressure", label: "proposed" });
    expect(row.controls).toMatchObject({ value: null, label: "unknown" });
  });

  it("the number check refuses verified controls or qualifications; a technician's typed answer is accepted", () => {
    const p = build([sheet(), doc("manual-cpstyle.txt", "sm")], "valve service");
    const src = p.safety.cautions[0].source;
    const forged = structuredClone(p);
    forged.jha![0].controls = { value: "Wear gloves", label: "verified", source: src, basis: "x" };
    forged.qualifications![0] = { value: "Any technician", label: "verified", source: src, basis: "x" };
    const problems = verifyPacket(forged);
    expect(problems.some((m) => m.startsWith("jha[0].controls:"))).toBe(true);
    expect(problems.some((m) => m.startsWith("qualifications[0]:"))).toBe(true);
    const typed = structuredClone(p);
    typed.jha![0].controls = { value: "Site LOTO procedure SP-12", label: "proposed", source: null, basis: "technician edit" };
    typed.qualifications![0] = { value: "Site-qualified pump mechanic", label: "proposed", source: null, basis: "technician edit" };
    expect(verifyPacket(typed)).toEqual([]);
  });
});

describe("qualifications", () => {
  it("are not in manufacturer documents: one Unknown, the site defines who may do the job", () => {
    const p = build([sheet(), doc("manual-cpstyle.txt", "sm")], "valve service");
    expect(p.qualifications).toEqual([expect.objectContaining({ value: null, label: "unknown", basis: expect.stringContaining("site defines") })]);
    expect(p.unknowns.some((u) => /qualification/.test(u.basis))).toBe(false);
  });
});

describe("return to service", () => {
  it("cites the manual's start-up check-list heading, the oil capacity and ratings verbatim, and leaves pass limits unknown", () => {
    const p = build([sheet(), doc("manual-cpstyle.txt", "sm")], "valve service");
    const r = p.restoration!;
    expect(r).toContainEqual(expect.objectContaining({ value: "INLET CONDITION CHECK-LIST", label: "verified", source: expect.objectContaining({ page: 4, docId: "sm" }) }));
    expect(r).toContainEqual(expect.objectContaining({ value: "Crankcase Capacity 12 oz 0.35 l", label: "verified", basis: expect.stringContaining("before start-up") }));
    expect(r).toContainEqual(expect.objectContaining({ value: "Pressure Range 100–1500 psi 6.9–103 bar", label: "verified", basis: expect.stringContaining("do not exceed") }));
    expect(r.at(-1)).toMatchObject({ value: null, label: "unknown", basis: expect.stringContaining("acceptance limits") });
    expect(verifyPacket(p)).toEqual([]);
  });

  it("the check-list subtitle is cited with its heading when it follows it", () => {
    const raw = FIXTURES["manual-cpstyle.txt"].replace("INLET CONDITION CHECK-LIST\nFake Guard Item M5 Hex 10 1.0 2\nReview Before Start-Up\n", "INLET CONDITION CHECK-LIST\nReview Before Start-Up\n");
    const d: DocText = { docId: "sm", fileId: null, filename: "m.pdf", pages: fixturePages(raw), via: "file" };
    const p = build([sheet(), d], "valve service");
    expect(p.restoration!.some((f) => f.value === "INLET CONDITION CHECK-LIST Review Before Start-Up")).toBe(true);
  });

  it("a check-list printed after another reference chart on the same page is still cited", () => {
    const raw = FIXTURES["manual-cpstyle.txt"].replace("INLET CONDITION CHECK-LIST\n", "TECHNICAL BULLETIN REFERENCE CHART\nNo. Subject Models\nINLET CONDITION CHECK-LIST\n");
    const d: DocText = { docId: "sm", fileId: null, filename: "m.pdf", pages: fixturePages(raw), via: "file" };
    const p = build([sheet(), d], "valve service");
    expect(p.restoration!.filter((f) => f.value === "INLET CONDITION CHECK-LIST")).toHaveLength(1);
  });

  it("a verified start-up caution is carried into return to service; an unrelated caution is not", () => {
    const raw = FIXTURES["manual-cpstyle.txt"].replace(
      "3. Grasp Spring Retainer",
      "NOTE: Do not lubricate wicks at initial start-up.\n3. Grasp Spring Retainer",
    );
    const d: DocText = { docId: "sm", fileId: null, filename: "m.pdf", pages: fixturePages(raw), via: "file" };
    const p = build([sheet(), d], "valve service");
    const startup = p.restoration!.filter((f) => /lubricate wicks/.test(f.value ?? ""));
    expect(startup).toHaveLength(1);
    expect(startup[0]).toMatchObject({ label: "verified", source: expect.objectContaining({ page: 2 }) });
    expect(p.restoration!.some((f) => /Relieve all discharge/.test(f.value ?? ""))).toBe(false);
  });
});
