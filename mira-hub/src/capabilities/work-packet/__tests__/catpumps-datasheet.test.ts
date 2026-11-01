/**
 * Work Packet (#4982) — CAT Pumps data-sheet parser.
 *
 * Fixtures are FICTIONAL (invented model numbers `9XP1000`/`9XP2000`, invented part numbers) laid
 * out in the exact real line layouts: `datasheet-9xp1000.txt` is the 5CP-style layout (models
 * listed one-per-line in the header), `datasheet-9xp2000.txt` is the 3520-style layout (a single
 * "9XP2000/C" model token, a "†" production-parts marker, a "(Model 9XP2000C)" restriction, and
 * "*"/"u" footnote markers glued onto kit numbers). Real CAT Pumps documents are copyrighted and
 * are never committed; real-document checks run locally from the scratchpad (see this task's
 * final report, not this file).
 *
 * Mutation harness: set WORK_PACKET_DATASHEET_MODULE to the path of a deliberately-broken copy
 * of `../catpumps-datasheet` to prove each test fails on the behaviour it names
 * (`.claude/rules/prove-the-test-fails.md`).
 *
 * Run: npx vitest run src/capabilities/work-packet/__tests__/catpumps-datasheet.test.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseCatPumpsDataSheet, sheetModelFor } from "../catpumps-datasheet";
import type { DataSheet, DocText, DsKit, DsPart, PageText } from "../types";

function loadFixture(name: string): DocText {
  const raw = readFileSync(join(__dirname, "fixtures", name), "utf8");
  const pages: PageText[] = [];
  const re = /===== PAGE (\d+) =====\n/g;
  const indices: { page: number; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    indices.push({ page: Number(m[1]), start: m.index + m[0].length });
  }
  for (let i = 0; i < indices.length; i++) {
    const end = i + 1 < indices.length ? raw.indexOf("===== PAGE", indices[i].start) : raw.length;
    pages.push({ page: indices[i].page, text: raw.slice(indices[i].start, end === -1 ? raw.length : end) });
  }
  return { docId: "doc-1", fileId: "file-1", filename: name, pages, via: "file" };
}

function byPart(ds: DataSheet, part: string): DsPart {
  const p = ds.parts.find((x) => x.partNumber === part);
  if (!p) throw new Error(`fixture missing part ${part}`);
  return p;
}

function byKind(ds: DataSheet, kind: "seal" | "valve"): DsKit {
  const k = ds.kits.find((x) => x.kind === kind);
  if (!k) throw new Error(`fixture missing ${kind} kit`);
  return k;
}

describe("parseCatPumpsDataSheet — not a CAT Pumps data sheet", () => {
  it("returns null for an unrelated document", () => {
    const doc: DocText = { docId: "d", fileId: null, filename: "random.txt", via: "file", pages: [{ page: 1, text: "Hello, this is not a CAT Pumps document at all." }] };
    expect(parseCatPumpsDataSheet(doc)).toBeNull();
  });
});

describe("parseCatPumpsDataSheet — 5CP-style layout (datasheet-9xp1000.txt)", () => {
  const doc = loadFixture("datasheet-9xp1000.txt");
  const ds = parseCatPumpsDataSheet(doc);

  it("parses (is not null) and reports the sheet kind", () => {
    expect(ds).not.toBeNull();
    expect(ds!.kind).toBe("catpumps_datasheet");
  });

  it("extracts models from the multi-line comma header", () => {
    expect(ds!.models).toEqual(["9XP1000", "9XP1000CS", "9XP1000G"]);
  });

  it("parses the main parts-list rows with correct source page", () => {
    const mainParts = ds!.parts.filter((p) => p.section === "parts");
    expect(mainParts.map((p) => p.partNumber)).toEqual([
      "100001", "100002", "100003", "100004", "100005", "100006", "100007", "100008", "100009",
    ]);
    expect(mainParts.every((p) => p.source.page === 2)).toBe(true);
  });

  it("resolves a single qty across all models, and flags a 2-of-3 split as ambiguous", () => {
    const single = byPart(ds!, "100006");
    expect(single.qtyStatus).toBe("single");
    expect(single.qtyByModel).toEqual({ "9XP1000": 3, "9XP1000CS": 3, "9XP1000G": 3 });

    const ambiguous = byPart(ds!, "100001");
    expect(ambiguous.qtyStatus).toBe("ambiguous");
    expect(ambiguous.qtyByModel).toBeNull();
    expect(ds!.problems.some((p) => p.includes("100001") && p.includes("8–4"))).toBe(true);
  });

  it("resolves a per-model qty when the value count matches the model count", () => {
    const perModel = byPart(ds!, "100002");
    expect(perModel.qtyStatus).toBe("per_model");
    expect(perModel.qtyByModel).toEqual({ "9XP1000": 2, "9XP1000CS": 1, "9XP1000G": 0 });
  });

  it("a continuation row (no item cell) inherits the previous item and keeps its own appliesTo", () => {
    const first = byPart(ds!, "100003");
    expect(first.item).toBe(25);
    expect(first.appliesTo).toEqual(["9XP1000"]);
    expect(first.description).toBe("Crankshaft, Dual End");

    const cont = byPart(ds!, "100004");
    expect(cont.item).toBe(25);
    expect(cont.appliesTo).toEqual(["9XP1000CS", "9XP1000G"]);
    expect(cont.description).toBe("Crankshaft, Single End");
  });

  // F6 port (#4993): a "single" qty must be filtered down to the row's OWN appliesTo, not
  // broadcast to every model on the sheet — the two mutually-exclusive crankshaft rows above
  // must not both claim qty 1 for all three models.
  it("F6: filters a single qty by appliesTo for a model-restricted continuation row", () => {
    expect(byPart(ds!, "100003").qtyByModel).toEqual({ "9XP1000": 1 });
    expect(byPart(ds!, "100004").qtyByModel).toEqual({ "9XP1000CS": 1, "9XP1000G": 1 });
  });

  it("blank material renders as null, and the production-differs '=' marker does not corrupt the row", () => {
    const retainer = byPart(ds!, "100005");
    expect(retainer.item).toBe(99);
    expect(retainer.material).toBe("SS");
    expect(retainer.description).toBe("Retainer, Plunger (See Tech Bulletin 001)");
    const gearbox = byPart(ds!, "100009");
    expect(gearbox.material).toBeNull();
  });

  it("parses optional and service sections, including a wrapped multi-line row", () => {
    const optional = ds!.parts.filter((p) => p.section === "optional");
    expect(optional.map((p) => p.partNumber)).toEqual(["200001", "200002"]);

    const service = ds!.parts.filter((p) => p.section === "service");
    expect(service.map((p) => p.partNumber)).toEqual(["300001", "300002"]);
    const oil = service.find((p) => p.partNumber === "300002")!;
    expect(oil.description).toContain("Oil, Bottle (21 oz) ISO 68 Hydraulic");
    expect(oil.description).toContain("Prior to Start-up");
    expect(oil.qtyByModel).toEqual({ "9XP1000": 1, "9XP1000CS": 1, "9XP1000G": 1 });
    expect(oil.source.page).toBe(3);
  });

  it("parses seal and valve kits: perPump, accumulated models across header lines, and kit numbers", () => {
    const seal = byKind(ds!, "seal");
    expect(seal.perPump).toBe(1);
    expect(seal.materials).toEqual(["NBR (STD)", "FPM (.0110)", "EPDM (.0220)"]);
    expect(seal.kitNumbers).toHaveLength(1);
    expect(seal.kitNumbers[0].models).toEqual(["9XP1000", "9XP1000CS"]);
    expect(seal.kitNumbers[0].byMaterial).toEqual({ "NBR (STD)": "300001", "FPM (.0110)": "300011", "EPDM (.0220)": "300021" });

    const valve = byKind(ds!, "valve");
    expect(valve.perPump).toBe(2);
    expect(valve.kitNumbers[0].models).toEqual(["9XP1000"]);
    expect(valve.kitNumbers[0].byMaterial["NBR (STD)"]).toBe("400001");
  });

  it("parses kit items: an item with all-material parts, and one with a blank leading material (no item-number shift)", () => {
    const seal = byKind(ds!, "seal");
    const [first, second] = seal.items;
    expect(first.item).toBe(106);
    expect(first.partsByMaterial["NBR (STD)"]).toBe("100006");
    expect(first.partsByMaterial["FPM (.0110)"]).toBeNull();

    expect(second.item).toBeNull();
    expect(second.partsByMaterial).toEqual({ "NBR (STD)": null, "FPM (.0110)": "100016", "EPDM (.0220)": "100026" });
    expect(second.qtyRaw).toBe("3");

    const valve = byKind(ds!, "valve");
    expect(valve.items.map((i) => i.item)).toEqual([162, 164]);
  });

  it("parses the spec block (flow, pressure, rpm, bore, stroke, weight, crankcase capacity) with sources", () => {
    const byKey = Object.fromEntries(ds!.specs.map((s) => [s.key, s]));
    expect(byKey.flow.value).toBe("7.4 gpm 28 lpm");
    expect(byKey.pressure.value).toBe("100–1500 psi 6.9–103 bar");
    expect(byKey.rpm.value).toBe("1725 rpm 1725 rpm");
    expect(byKey.bore.value).toBe('0.787" 20 mm');
    expect(byKey.stroke.value).toBe('0.709" 18 mm');
    expect(byKey.weight.value).toBe("19.9 lbs 9 kg");
    expect(byKey.crankcase_capacity.value).toBe("12 oz 0.35 l");
    expect(byKey.crankcase_capacity.source.page).toBe(1);
  });
});

describe("parseCatPumpsDataSheet — 3520-style layout (datasheet-9xp2000.txt)", () => {
  const doc = loadFixture("datasheet-9xp2000.txt");
  const ds = parseCatPumpsDataSheet(doc);

  it("expands the compact slash model token into two distinct models", () => {
    expect(ds!.models).toEqual(["9XP2000", "9XP2000C"]);
  });

  it("consumes the '†' production-differs marker without corrupting part/material/desc", () => {
    const row = byPart(ds!, "200003");
    expect(row.item).toBe(65);
    expect(row.material).toBe("SSZZ");
    expect(row.description).toBe("Rod, Plunger");
  });

  it("a continuation row with a lettered part number applies only to the named model via '(Model X)'", () => {
    const main = byPart(ds!, "200004");
    expect(main.item).toBe(110);
    expect(main.appliesTo).toEqual(["9XP2000", "9XP2000C"]);

    const flushed = byPart(ds!, "200004C");
    expect(flushed.item).toBe(110);
    expect(flushed.appliesTo).toEqual(["9XP2000C"]);
    expect(flushed.qtyByModel).toEqual({ "9XP2000C": 1 });
  });

  it("models [9XP2000, 9XP2000C]; every row's part number is verbatim on its source line", () => {
    expect(ds!.models).toEqual(["9XP2000", "9XP2000C"]);
    const mainParts = ds!.parts.filter((p) => p.section === "parts");
    expect(mainParts.length).toBeGreaterThan(0);
    for (const p of mainParts) {
      expect(p.source.line.includes(p.partNumber)).toBe(true);
    }
  });

  it("strips a '*'/'u' footnote marker glued onto a kit number and ignores a bare marker token", () => {
    const seal = byKind(ds!, "seal");
    expect(seal.perPump).toBe(1);
    expect(seal.kitNumbers).toHaveLength(1);
    expect(seal.kitNumbers[0].models).toEqual(["9XP2000", "9XP2000C"]);
    expect(seal.kitNumbers[0].byMaterial).toEqual({ "NBR (STD)": "220001", "FPM (.0110)": "220011", "EPDM (.0220)": "220021" });
  });

  it("a footnote line starting with 'u ' is recognized and never mistaken for a data row", () => {
    const seal = byKind(ds!, "seal");
    expect(seal.items).toHaveLength(1);
    expect(seal.items[0].item).toBe(97);
  });

  it("valve kit NBR (STD) is 220002, required twice per pump", () => {
    const valve = byKind(ds!, "valve");
    expect(valve.perPump).toBe(2);
    expect(valve.kitNumbers[0].byMaterial["NBR (STD)"]).toBe("220002");
  });

  it("crankcase capacity spec is present with its source line", () => {
    const spec = ds!.specs.find((s) => s.key === "crankcase_capacity")!;
    expect(spec.value).toBe("4.2 qts 4 l");
    expect(spec.source.line).toContain("Crankcase Capacity");
  });
});

describe("sheetModelFor — exact match only, never a prefix match", () => {
  const models = ["3520", "3520C", "5CP6120", "5CP6120CS", "5CP6120CSSG1"];

  it("matches model exactly", () => {
    expect(sheetModelFor({ model: "3520", catalogNumber: null }, models)).toBe("3520");
  });

  it("does not prefix-match 3520 against 3520C or 3521", () => {
    expect(sheetModelFor({ model: "3521", catalogNumber: null }, models)).toBeNull();
    expect(sheetModelFor({ model: "352", catalogNumber: null }, models)).toBeNull();
  });

  it("normalizes case/spaces/dashes before comparing", () => {
    expect(sheetModelFor({ model: "5cp-6120 cs", catalogNumber: null }, models)).toBe("5CP6120CS");
  });

  it("falls back to catalogNumber when model does not match", () => {
    expect(sheetModelFor({ model: "unrelated", catalogNumber: "5CP6120CSSG1" }, models)).toBe("5CP6120CSSG1");
  });

  it("matches a longer suffix model only when explicitly listed", () => {
    expect(sheetModelFor({ model: "5CP6120CSSG1", catalogNumber: null }, models)).toBe("5CP6120CSSG1");
    expect(sheetModelFor({ model: "5CP6120CSSG2", catalogNumber: null }, models)).toBeNull();
  });

  it("returns null when neither identifier matches any sheet model", () => {
    expect(sheetModelFor({ model: null, catalogNumber: null }, models)).toBeNull();
  });
});
