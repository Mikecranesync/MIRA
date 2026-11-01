/**
 * catpumps-service-manual.test.ts — parseCatPumpsServiceManual.
 *
 * Fixtures (`fixtures/index.ts`, keys `manual-*.txt`) are fictional CAT Pumps service-manual excerpts (invented
 * model numbers 9XP1000/9XP1010/9XP1020 and 8520/8521/8527/8560) kept in the EXACT real line
 * layouts observed in the two real documents this was built against (`CPSvc5.unpdf.txt`,
 * `35FR2Svc.unpdf.txt`, read locally from the scratchpad — never committed, never quoted here).
 * The real documents are exercised separately, locally, and reported in prose in the task
 * write-up rather than as a committed test (they are copyrighted CAT Pumps PDFs).
 *
 * Fixtures use the "===== PAGE n =====" marker from the local unpdf dump tool; `docTextFromDump`
 * below is TEST-ONLY glue that turns that into the `DocText.pages` shape the real pipeline hands
 * the parser (per `document-text.ts`, pages arrive pre-split — the marker is a scratch-dump
 * artifact, not a production format).
 */
import { FIXTURES } from "./fixtures";
import { describe, expect, it } from "vitest";
import { parseCatPumpsServiceManual } from "../catpumps-service-manual";
import type { DocText } from "../types";


function docTextFromDump(fixtureName: string, docId = "doc1"): DocText {
  const raw = FIXTURES[fixtureName];
  const parts = raw.split(/\n?===== PAGE (\d+) =====\n/).slice(1);
  const pages: DocText["pages"] = [];
  for (let i = 0; i < parts.length; i += 2) {
    pages.push({ page: Number(parts[i]), text: parts[i + 1] });
  }
  return { docId, fileId: null, filename: fixtureName, pages, via: "file" };
}

describe("parseCatPumpsServiceManual — recognition", () => {
  it("returns null for a document that is not a CAT Pumps service manual", () => {
    const doc = docTextFromDump("manual-not-a-service-manual.txt");
    expect(parseCatPumpsServiceManual(doc)).toBeNull();
  });

  it("returns null when there are no pages", () => {
    expect(parseCatPumpsServiceManual({ docId: "d", fileId: null, filename: null, pages: [], via: "file" })).toBeNull();
  });
});

describe("parseCatPumpsServiceManual — CPSvc5-style layout (manual-cpstyle.txt)", () => {
  const doc = docTextFromDump("manual-cpstyle.txt");
  const sm = parseCatPumpsServiceManual(doc);

  it("recognizes the manual and extracts the full model roster from the cover's '<FAMILY> MODELS:' lines", () => {
    expect(sm).not.toBeNull();
    expect(sm!.kind).toBe("catpumps_service_manual");
    expect(sm!.modelsCovered).toEqual(["9XP1000", "9XP1010", "9XP1020"]);
  });

  it("parses SERVICING THE VALVES into one section, topic 'valves', with steps joined verbatim and figure captions excluded", () => {
    const section = sm!.sections.find((s) => s.heading === "SERVICING THE VALVES");
    expect(section).toBeDefined();
    expect(section!.topic).toBe("valves");
    expect(section!.page).toBe(2);
    expect(section!.steps.map((s) => s.n)).toEqual([1, 2, 3]);
    // Step 2's wrapped continuation line joins in; the NOTE and the "All Models / Removal of
    // Valve Plugs" caption pair that follow step 3 must NOT leak into step 3's text.
    expect(section!.steps[1].text).toBe(
      "Examine the O-Ring under the plug for cuts or distortion. Replace if worn. Lubricate new O-Rings before installing.",
    );
    expect(section!.steps[2].text).toBe("Grasp Spring Retainer by the tab at the top with a pliers and remove from each valve chamber.");
    expect(section!.steps[2].text).not.toMatch(/All Models|Removal of Valve Plugs/);
    // source.line is the step's FIRST physical line only, not the joined text.
    expect(section!.steps[0].source).toEqual({
      docId: "doc1",
      fileId: null,
      filename: "manual-cpstyle.txt",
      page: 2,
      line: "1. Remove the hex Valve Plugs (top discharge, bottom inlet).",
    });
  });

  it("captures the CAUTION paragraph verbatim with its page, and does not fold it into a step", () => {
    const caution = sm!.cautions.find((c) => c.kind === "CAUTION");
    expect(caution).toBeDefined();
    expect(caution!.text).toBe(
      "Before commencing with service, shut off drive (electric motor, gas or diesel engine) and turn off water supply to pump. Relieve all discharge line pressure by triggering gun or opening valve in discharge line.",
    );
    expect(caution!.source.page).toBe(2);
    const valves = sm!.sections.find((s) => s.heading === "SERVICING THE VALVES");
    expect(valves!.steps.every((s) => !s.text.includes("CAUTION"))).toBe(true);
  });

  it("keeps the NOTE as a caution tied to its own line, separate from the WARNING/CAUTION kinds", () => {
    const note = sm!.cautions.find((c) => c.kind === "NOTE");
    expect(note).toBeDefined();
    expect(note!.text).toBe("The 9XP1010 and 9XP1020 have both an O-Ring and Back-up Ring on the Valve Plug.");
  });

  it("splits Disassembly into its own section and further splits CPSvc5-style nested '<Label> Models:' sub-blocks, each restarting step numbers at 1 (the bare 'Reassembly' subheading itself carries no steps of its own — everything lives in the nested blocks — so it is correctly dropped rather than emitted empty)", () => {
    const seals = sm!.sections.filter((s) => s.heading === "SERVICING THE SEALS");
    expect(seals.map((s) => s.subheading)).toEqual(["Disassembly", "Hi-Pressure Seal Models:", "V-Packing Models:"]);
    expect(seals.every((s) => s.topic === "seals")).toBe(true);
    const hiPressure = seals.find((s) => s.subheading === "Hi-Pressure Seal Models:")!;
    expect(hiPressure.steps.map((s) => s.n)).toEqual([1, 2]);
    const vPacking = seals.find((s) => s.subheading === "V-Packing Models:")!;
    expect(vPacking.steps.map((s) => s.n)).toEqual([1, 2]);
  });

  it("records a problems entry for the nested '<Label> Models:' sub-blocks instead of guessing a pump-model restriction, and defaults their scope to 'all'", () => {
    const hiPressure = sm!.sections.find((s) => s.subheading === "Hi-Pressure Seal Models:")!;
    expect(hiPressure.models).toEqual({ include: [], exclude: [] });
    expect(sm!.problems.some((p) => p.includes("Hi-Pressure Seal Models:") && p.includes("left as \"all\""))).toBe(true);
  });

  it("parses the inline-bracket torque chart: a bare group header ('Valve Plugs') plus per-model rows, part number extracted out of the tool column's bracket", () => {
    const plungerRetainer = sm!.torque.find((t) => t.item === "Plunger Retainer")!;
    expect(plungerRetainer).toMatchObject({ thread: "M6", tool: "M10 Hex", partNumber: "25082", inLbs: "55", ftLbs: "4.6", nm: "6.2" });
    expect(plungerRetainer.models).toEqual({ include: [], exclude: [] });
    expect(plungerRetainer.consistent).toBe(true);

    const valveRows = sm!.torque.filter((t) => t.item === "Valve Plugs");
    expect(valveRows).toHaveLength(2);
    expect(valveRows[0].models).toEqual({ include: ["9XP1000", "9XP1010"], exclude: [] });
    expect(valveRows[0].partNumber).toBe("44046");
    expect(valveRows[1].models).toEqual({ include: ["9XP1020"], exclude: [] });
    expect(valveRows[1].partNumber).toBe("44045");
  });

  it("flags a torque row inconsistent (per the ±2% in-lbs/ft-lbs/Nm check) when the document's own numbers don't reconcile, so it is never usable as a measurement", () => {
    const bearing9XP1000 = sm!.torque.find((t) => t.item === "Bearing Cover Screws" && t.models.include.includes("9XP1000"))!;
    expect(bearing9XP1000).toMatchObject({ inLbs: "50", ftLbs: "4.0", nm: "5.4" });
    expect(bearing9XP1000.consistent).toBe(false); // 4.0 * 12 = 48, not 50 (4% off > 2% tolerance)
    const bearingOthers = sm!.torque.find((t) => t.item === "Bearing Cover Screws" && t.models.include.includes("9XP1010"))!;
    expect(bearingOthers.consistent).toBe(true);
  });

  it("stops the torque chart at the next body-end heading — a numeric-shaped row placed after INLET CONDITION CHECK-LIST is never parsed as a torque row", () => {
    expect(sm!.torque.some((t) => t.item === "Fake Guard Item")).toBe(false);
  });
});

describe("parseCatPumpsServiceManual — 35FR2Svc-style layout (manual-35style.txt)", () => {
  const doc = docTextFromDump("manual-35style.txt");
  const sm = parseCatPumpsServiceManual(doc);

  it("extracts modelsCovered from the '<N> FRAME SPLIT MANIFOLD:' cover line plus its wrapped continuation lines", () => {
    expect(sm!.modelsCovered).toEqual(["8520", "8521", "8527", "8560"]);
  });

  it("parses parenthetical 'Disassembly (All models except N)' / 'Disassembly (Model N)' into separate sections with the right ModelScope", () => {
    const valves = sm!.sections.filter((s) => s.heading === "SERVICING THE VALVES");
    expect(valves.map((s) => s.subheading)).toEqual(["Disassembly (All models except 8560)", "Disassembly (Model 8560)", "Reassembly (All models except 8560)"]);
    expect(valves[0].models).toEqual({ include: [], exclude: ["8560"] });
    expect(valves[1].models).toEqual({ include: ["8560"], exclude: [] });
    expect(valves[2].models).toEqual({ include: [], exclude: ["8560"] });
    expect(valves.every((s) => s.topic === "valves")).toBe(true);
    // Each subheading's steps restart at 1 — the "Disassembly (Model 8560)" steps must not be
    // numbered 3/4 as if they continued the first Disassembly block.
    expect(valves[1].steps.map((s) => s.n)).toEqual([1, 2]);
  });

  it("joins a step's wrapped continuation line verbatim and excludes the trailing figure-caption pair", () => {
    const disB = sm!.sections.find((s) => s.subheading === "Disassembly (Model 8560)")!;
    expect(disB.steps[0].text).toBe(
      "Using an M12 Allen wrench remove the (4) four hex socket head screws (HSH) from each valve plug.",
    );
    const reassembly = sm!.sections.find((s) => s.subheading === "Reassembly (All models except 8560)")!;
    expect(reassembly.steps[1].text).not.toMatch(/All models except 8560|Removal of Discharge Valve Plug/);
  });

  it("parses a 'Model N Only' torque-chart override as its own row, scoped to that model, inheriting the item name of the row above it", () => {
    const generic = sm!.torque.find((t) => t.item === "Plunger Retainer" && t.models.include.length === 0)!;
    expect(generic).toMatchObject({ thread: "M10", tool: "M21 Hex", inLbs: "220", ftLbs: "18.0", nm: "24", partNumber: null });
    const override = sm!.torque.find((t) => t.item === "Plunger Retainer" && t.models.include.includes("8560"))!;
    expect(override).toMatchObject({ thread: "M7", tool: "M14 Hex", inLbs: "90", ftLbs: "7.5", nm: "10", partNumber: "25053" });
  });

  it("merges a wrapped item name onto the following line's bracketed part number into ONE row ('Rear Cover/' + 'Bearing Cover Screws [25324]')", () => {
    const row = sm!.torque.find((t) => t.item.includes("Rear Cover") && t.item.includes("Bearing Cover Screws"))!;
    expect(row.item).toBe("Rear Cover/ Bearing Cover Screws");
    expect(row).toMatchObject({ thread: "M8", tool: "M13 Hex", partNumber: "25324", inLbs: "115", ftLbs: "9.58", nm: "13" });
    expect(row.consistent).toBe(true);
    // Exactly one row for this item — the continuation line must not ALSO become its own row.
    expect(sm!.torque.filter((t) => t.item.includes("Bearing Cover Screws"))).toHaveLength(1);
  });

  it("flags the Bubble Oil Gauge row inconsistent (3.6 ft-lb * 12 = 43.2, not 45 — 4% off) so it can never be used as a measurement", () => {
    const gauge = sm!.torque.find((t) => t.item === "Bubble Oil Gauge")!;
    expect(gauge.consistent).toBe(false);
  });

  it("does not read the TECHNICAL BULLETIN REFERENCE CHART that follows the torque chart as torque rows — a numeric-shaped row placed after it is never parsed", () => {
    expect(sm!.torque.some((t) => t.item === "Fake Guard Item")).toBe(false);
  });
});

describe("parseCatPumpsServiceManual — real cover rosters with long model names", () => {
  // CPSvc5's real cover block: suffixed names (5CP2140WCS = 10 chars, 5CP6120G1 = 9 chars) on a line
  // that ends with a comma and wraps. Before the fix the whole 5CP line was rejected, so a 5CP6120
  // notebook silently lost every step, torque row and caution of its own service manual.
  const cover = [
    "CP PLUNGER PUMP SERVICE MANUAL",
    "3CP MODELS: 3CP1120, 3CP1130, 3CP1140",
    "5CP MODELS: 5CP2120W, 5CP2140WCS, 5CP2150W, 5CP3120, 5CP3120G1, 5CP3130G1,",
    "5CP5120, 5CP5150G1, 5CP6120, 5CP6120G1, 5CP6140, 5CP6150",
    "7CP MODELS: 7CP6170",
    "SPECIFICATIONS: Maximum specifications refer to individual attributes. It is not",
    "implied that all maximums can be performed simultaneously. If more than one",
    "maximum is considered, check with your CAT PUMPS supplier to confirm the",
  ].join("\n");
  const sm = parseCatPumpsServiceManual({
    docId: "cpsvc", fileId: null, filename: "CPSvc5.pdf", via: "chunks",
    pages: [{ page: 1, text: cover }, { page: 2, text: "SERVICING THE VALVES\n1. Remove the hex Valve Plugs." }],
  });

  it("keeps every model on the wrapped 5CP lines, including 9- and 10-character names", () => {
    expect(sm).not.toBeNull();
    expect(sm!.modelsCovered).toEqual([
      "3CP1120", "3CP1130", "3CP1140",
      "5CP2120W", "5CP2140WCS", "5CP2150W", "5CP3120", "5CP3120G1", "5CP3130G1",
      "5CP5120", "5CP5150G1", "5CP6120", "5CP6120G1", "5CP6140", "5CP6150",
      "7CP6170",
    ]);
  });
});

describe("parseCatPumpsServiceManual — wrapped lines keep their numbers checkable; page furniture is not joined", () => {
  // Fictional 9XP manual in the real layout: a number that wraps onto a continuation line, a new
  // sentence that wraps after a finished one, and the extractor's interleaved furniture (figure
  // titles, a tightening-sequence diagram, a trademark footnote) right after finished sentences.
  const cover = ["9XP PLUNGER PUMP SERVICE MANUAL", "9XP MODELS: 9XP1000, 9XP1010", "CAT PUMPS (fictional fixture)"].join("\n");
  const body = [
    "SERVICING THE VALVES",
    "1. Remove the Coil Spring. Thread an",
    "M10 bolt into the Spring Retainer.",
    "2. Check oil level and for water in oil.",
    "Change crankcase oil on a regular schedule. See",
    "Preventative Maintenance Check-List.",
    "3. Torque per chart and in this sequence.",
    "1 3 5 7 8 6 4 2",
    "4. Contact your distributor if service is required.",
    "Loctite and 242 are registered trademarks of the Henkel Corporation.",
    "IMPORTANT: Apply anti-seize lubricant",
    "(PN9119) to all stainless threads.",
    "NOTE: Two screwdrivers may be used to assist separation.",
    "Removal of Inlet Manifold O-Rings 9XP1000, 9XP1010",
    "Removal of V-Packing Spacer",
  ].join("\n");
  const sm = parseCatPumpsServiceManual({
    docId: "m9", fileId: null, filename: "9XPSvc.pdf", via: "chunks",
    pages: [{ page: 1, text: cover }, { page: 2, text: body }],
  })!;
  const steps = sm.sections.flatMap((s) => s.steps);
  const step = (n: number) => steps.find((s) => s.n === n)!;

  it("cites every physical line a wrapped step was joined from, so a number on the continuation line is on its source", () => {
    expect(step(1).text).toBe("Remove the Coil Spring. Thread an M10 bolt into the Spring Retainer.");
    expect(step(1).source.line).toBe("1. Remove the Coil Spring. Thread an M10 bolt into the Spring Retainer.");
    expect(step(1).source.line).toContain("M10");
    expect(step(1).source.page).toBe(2);
  });

  it("still joins a new sentence that wraps after a finished one (lowercase words — not a figure title)", () => {
    expect(step(2).text).toBe(
      "Check oil level and for water in oil. Change crankcase oil on a regular schedule. See Preventative Maintenance Check-List.",
    );
  });

  it("does not join a tightening-sequence diagram line onto the step", () => {
    expect(step(3).text).toBe("Torque per chart and in this sequence.");
    expect(step(3).source.line).not.toContain("8 6 4 2");
  });

  it("does not join a trademark footnote onto the step", () => {
    expect(step(4).text).toBe("Contact your distributor if service is required.");
  });

  it("cites every physical line a wrapped caution was joined from, so its part number is on its source", () => {
    const imp = sm.cautions.find((c) => c.kind === "IMPORTANT")!;
    expect(imp.text).toBe("Apply anti-seize lubricant (PN9119) to all stainless threads.");
    expect(imp.source.line).toBe("IMPORTANT: Apply anti-seize lubricant (PN9119) to all stainless threads.");
  });

  it("does not join Title Case figure titles onto a finished caution sentence", () => {
    const note = sm.cautions.find((c) => c.kind === "NOTE")!;
    expect(note.text).toBe("Two screwdrivers may be used to assist separation.");
    expect(note.source.line).toBe("NOTE: Two screwdrivers may be used to assist separation.");
  });
});
