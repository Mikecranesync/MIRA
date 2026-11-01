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
import { applyEdit } from "../edits";
import type { DocText, DraftInput, PageFigure, WorkPacket } from "../types";

const PNG = "data:image/png;base64,AAAA";

function doc(name: string, docId: string, figures: Record<number, PageFigure[]> = {}, via: DocText["via"] = "file"): DocText {
  const pages = fixturePages(FIXTURES[name]).map((p) => (figures[p.page] ? { ...p, figures: figures[p.page] } : p));
  return { docId, fileId: null, filename: name, pages, via };
}

function build(docs: DocText[], description: string, hazardFlags: string[] = [], model = "9XP1000"): WorkPacket {
  const input: DraftInput = {
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-1",
    now: "2026-11-01T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model, catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
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
      expect(p.jha![i].hazard).toEqual({ ...c, copyOf: `safety.cautions[${i}]` });
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

describe("data-sheet ratings — one value per model, or unknown (Codex #5062 F19, F20)", () => {
  const SHEET = FIXTURES["datasheet-9xp1000.txt"];
  const ONE_BLOCK = "9XP1000, 9XP1000CS\nFlow 7.4 gpm 28 lpm\nPressure Range 100\u20131500 psi 6.9\u2013103 bar\nPump RPM* 1725 rpm 1725 rpm\n";
  const sheetDoc = (raw: string, docId = "ds", filename = "datasheet-9xp1000.txt"): DocText => ({ docId, fileId: null, filename, pages: fixturePages(raw), via: "file" });
  const ratings = (p: WorkPacket) => p.restoration!.filter((f) => /Flow|Pressure Range|Pump RPM/.test(f.value ?? f.basis));

  const TWO_BLOCKS = "9XP1000\nFlow 7.4 gpm 28 lpm\nPressure Range 100\u20131500 psi 6.9\u2013103 bar\nPump RPM* 1725 rpm 1725 rpm\n9XP1000CS\nFlow 5.0 gpm 19 lpm\nPressure Range 100\u2013750 psi 6.9\u201352 bar\nPump RPM* 860 rpm 860 rpm\n";
  const values = (p: WorkPacket) => ratings(p).map((f) => `${f.label}:${f.value}`);

  it("a sheet with a block per model gives each model only its own block's values", () => {
    expect(SHEET).toContain(ONE_BLOCK);
    const raw = SHEET.replace(ONE_BLOCK, TWO_BLOCKS);
    const a = build([sheetDoc(raw), doc("manual-cpstyle.txt", "sm")], "valve service");
    expect(values(a)).toEqual(["verified:Pressure Range 100\u20131500 psi 6.9\u2013103 bar", "verified:Flow 7.4 gpm 28 lpm", "verified:Pump RPM 1725 rpm 1725 rpm"]);
    const cs = build([sheetDoc(raw)], "valve service", [], "9XP1000CS");
    expect(values(cs)).toEqual(["verified:Pressure Range 100\u2013750 psi 6.9\u201352 bar", "verified:Flow 5.0 gpm 19 lpm", "verified:Pump RPM 860 rpm 860 rpm"]);
    expect(verifyPacket(a)).toEqual([]);
    expect(verifyPacket(cs)).toEqual([]);
  });

  it("two different values that cannot be tied to a model give a cited unknown, never the first", () => {
    const raw = SHEET.replace(ONE_BLOCK, TWO_BLOCKS.replace("9XP1000\n", "").replace("9XP1000CS\n", "Notes\n"));
    const p = build([sheetDoc(raw), doc("manual-cpstyle.txt", "sm")], "valve service");
    const r = ratings(p);
    expect(r).toHaveLength(3);
    for (const f of r) {
      expect(f).toMatchObject({ value: null, label: "unknown", basis: expect.stringContaining("more than one") });
      expect(f.source).not.toBeNull();
    }
    expect(p.restoration!.some((f) => f.label === "verified" && /1500|1725|750|860/.test(f.value ?? ""))).toBe(false);
    // the item printed once (crankcase capacity) is still verified
    expect(p.restoration).toContainEqual(expect.objectContaining({ value: "Crankcase Capacity 12 oz 0.35 l", label: "verified" }));
    expect(verifyPacket(p)).toEqual([]);
  });

  it("a value printed only for other models is a cited unknown for this one", () => {
    const raw = SHEET.replace(ONE_BLOCK, TWO_BLOCKS.slice(TWO_BLOCKS.indexOf("9XP1000CS\n")));
    const p = build([sheetDoc(raw), doc("manual-cpstyle.txt", "sm")], "valve service");
    expect(ratings(p)).toHaveLength(3);
    for (const f of ratings(p)) expect(f).toMatchObject({ value: null, label: "unknown", basis: expect.stringContaining("only for other models (9XP1000CS)") });
  });

  it("a second block for a geared variant (ending at an Engine RPM line) does not touch this model's ratings", () => {
    const raw = SHEET.replace(ONE_BLOCK, ONE_BLOCK + "Weight 19.9 lbs 9 kg\n9XP1000CSSG1\nFlow 7.2 gpm 27 lpm\nPressure Range 100\u20131500 psi 6.9\u2013103 bar\nEngine RPM 3450 rpm 3450 rpm\nWeight 26.5 lbs 12 kg\n");
    const p = build([sheetDoc(raw), doc("manual-cpstyle.txt", "sm")], "valve service");
    expect(values(p)).toEqual(["verified:Pressure Range 100\u20131500 psi 6.9\u2013103 bar", "verified:Flow 7.4 gpm 28 lpm", "verified:Pump RPM 1725 rpm 1725 rpm"]);
    expect(p.restoration).toContainEqual(expect.objectContaining({ value: "Crankcase Capacity 12 oz 0.35 l", label: "verified" }));
  });

  // Round 13 F19: a digits-only model heading, and a non-rating row inside a block.
  const NUMERIC = SHEET.split("9XP1000CS").join("9001"); // roster: 9XP1000, 9001, 9XP1000G
  const NUMERIC_BLOCK = "9001\nFlow 5.0 gpm 19 lpm\nPressure Range 100–750 psi 6.9–52 bar\nPump RPM* 860 rpm 860 rpm\n";
  const unknowns = (p: WorkPacket) => ratings(p).map((f) => `${f.label}:${f.value}:${f.source ? "cited" : "uncited"}`);

  it("a digits-only heading from the sheet's model list scopes its block to that model only", () => {
    const raw = NUMERIC.replace("9XP1000, 9001\nFlow 7.4 gpm 28 lpm\nPressure Range 100–1500 psi 6.9–103 bar\nPump RPM* 1725 rpm 1725 rpm\n", NUMERIC_BLOCK);
    expect(raw).toContain(NUMERIC_BLOCK);
    for (const model of ["9XP1000", "9XP1000G"]) {
      const p = build([sheetDoc(raw)], "valve service", [], model);
      expect(unknowns(p)).toEqual(["unknown:null:cited", "unknown:null:cited", "unknown:null:cited"]);
      expect(ratings(p).every((f) => f.basis.includes("only for other models (9001)"))).toBe(true);
    }
    const own = build([sheetDoc(raw)], "valve service", [], "9001");
    expect(values(own)).toEqual(["verified:Pressure Range 100–750 psi 6.9–52 bar", "verified:Flow 5.0 gpm 19 lpm", "verified:Pump RPM 860 rpm 860 rpm"]);
  });

  it("an Engine RPM row in the middle of a block does not let the rest of the block apply to every model", () => {
    const mid = TWO_BLOCKS.replace("Flow 5.0 gpm 19 lpm\n", "Flow 5.0 gpm 19 lpm\nEngine RPM 3450 rpm 3450 rpm\n");
    const raw = SHEET.replace(ONE_BLOCK, mid);
    const a = build([sheetDoc(raw), doc("manual-cpstyle.txt", "sm")], "valve service");
    expect(values(a)).toEqual(["verified:Pressure Range 100–1500 psi 6.9–103 bar", "verified:Flow 7.4 gpm 28 lpm", "verified:Pump RPM 1725 rpm 1725 rpm"]);
    const cs = build([sheetDoc(raw)], "valve service", [], "9XP1000CS");
    expect(values(cs)).toEqual(["verified:Pressure Range 100–750 psi 6.9–52 bar", "verified:Flow 5.0 gpm 19 lpm", "verified:Pump RPM 860 rpm 860 rpm"]);
    const g = build([sheetDoc(raw)], "valve service", [], "9XP1000G");
    expect(unknowns(g)).toEqual(["unknown:null:cited", "unknown:null:cited", "unknown:null:cited"]);
    // the common section still applies to every model
    expect(g.restoration).toContainEqual(expect.objectContaining({ value: "Crankcase Capacity 12 oz 0.35 l", label: "verified" }));
  });

  it("on a sheet with model blocks, a rating outside any block or the common section is a cited unknown", () => {
    const raw = SHEET.replace("SPECIFICATIONS U.S. Measure Metric Measure\n", "SPECIFICATIONS U.S. Measure Metric Measure\nFlow 9.9 gpm 37 lpm\n");
    const p = build([sheetDoc(raw), doc("manual-cpstyle.txt", "sm")], "valve service");
    const flow = ratings(p).filter((f) => /Flow/.test(f.value ?? f.basis));
    expect(flow).toHaveLength(1);
    expect(flow[0]).toMatchObject({ value: null, label: "unknown", basis: expect.stringContaining("cannot be tied to a model") });
    expect(flow[0].source).not.toBeNull();
    expect(verifyPacket(p)).toEqual([]);
  });

  it("a heading naming a model the sheet does not list leaves its block's ratings unknown", () => {
    const raw = SHEET.replace(ONE_BLOCK, TWO_BLOCKS.replace("9XP1000CS\n", "7777\n"));
    // Fail closed for every model: "7777" may be a misread of any model on the sheet, so even the
    // model with its own clean block gets Unknown rather than a value that may be contradicted.
    for (const model of ["9XP1000G", "9XP1000"]) {
      const p = build([sheetDoc(raw), doc("manual-cpstyle.txt", "sm")], "valve service", [], model);
      expect(unknowns(p)).toEqual(["unknown:null:cited", "unknown:null:cited", "unknown:null:cited"]);
      expect(ratings(p).every((f) => f.basis.includes("cannot be tied to a model"))).toBe(true);
    }
  });

  // Round 14 F19: heading formats. A heading for other models, however it is typed, never lets its
  // ratings reach this model as Verified.
  const OTHERS = "Flow 10 gpm 38 lpm\nPressure Range 100\u20133000 psi 6.9\u2013207 bar\nPump RPM* 1700 rpm 1700 rpm\n";
  for (const [name, head] of [
    ["space-separated", "9XP1000CS 9XP1000G"],
    ["trailing comma", "9XP1000CS, 9XP1000G,"],
    ["comma-separated (control)", "9XP1000CS, 9XP1000G"],
  ] as const) {
    it(`a ${name} heading for other models gives this model cited unknowns, and those models their values`, () => {
      const raw = SHEET.replace(ONE_BLOCK, `${head}\n${OTHERS}`);
      const p = build([sheetDoc(raw), doc("manual-cpstyle.txt", "sm")], "valve service");
      expect(unknowns(p)).toEqual(["unknown:null:cited", "unknown:null:cited", "unknown:null:cited"]);
      expect(ratings(p).every((f) => f.basis.includes("only for other models (9XP1000CS, 9XP1000G)"))).toBe(true);
      const g = build([sheetDoc(raw)], "valve service", [], "9XP1000G");
      expect(values(g)).toEqual(["verified:Pressure Range 100\u20133000 psi 6.9\u2013207 bar", "verified:Flow 10 gpm 38 lpm", "verified:Pump RPM 1700 rpm 1700 rpm"]);
    });
  }

  it("a heading that names models in words it cannot read leaves its ratings unknown for every model", () => {
    const raw = SHEET.replace(ONE_BLOCK, `Models 9XP1000CS and 9XP1000G only\n${OTHERS}`);
    for (const model of ["9XP1000", "9XP1000G"]) {
      const p = build([sheetDoc(raw), doc("manual-cpstyle.txt", "sm")], "valve service", [], model);
      expect(unknowns(p)).toEqual(["unknown:null:cited", "unknown:null:cited", "unknown:null:cited"]);
      expect(ratings(p).every((f) => f.basis.includes("cannot be tied to a model"))).toBe(true);
    }
  });

  // #5101 (Codex #5062 round 15 F19): a restriction naming numeric models the sheet does not list,
  // in any wording, never lets its ratings reach another model as Verified.
  for (const head of ["Model 7777 only", "Models 7777 and 7778 only", "For model 7777:", "7777 / 7778 pumps", "Gear-drive models only", "CS versions only", "Belt drive only", "Geared units only", "Stainless steel heads", "Gearbox drive"]) {
    it(`a "${head}" restriction above the only rating block leaves every rating a cited unknown`, () => {
      const raw = SHEET.replace(ONE_BLOCK, `${head}\n${OTHERS}`);
      for (const model of ["9XP1000", "9XP1000G"]) {
        const p = build([sheetDoc(raw), doc("manual-cpstyle.txt", "sm")], "valve service", [], model);
        expect(unknowns(p)).toEqual(["unknown:null:cited", "unknown:null:cited", "unknown:null:cited"]);
        expect(p.restoration!.some((f) => f.label === "verified" && /3000|10 gpm|1700/.test(f.value ?? ""))).toBe(false);
      }
    });
  }

  it("a line naming a model in words between blocks does not inherit the block above it", () => {
    // Block for 9XP1000, then a restriction the parser cannot read, then more ratings: those later
    // ratings are not 9XP1000's (and not anyone's for sure).
    const raw = SHEET.replace(ONE_BLOCK, `9XP1000\nFlow 7.4 gpm 28 lpm\nModel 7777 only\nPressure Range 100\u20133000 psi 6.9\u2013207 bar\n`);
    const p = build([sheetDoc(raw), doc("manual-cpstyle.txt", "sm")], "valve service");
    const pressure = ratings(p).filter((f) => /Pressure Range/.test(f.value ?? f.basis));
    expect(pressure).toHaveLength(1);
    expect(pressure[0]).toMatchObject({ value: null, label: "unknown" });
  });

  it("a lone four-digit line far from any rating block does not touch a sheet without model blocks", () => {
    // Control: the 9XP2000-style sheet prints an address with a street number on its last page.
    const p = build([sheetDoc(FIXTURES["datasheet-9xp2000.txt"], "ds", "datasheet-9xp2000.txt")], "valve service", [], "9XP2000");
    expect(values(p)).toEqual(["verified:Pressure Range 100\u20132000 psi 6.9\u2013138 bar", "verified:Flow 25 gpm 94.6 lpm", "verified:Pump RPM 870 rpm 870 rpm"]);
  });

  it("a compact heading (9XP2000/C) scopes its block to both models it names", () => {
    const BIG = FIXTURES["datasheet-9xp2000.txt"];
    const head = "SPECIFICATIONS U.S. Measure Metric Measure\n";
    const tail = "*Pump minimum is 100 RPM.\n";
    expect(BIG).toContain(head);
    expect(BIG).toContain(tail);
    const raw = BIG.replace(head, head + "9XP2000/C\n").replace(tail, "9XP2050\nFlow 30 gpm 113 lpm\nPump Pressure Range 100\u20131800 psi 6.9\u2013124 bar\nPump RPM* 950 rpm 950 rpm\n" + tail);
    for (const model of ["9XP2000", "9XP2000C"]) {
      const p = build([sheetDoc(raw, "ds", "datasheet-9xp2000.txt")], "valve service", [], model);
      expect(values(p)).toEqual(["verified:Pressure Range 100\u20132000 psi 6.9\u2013138 bar", "verified:Flow 25 gpm 94.6 lpm", "verified:Pump RPM 870 rpm 870 rpm"]);
    }
  });

  it("the same value printed twice on one sheet is still one verified line", () => {
    const twice = SHEET.replace(ONE_BLOCK, ONE_BLOCK + "Flow 7.4 gpm 28 lpm\n");
    const p = build([sheetDoc(twice), doc("manual-cpstyle.txt", "sm")], "valve service");
    expect(ratings(p).filter((f) => f.value === "Flow 7.4 gpm 28 lpm" && f.label === "verified")).toHaveLength(1);
  });

  it("two sheets that disagree on oil capacity give one cited unknown, no fill amount verified", () => {
    const other = SHEET.replace("Crankcase Capacity 12 oz 0.35 l", "Crankcase Capacity 17 oz 0.5 l");
    const p = build([sheetDoc(SHEET), sheetDoc(other, "ds2", "copy.txt"), doc("manual-cpstyle.txt", "sm")], "valve service");
    const cap = p.restoration!.filter((f) => /Crankcase Capacity/.test(f.value ?? f.basis));
    expect(cap).toHaveLength(1);
    expect(cap[0]).toMatchObject({ value: null, label: "unknown", basis: expect.stringContaining("more than one Crankcase Capacity") });
    expect(cap[0].basis).toContain("12 oz 0.35 l");
    expect(cap[0].basis).toContain("17 oz 0.5 l");
    expect(verifyPacket(p)).toEqual([]);
  });

  it("two identical sheets give each rating once", () => {
    const p = build([sheetDoc(SHEET), sheetDoc(SHEET, "ds2", "copy.txt"), doc("manual-cpstyle.txt", "sm")], "valve service");
    expect(p.restoration!.filter((f) => f.value === "Crankcase Capacity 12 oz 0.35 l" && f.label === "verified")).toHaveLength(1);
    expect(ratings(p).filter((f) => f.label === "verified")).toHaveLength(3);
  });
});

describe("a caution shown in three sections is one field (Codex #5062 F18)", () => {
  const raw = FIXTURES["manual-cpstyle.txt"].replace("3. Grasp Spring Retainer", "NOTE: Do not lubricate wicks at initial start-up.\n3. Grasp Spring Retainer");
  const packet = () => build([sheet(), { docId: "sm", fileId: null, filename: "m.pdf", pages: fixturePages(raw), via: "file" }], "valve service");
  const occurrences = (p: WorkPacket, at?: number) => {
    const i = at ?? p.safety.cautions.findIndex((c) => /lubricate wicks/.test(c.value ?? ""));
    const original = `safety.cautions[${i}]`;
    const jha = p.jha!.findIndex((r) => r.hazard.copyOf === original);
    const rest = p.restoration!.findIndex((f) => f.copyOf === original);
    return { i, paths: [original, `jha[${jha}].hazard`, `restoration[${rest}]`], fields: [p.safety.cautions[i], p.jha![jha]?.hazard, p.restoration![rest]] };
  };

  it("every occurrence links back to the safety caution", () => {
    const o = occurrences(packet());
    expect(o.i).toBeGreaterThanOrEqual(0);
    expect(o.fields.every(Boolean)).toBe(true);
    expect(o.fields.map((f) => f!.label)).toEqual(["verified", "verified", "verified"]);
  });

  for (const action of ["set", "strike", "mark_unknown"] as const) {
    for (const via of [0, 1, 2]) {
      it(`${action} through occurrence ${via} reaches all three, and survives save/reload`, () => {
        const before = packet();
        const { i, paths: start } = occurrences(before);
        const path = start[via];
        const edited = applyEdit(before, { path, action, value: action === "set" ? "Site note: wick check" : undefined }, "Tech", "2026-11-01T12:00:00Z");
        const reloaded = JSON.parse(JSON.stringify(edited)) as WorkPacket;
        const { fields, paths } = occurrences(reloaded, i);
        expect(paths).toEqual(start);
        const [orig, ...copies] = fields;
        for (const c of copies) {
          expect(c!.value).toBe(orig!.value);
          expect(c!.label).toBe(orig!.label);
          expect(!!c!.struck).toBe(!!orig!.struck);
        }
        expect(orig!.label).not.toBe(action === "strike" ? "unknown" : "verified");
        if (action === "strike") expect(orig!.struck).toBe(true);
        expect(reloaded.approval.technicianReview.entries.at(-1)!.path).toBe(paths[0]);
        expect(verifyPacket(reloaded)).toEqual([]);
      });
    }
  }

  it("the check flags a copy that no longer matches its original", () => {
    const p = packet();
    const { paths } = occurrences(p);
    const stale = structuredClone(p);
    stale.safety.cautions[occurrences(p).i] = { ...stale.safety.cautions[occurrences(p).i], value: null, label: "unknown" };
    const problems = verifyPacket(stale);
    expect(problems.some((m) => m.startsWith(`${paths[1]}: differs from its original`))).toBe(true);
    expect(problems.some((m) => m.startsWith(`${paths[2]}: differs from its original`))).toBe(true);
  });
});
