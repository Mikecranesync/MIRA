import { describe, expect, it } from "vitest";
import { modelSectionModels, mergeOutputTypes, readOutputTypes, SectionTableScope, scopeTableChunks, sectionTableLayout, withoutSharedTableHeader } from "../section-table-scope";
import { pageWithTables, tableChunks, detectModelTables, type LayoutItem, type TableChunk } from "../table-rows";
import ml1100Ratings from "../__fixtures__/table-rows/ml1100-p114-p120-ratings-scope.json";
import micro820 from "../__fixtures__/table-rows/micro820-in009-p16-20-scope.json";
import { columnLines, contactRatingTable } from "../contact-ratings-table";
import { boundaryMatrix, boundaryMatrixPages, measuredMatrix, measuredMatrixPage } from "../__fixtures__/section-boundary-matrix";

const AWB = "2080LC2020AWB";
const QBB = "2080LC2020QBB";
const QWB = "2080LC2020QWB";
function column(model: string, value: string | null): TableChunk {
  return { text: `General Specifications — ${model}\n${value === null ? `${model}: Power input 24V DC` : `${model}: Output circuit type ${value}`}\n`, models: [model], unqualified: false };
}
const complete = () => [column(AWB, "Relay"), column(QBB, "24V DC source (standard and high-speed)"), column(QWB, "Relay")];
const row = (str: string, y: number, size = 10, x = 100): LayoutItem => ({ str, y, size, x, w: str.length * size * 0.4 });
function caption(title: string, body = "Voltage, max 250 V, AC") {
  const items = [row(title, 700), row("Attribute Value", 680, 8), row(body, 660, 8)];
  const layout = sectionTableLayout(items)!;
  return { text: layout.text, layout };
}
const splitCaption = (scope: SectionTableScope, title: string, body?: string) => {
  const source = caption(title, body);
  return scope.split(source.text, source.layout);
};
function expectUnresolvedRelay(outputs: ReturnType<typeof readOutputTypes>) {
  const parts = splitCaption(new SectionTableScope(outputs), "Relay Contact Ratings");
  expect(parts.some((part) => part.scope === "section")).toBe(false);
  expect(parts.find((part) => part.text.includes("Voltage, max"))).toEqual(expect.objectContaining({ scope: "unresolved" }));
}
function splitMixedHeader(scope: SectionTableScope, title: string) {
  const items = [row(title, 700), row("Attribute", 680, 8, 100), row("Non-isolated inputs", 680, 8, 200), row("Isolated inputs", 680, 8, 340),
    row("2080-LC20-20QWB(R),", 668, 8, 340), row("2080-LC20-20QBB(R) only", 656, 8, 340),
    row("Voltage category", 630, 8, 100), row("24V DC Sink", 630, 8, 200), row("24V DC Sink/Source", 630, 8, 340)];
  const layout = sectionTableLayout(items)!;
  return scope.split(layout.text, layout);
}

describe("#5503 complete per-model output circuit evidence", () => {
  it("reads the actual relay / 24V DC source distinction by model", () => {
    expect([...readOutputTypes(complete())]).toEqual([[AWB, true], [QBB, false], [QWB, true]]);
  });
  it.each(["Relay/FET", "Relay / FET", "Relay (standard outputs); FET (high speed)"])("a mixed relay-capable type %s retains relay applicability", (value) => {
    const chunks = complete(); chunks[0] = column(AWB, value);
    expect(readOutputTypes(chunks).get(AWB)).toBe(true);
  });
  it.each(["24V DC source", "Transistor", "FET", "Solid-state sink"])("recognizes an explicit non-relay output type %s", (value) => {
    const chunks = complete(); chunks[1] = column(QBB, value);
    expect(readOutputTypes(chunks).get(QBB)).toBe(false);
  });
  it("a missing circuit-type row in one model column invalidates inference for the whole table", () => {
    const chunks = complete(); chunks[1] = column(QBB, null);
    const outputs = readOutputTypes(chunks);
    expect(outputs.get(QBB)).toBeNull();
    expectUnresolvedRelay(outputs);
  });
  it.each(["Unknown", "See note 3", "DC input only; output type unspecified", "FET compatibility is not specified", "Relay compatibility is not specified", "Relay not fitted"])("does not convert uncertain type %s into authoritative non-relay evidence", (value) => {
    const chunks = complete(); chunks[1] = column(QBB, value);
    const outputs = readOutputTypes(chunks);
    expect(outputs.get(QBB)).toBeNull();
    expectUnresolvedRelay(outputs);
  });
  it("no model has an output-type row, so an unrelated table establishes no output inventory", () => {
    expect(readOutputTypes([column(AWB, null), column(QBB, null), column(QWB, null)]).size).toBe(0);
  });
  it("a table with only one model cannot establish sibling applicability", () => {
    expect(readOutputTypes([column(AWB, "Relay")]).size).toBe(0);
  });
  it("multi-model and unqualified chunks do not identify a value for each model", () => {
    const chunks = complete();
    chunks[1] = { ...chunks[1], models: [QBB, QWB] };
    expect(readOutputTypes(chunks).get(QBB)).toBeNull();
    expectUnresolvedRelay(readOutputTypes(chunks));
    const unreadable = readOutputTypes(complete().map((c) => ({ ...c, unqualified: true })));
    expect([...unreadable.values()]).toEqual([null, null, null]);
    expectUnresolvedRelay(unreadable);
  });
  it("an unreadable model column cannot silently disappear behind two readable columns", () => {
    const chunks = [column(AWB, "Relay"), column(QBB, "FET"), {
      text: "Output circuit type cannot be assigned", models: [AWB, QBB, QWB], unqualified: true,
    }];
    const outputs = readOutputTypes(chunks);
    expect(outputs.get(QWB)).toBeNull();
    expectUnresolvedRelay(outputs);
  });
  it("conflicting duplicate columns cannot use the last value as authoritative", () => {
    const outputs = readOutputTypes([...complete(), column(QBB, "Relay")]);
    expect(outputs.get(QBB)).toBeNull();
    expectUnresolvedRelay(outputs);
  });
  it("same-model continuation chunks without a circuit-type row preserve already-read output types", () => {
    const chunks = complete();
    const continued = chunks.flatMap((chunk) => [chunk, column(chunk.models[0], null), column(chunk.models[0], null)]);
    expect([...readOutputTypes(continued)]).toEqual([[AWB, true], [QBB, false], [QWB, true]]);
  });
  it("all-relay and Relay/FET inventories remain relay-capable through continuation chunks", () => {
    const models = ["1763L16AWA", "1763L16BWA", "1763L16BBB", "1763L16DWD"];
    const chunks = models.flatMap((model, i) => [column(model, i % 2 === 0 ? "Relay" : "Relay/FET"), column(model, null), column(model, null)]);
    expect([...readOutputTypes(chunks)]).toEqual(models.map((model) => [model, true]));
  });
  it("a model unread in every continuation chunk remains unknown without masking other model readings", () => {
    const chunks = [column(AWB, "Relay"), column(QWB, "Relay/FET"), column(QBB, null), column(QBB, null), column(QBB, null)];
    const outputs = readOutputTypes(chunks);
    expect(outputs.get(AWB)).toBe(true);
    expect(outputs.get(QWB)).toBe(true);
    expect(outputs.get(QBB)).toBeNull();
    expectUnresolvedRelay(outputs);
  });
  it.each([["Relay", "24V DC source"], ["24V DC source", "Relay"]])("two circuit-type rows in one model chunk retain contradiction in order %s then %s", (first, second) => {
    const chunks = complete();
    chunks[1] = { ...chunks[1], text: `General Specifications — ${QBB}\n${QBB}: Output circuit type ${first}\n${QBB}: Output circuit type ${second}\n` };
    const outputs = readOutputTypes(chunks);
    expect(outputs.get(QBB)).toBeNull();
    expectUnresolvedRelay(outputs);
  });
  it("output maps from separate families are not one sibling table", () => {
    expect(readOutputTypes([column(AWB, "Relay"), column("1763L16BBB", "FET")]).size).toBe(0);
  });
  it("conflicting readings remain unknown even after a later repeated reading", () => {
    const target = readOutputTypes(complete());
    const conflict = readOutputTypes([column(AWB, "Relay"), column(QBB, "Relay"), column(QWB, "Relay")]);
    mergeOutputTypes(target, conflict);
    expect(target.get(QBB)).toBeNull();
    mergeOutputTypes(target, readOutputTypes(complete()));
    expect(target.get(QBB)).toBeNull();
    const section = splitCaption(new SectionTableScope(target), "Relay Contact Ratings");
    expect(section.some((s) => s.scope === "section")).toBe(false);
  });
});

describe("#5503 shared-header family prerequisites and common-category proof", () => {
  function realDcLayout() {
    const page = micro820.pages.find((page) => page.page === 18)!;
    // Actual DC-input caption/header/body only, ending before the next relay caption.
    return sectionTableLayout(page.items.filter((item) => item.y > 360 && item.y < 640))!;
  }
  it.each([
    { name: "empty observed inventory", outputs: new Map<string, boolean | null>() },
    { name: "mixed-family inventory", outputs: new Map<string, boolean | null>([[QWB, true], ["1763L16BWA", true]]) },
    { name: "only foreign-family inventory", outputs: new Map<string, boolean | null>([["1763L16BWA", true], ["1763L16BBB", true]]) },
  ])("real shared-header evidence with $name remains unresolved through headerless continuation", ({ outputs }) => {
    const layout = realDcLayout();
    expect(layout.headings.find((heading) => heading.text === "DC Input Specifications")?.sharedHeader).toBeDefined();
    const scope = new SectionTableScope(outputs, true);
    const parts = scope.split(layout.text, layout);
    const input = parts.find((part) => part.text.includes("Voltage category"))!;
    expect(input.scope).toBe("unresolved");
    expect(scope.split("Unheaded DC-input evidence continues on the next page.", null)[0].scope).toBe("unresolved");
  });
  it.each(["AC", "DC", "Relay", "Transistor"])("bare category %s without an input/output/channel noun cannot establish a common group", (label) => {
    const items = [row("DC Input Specifications", 700), row("Attribute", 680, 8, 100), row(label, 680, 8, 250), row("Isolated inputs", 680, 8, 430),
      row("2080-LC20-20QWB(R)", 668, 8, 430), row("Voltage category", 640, 8, 100), row("24V DC", 640, 8, 250), row("48V DC", 640, 8, 430)];
    const layout = sectionTableLayout(items)!;
    const scope = new SectionTableScope(readOutputTypes(complete()));
    const parts = scope.split(layout.text, layout);
    const input = parts.find((part) => part.text.includes("Voltage category"))!;
    expect(input.scope).toBe("unresolved");
    expect(input.sharedHeader).toBeUndefined();
    expect(scope.split("Unheaded current values continue.", null)[0].scope).toBe("unresolved");
  });
  it("the real noun-bearing non-isolated and isolated input header retains its shared proof", () => {
    const layout = realDcLayout();
    const parts = new SectionTableScope(readOutputTypes(complete())).split(layout.text, layout);
    const input = parts.find((part) => part.text.includes("Voltage category"))!;
    expect(input.scope).toBe("shared");
    expect(input.sharedHeader).toContain("Non-isolated");
    expect(input.sharedHeader).toContain("2080-LC20-20QWB(R)");
    expect(input.models).toBeUndefined();
  });
});

describe("#5503 shared-header text occurrence", () => {
  it("strips the actual whole-line mixed header while preserving an earlier inline reference", () => {
    const page = micro820.pages.find((page) => page.page === 18)!;
    const layout = sectionTableLayout(page.items)!;
    const header = layout.headings.find((heading) => heading.text === "DC Input Specifications")!.sharedHeader!;
    expect(header).toBeDefined();
    const inline = `The earlier note quotes ${header.replace(/\n/g, " ")} for comparison.`;
    const text = `${inline}\n${header}\nBody restricted to 2080-LC20-20QWB(R) only.`;
    const stripped = withoutSharedTableHeader(text, header);
    expect(stripped).toContain(inline);
    expect(stripped).not.toContain(`\n${header}\n`);
    expect(stripped).toContain("Body restricted to 2080-LC20-20QWB(R) only.");
  });
});

describe("#5503 derived contact-column source ownership", () => {
  it("contact annotations attach to the original last rating-row item", () => {
    const items = micro820.pages.find((page) => page.page === 19)!.items;
    const table = contactRatingTable(items)!;
    expect(table).not.toBeNull();
    expect(items).toContain(table.lastRow);
    expect(table.lastRow.str).toBe("125 V DC");
    const annotation = { after: table.lastRow, lines: columnLines(table.rows) };
    const layout = sectionTableLayout(items, true, undefined, annotation)!;
    for (const line of annotation.lines) expect(layout.text).toContain(line);
    expect(layout.text.indexOf(annotation.lines[0])).toBeLessThan(layout.text.indexOf("Analog Output Specifications"));
  });
  it("an equal-valued cloned row cannot impersonate the annotation's source item", () => {
    const items = micro820.pages.find((page) => page.page === 19)!.items;
    const table = contactRatingTable(items)!;
    expect(() => sectionTableLayout(items, true, undefined, { after: { ...table.lastRow }, lines: columnLines(table.rows) })).toThrow(/source row/i);
  });
});

describe("#5503 real ML1100 rating-head preservation", () => {
  it.each(ml1100Ratings.pages.filter((page) => page.page === 114 || page.page === 120))("page $page data and footnote vocabulary cannot become table captions", (page) => {
    const layout = sectionTableLayout(page.items)!;
    expect(layout).not.toBeNull();
    const captions = layout.headings.filter((h) => h.table).map((h) => h.text);
    expect(captions.some((text) => /^125V DC|^7\.0 A|^168VA/.test(text))).toBe(false);
    expect(captions.some((text) => /For (?:AC|DC) voltage applications|thermal continuous|DC Make\/Break Voltamperes/i.test(text))).toBe(false);
    expect(captions.some((text) => /Relay Contact Ratings/.test(text))).toBe(true);
  });
  it("remainder geometry contains only retained source items and excludes removed model-table captions", () => {
    const page = ml1100Ratings.pages.find((p) => p.page === 114)!;
    const table = pageWithTables(page.items);
    expect(table).not.toBeNull();
    expect(table!.remainderItems).toBeDefined();
    const compact = (value: string) => value.replace(/\s+/g, "");
    for (const item of table!.remainderItems!) {
      expect(page.items).toContain(item);
      expect(compact(table!.remainder)).toContain(compact(item.str));
    }
    // p114 prints the same caption twice. String presence cannot prove source
    // ownership: the first occurrence remains while the second is extracted.
    const retained = new Set<LayoutItem>(table!.remainderItems);
    const captions = page.items.filter((item) => item.str === "Relay Contact Ratings");
    expect(captions).toHaveLength(2);
    expect(captions.some((caption) => retained.has(caption))).toBe(true);
    expect(captions.some((caption) => !retained.has(caption))).toBe(true);
    for (const removed of captions.filter((caption) => !retained.has(caption))) {
      expect(table!.remainderItems).not.toContain(removed);
    }
  });
  it("the two common p114 relay-rating regions remain available while distinct General Output groups stay unresolved", () => {
    const page = ml1100Ratings.pages.find((p) => p.page === 114)!;
    const table = pageWithTables(page.items);
    expect(table).not.toBeNull();
    const contact = contactRatingTable(page.items);
    const layout = sectionTableLayout(page.items, true, table!.remainderItems, contact ? { after: contact.lastRow, lines: columnLines(contact.rows) } : undefined)!;
    const models = ["1763L16AWA", "1763L16BWA", "1763L16BBB", "1763L16DWD"];
    const outputs = new Map(models.map((model) => [model, true] as const));
    const parts = new SectionTableScope(outputs).split(layout.text, layout);
    let at = 0;
    const spans = parts.map((part) => { const start = at; at += part.text.length; return { part, start, end: at }; });
    let lineAt = 0;
    const lineOffsets = layout.retainedLines.map((line) => { const start = lineAt; lineAt += line.length + 1; return start; });
    const commonHeadings = layout.headings.filter((heading) => heading.table && /^Relay Contact Ratings(?:\s*\(\d+\))?$/.test(heading.text));
    expect(commonHeadings).toHaveLength(2);
    const commonRegions = commonHeadings.map((heading) => spans.find((span) => lineOffsets[heading.sourceLine] >= span.start && lineOffsets[heading.sourceLine] < span.end)!.part);
    for (const region of commonRegions) expect(region.scope).not.toBe("unresolved");
    expect(commonRegions[0].text).toContain("15.0 A 1.5 A");
    expect(commonRegions[1].text).toContain("30.0 A 3.0 A");
    const general = parts.find((part) => part.text.includes("Output Specifications For Ordinary"))!;
    expect(general.scope).toBe("unresolved");
    // The pre-existing reader's VA-shaped false model keys are a separate
    // limitation; this test does not attribute 1440VA/720VA to model groups.
    for (const line of contact ? columnLines(contact.rows) : []) {
      expect(parts.find((part) => part.text.includes(line))?.scope).not.toBe("unresolved");
    }
  });
  it("real p113 single-DWD caption and pure header establish only DWD scope", () => {
    const page = ml1100Ratings.pages.find((p) => p.page === 113)!;
    const table = pageWithTables(page.items);
    const layout = sectionTableLayout(page.items, true, table?.remainderItems)!;
    const outputs = new Map(["1763L16AWA", "1763L16BWA", "1763L16BBB", "1763L16DWD"].map((model) => [model, true] as const));
    const parts = new SectionTableScope(outputs).split(layout.text, layout);
    const dwd = parts.find((part) => part.text.includes("Digital Input Specifications for 1763-L16DWD"))!;
    expect(dwd).toEqual(expect.objectContaining({ scope: "section", models: ["1763L16DWD"] }));
    expect(dwd.text).toContain("Nominal impedance");
    expect(dwd.models).not.toContain("1763L16BBB");
  });
});

describe("#5503 runtime-review output inventory controls", () => {
  it.each(["24V DC sourcing", "Transistor sourcing", "Relay, isolated"])("an observed but unread type %s retains an unresolved model inventory", (value) => {
    const chunks = complete(); chunks[1] = column(QBB, value);
    const outputs = readOutputTypes(chunks);
    expect([...outputs.keys()].sort()).toEqual([AWB, QBB, QWB].sort());
    expect(outputs.get(QBB)).toBeNull();
    const parts = splitCaption(new SectionTableScope(outputs), "Relay Contact Ratings");
    expect(parts.find((part) => part.text.includes("Voltage, max"))).toEqual(expect.objectContaining({ scope: "unresolved", models: expect.arrayContaining([AWB, QBB, QWB]) }));
  });
  it("an output table with a missing third column keeps the full unresolved model inventory", () => {
    const chunks = [column(AWB, "Relay"), column(QBB, "FET"), {
      text: "Output circuit type cannot be assigned", models: [AWB, QBB, QWB], unqualified: true,
    }];
    const outputs = readOutputTypes(chunks);
    expect([...outputs.keys()].sort()).toEqual([AWB, QBB, QWB].sort());
    expect(outputs.get(QWB)).toBeNull();
    const parts = splitCaption(new SectionTableScope(outputs), "Relay Contact Ratings");
    expect(parts.some((part) => part.scope === "unresolved")).toBe(true);
  });
  it("conflicting output rows retain their models and mark the relay section unresolved", () => {
    const outputs = readOutputTypes([...complete(), column(QBB, "Relay")]);
    expect(outputs.has(QBB)).toBe(true);
    expect(outputs.get(QBB)).toBeNull();
    const parts = splitCaption(new SectionTableScope(outputs), "Relay Contact Ratings");
    expect(parts.some((part) => part.scope === "unresolved")).toBe(true);
  });
});

describe("#5503 scope follows qualified layout and resets at section boundaries", () => {
  it("infers relay scope from output evidence without inheriting a same-word heading", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    const sections = splitCaption(scope, "Relay Contact Ratings");
    expect(sections).toEqual([expect.objectContaining({ scope: "section", models: [AWB, QWB] })]);
  });
  it("an all-relay or all-non-relay family establishes no sibling-only relay restriction", () => {
    for (const type of ["Relay", "FET"]) {
      const outputs = readOutputTypes([column(AWB, type), column(QBB, type)]);
      const parts = splitCaption(new SectionTableScope(outputs), "Relay Contact Ratings");
      expect(parts.some((p) => p.scope === "section")).toBe(false);
    }
  });
  it("explicit known-family catalog scope survives a wrapped caption", () => {
    const items = [row("Relay Output Specifications for 2080-LC20-20QWB(R),", 700), row("2080-LC20-20AWB(R)", 690), row("Attribute Value", 670, 8), row("Life 100,000 cycles", 650, 8)];
    const layout = sectionTableLayout(items)!;
    const parts = new SectionTableScope(readOutputTypes(complete())).split(layout.text, layout);
    expect(parts).toEqual([expect.objectContaining({ scope: "section", models: expect.arrayContaining([QWB, AWB]) })]);
  });
  it.each(["FOR", "For", "for"])("caption applicability accepts %s with an all-caps title", (word) => {
    const items = [row(`RELAY OUTPUT SPECIFICATIONS ${word} 2080-LC20-20QWB(R),`, 700), row("2080-LC20-20AWB(R)", 690), row("ATTRIBUTE VALUE", 670, 8), row("Relay body marker", 650, 8)];
    const layout = sectionTableLayout(items)!;
    expect(layout).not.toBeNull();
    const parts = new SectionTableScope(readOutputTypes(complete())).split(layout.text, layout);
    expect(parts.find((p) => p.text.includes("Relay body marker"))).toEqual(expect.objectContaining({ scope: "section", models: [QWB, AWB] }));
  });
  it("two wrapped captions with the same prefix keep their own distinct model lists", () => {
    const items = [
      row("Output Specifications for 2080-LC20-20QWB(R),", 700), row("2080-LC20-20AWB(R)", 690),
      row("Attribute Value", 670, 8), row("Relay body marker", 650, 8),
      row("Output Specifications for 2080-LC20-20QBB(R),", 600), row("2080-LC20-20QBB(R)", 590),
      row("Attribute Value", 570, 8), row("Transistor body marker", 550, 8),
    ];
    const layout = sectionTableLayout(items)!;
    const parts = new SectionTableScope(readOutputTypes(complete())).split(layout.text, layout);
    const relay = parts.find((p) => p.text.includes("Relay body marker"))!;
    const transistor = parts.find((p) => p.text.includes("Transistor body marker"))!;
    expect(relay).toEqual(expect.objectContaining({ scope: "section", models: [QWB, AWB] }));
    expect(transistor).toEqual(expect.objectContaining({ scope: "section", models: [QBB] }));
    expect(relay.text).not.toContain("Transistor body marker");
    expect(transistor.text).not.toContain("Relay body marker");
  });
  it("complete output tables from unrelated families cannot jointly scope an unnamed relay table", () => {
    const outputs = readOutputTypes(complete());
    const other = readOutputTypes([column("1763L16BWB", "Relay"), column("1763L16BBB", "FET")]);
    expect(other.size).toBe(2);
    mergeOutputTypes(outputs, other);
    const parts = splitCaption(new SectionTableScope(outputs), "Relay Contact Ratings");
    expect(parts.some((p) => p.scope === "section")).toBe(false);
    expect(parts.some((p) => p.scope === "unresolved")).toBe(true);
  });
  it("foreign/accessory catalog headings never become restrictions for this family", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    const foreign = splitCaption(scope, "Power Requirements for 193-EC1");
    expect(foreign.every((p) => p.scope === undefined && p.models === undefined)).toBe(true);
  });
  it("an ordinary sentence mentioning specifications for a catalog is not a layout caption", () => {
    const items = [row("See specifications for 2080-LC20-20QWB in the manual.", 700, 8), row("Attribute Value", 680, 8)];
    expect(sectionTableLayout(items)).toBeNull();
  });
  it("shared analog/DC-input captions end relay scope, including a sibling number inside one subcolumn", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    splitCaption(scope, "Relay Output Specifications for 2080-LC20-20QWB(R), 2080-LC20-20AWB(R)");
    for (const title of ["Analog Output Specifications", "DC Input Specifications"]) {
      const parts = splitMixedHeader(scope, title);
      expect(parts).toEqual([expect.objectContaining({ scope: "shared", sharedHeader: expect.stringContaining("2080-LC20-20QWB(R)") })]);
      expect(parts[0].models).toBeUndefined();
    }
  });
  it("a scope persists in unheaded continuation text on the next page", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    splitCaption(scope, "Relay Output Specifications for 2080-LC20-20QWB(R), 2080-LC20-20AWB(R)");
    expect(scope.split("continued relay row", null)).toEqual([{ text: "continued relay row", models: [QWB, AWB], scope: "section" }]);
  });
  it("an unqualified heading on the same page makes continuity unresolved", () => {
    const items = [row("Relay Output Specifications for 2080-LC20-20QWB(R)", 700), row("Attribute Value", 680, 8), row("Life 100000 cycles", 660, 8), row("Maintenance Instructions", 620), row("Common care instructions", 600, 8)];
    const layout = sectionTableLayout(items)!;
    const parts = new SectionTableScope(readOutputTypes(complete())).split(layout.text, layout);
    const common = parts.find((p) => p.text.includes("Common care instructions"))!;
    expect(common.models).toEqual([QWB]);
    expect(common.scope).toBe("unresolved");
  });
  it("an unqualified next-page heading cannot release inherited scope", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    splitCaption(scope, "Relay Output Specifications for 2080-LC20-20QWB(R)");
    const items = [row("Maintenance Instructions", 700), row("Common care instructions", 680, 8)];
    const layout = sectionTableLayout(items);
    const parts = scope.split(layout?.text ?? "Maintenance Instructions\nCommon care instructions", layout);
    expect(parts.find((p) => p.text.includes("Common care instructions"))).toMatchObject({ models: [QWB], scope: "unresolved" });
  });
  it("a shared table marker cannot bypass explicit sibling-only prose after an unrelated next-page heading", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    expect(splitMixedHeader(scope, "Analog Output Specifications")[0].scope).toBe("shared");
    const items = [row("Relay Output Data", 700), row("2080-LC20-20QWB(R) only: relay output endurance evidence.", 680, 8)];
    const layout = sectionTableLayout(items)!;
    const parts = scope.split(layout.text, layout);
    const sibling = parts.find((p) => p.text.includes("relay output endurance evidence"))!;
    expect(sibling.scope).toBeUndefined();
    expect(sibling.models).toBeUndefined();
  });
  it("a shared table marker clears at a next page whose layout cannot be read", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    expect(splitMixedHeader(scope, "DC Input Specifications")[0].scope).toBe("shared");
    expect(scope.split("2080-LC20-20QWB(R) only: sibling output evidence.", null)).toEqual([
      { text: "2080-LC20-20QWB(R) only: sibling output evidence." },
    ]);
  });
  it("an unreadable section stays unresolved until a readable caption establishes the next scope", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    splitCaption(scope, "Relay Output Specifications for 2080-LC20-20QWB(R), 2080-LC20-20AWB(R)");
    expect(scope.unreadable("layout failure text")).toEqual([
      { text: "layout failure text", scope: "unresolved", models: [AWB, QBB, QWB] },
    ]);
    expect(scope.split("unheaded continuation", null)[0].scope).toBe("unresolved");
    const restored = splitCaption(scope, "DC Output Specifications for 2080-LC20-20QBB(R)");
    expect(restored).toEqual([expect.objectContaining({ scope: "section", models: [QBB] })]);
  });
  it.each(["Table 4 Relay Contact Ratings", "12 Relay Output Specifications", "Relay Outputs", "Contact Ratings (Relay)"])("a noncanonical relay table caption %s remains unresolved rather than shared", (title) => {
    const source = caption(title);
    const parts = new SectionTableScope(readOutputTypes(complete())).split(source.text, source.layout);
    expect(parts.find((part) => part.text.includes("Voltage, max"))).toEqual(expect.objectContaining({ scope: "unresolved", models: expect.arrayContaining([AWB, QBB, QWB]) }));
  });
  it("same-baseline prefix fragments cannot convert relay ratings into a shared section", () => {
    const items = [row("Table 4", 700, 10, 70), row("Relay Contact Ratings", 700, 10, 120), row("Attribute Value", 680, 8), row("Voltage, max 250 V, AC", 660, 8)];
    const layout = sectionTableLayout(items)!;
    const parts = new SectionTableScope(readOutputTypes(complete())).split(layout.text, layout);
    expect(parts.find((part) => part.text.includes("Voltage, max"))?.scope).toBe("unresolved");
  });
  it("blank unreadable pages do not expire unresolved scope before a readable caption", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    splitCaption(scope, "Relay Output Specifications for 2080-LC20-20QWB(R)");
    scope.unreadable("");
    for (let page = 0; page < 100; page++) {
      expect(scope.split(`unheaded continuation ${page}`, null)[0].scope).toBe("unresolved");
    }
    expect(splitCaption(scope, "DC Output Specifications for 2080-LC20-20QBB(R)")[0]).toEqual(expect.objectContaining({ scope: "section", models: [QBB] }));
  });
  it("a removed relay caption anchors to its own repeated source line, never an earlier QBB body anchor", () => {
    const dcCaption = row("DC Output Specifications for 2080-LC20-20QBB(R)", 700);
    const dcHeader = row("Attribute Value", 680, 8);
    const earlierAnchor = row("REPEATED ANCHOR", 660, 8);
    const qbbBody = row("QBB-only current rating 1 A.", 640, 8);
    const removedCaption = row("Relay Output Specifications for 2080-LC20-20QWB(R), 2080-LC20-20AWB(R)", 600);
    const removedHeader = row("Attribute Value", 580, 8);
    const removedBody = row("Extracted relay table row", 560, 8);
    const laterAnchor = row("REPEATED ANCHOR", 520, 8);
    const relayBody = row("Relay-only contact current evidence.", 500, 8);
    const retained = [dcCaption, dcHeader, earlierAnchor, qbbBody, laterAnchor, relayBody];
    const source = [dcCaption, dcHeader, earlierAnchor, qbbBody, removedCaption, removedHeader, removedBody, laterAnchor, relayBody];
    const layout = sectionTableLayout(source, true, retained)!;
    const text = retained.map((item) => item.str).join("\n");
    const parts = new SectionTableScope(readOutputTypes(complete())).split(text, layout);
    const qbb = parts.find((part) => part.text.includes(qbbBody.str))!;
    const relay = parts.find((part) => part.text.includes(relayBody.str))!;
    expect(qbb).toEqual(expect.objectContaining({ scope: "section", models: [QBB] }));
    expect(relay).toEqual(expect.objectContaining({ scope: "section", models: [QWB, AWB] }));
    expect(qbb.text).not.toContain(relayBody.str);
    expect(relay.text).not.toContain(qbbBody.str);
  });
  it.each(["missing", "reordered", "extra"])("a source-owned boundary rejects a %s retained line sequence", (change) => {
    const first = row("Retained first line.", 620, 8);
    const second = row("Retained second line.", 600, 8);
    const source = [row("DC Output Specifications for 2080-LC20-20QBB(R)", 700), row("Attribute Value", 680, 8), row("Extracted QBB table row", 650, 8), first, second];
    const layout = sectionTableLayout(source, true, [first, second])!;
    const text = change === "missing" ? first.str : change === "reordered" ? `${second.str}\n${first.str}` : `${first.str}\nUnexpected retained line.\n${second.str}`;
    const scope = new SectionTableScope(readOutputTypes(complete()));
    splitCaption(scope, "Relay Output Specifications for 2080-LC20-20QWB(R)");
    const parts = scope.split(text, layout);
    expect(parts).toEqual([{ text, scope: "unresolved", models: expect.arrayContaining([AWB, QBB, QWB]) }]);
    expect(parts.some((part) => part.scope === "section")).toBe(false);
  });
  it("a retained heading cannot bind to its earlier inline caption reference", () => {
    const relayCaption = "Relay Output Specifications for 2080-LC20-20QWB(R), 2080-LC20-20AWB(R)";
    const qbbBody = "QBB-only current rating 1 A.";
    const relayBody = "Relay-only contact current evidence.";
    const items = [row("DC Output Specifications for 2080-LC20-20QBB(R)", 700), row("Attribute Value", 680, 8),
      row(`For contrast see ${relayCaption} later.`, 660, 8), row(qbbBody, 640, 8),
      row(relayCaption, 600), row("Attribute Value", 580, 8), row(relayBody, 560, 8)];
    const layout = sectionTableLayout(items)!;
    const parts = new SectionTableScope(readOutputTypes(complete())).split(layout.text, layout);
    const own = parts.find((part) => part.text.includes(qbbBody))!;
    const relay = parts.find((part) => part.text.includes(relayBody))!;
    expect(own).toEqual(expect.objectContaining({ scope: "section", models: [QBB] }));
    expect(relay).toEqual(expect.objectContaining({ scope: "section", models: [QWB, AWB] }));
    expect(relay.text).not.toContain(qbbBody);
  });
  it("a source-owned removed QBB caption resets prior QWB scope at its next retained line", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    splitCaption(scope, "Relay Output Specifications for 2080-LC20-20QWB(R), 2080-LC20-20AWB(R)");
    const kept = row("Retained text after the QBB model table.", 620, 8);
    const items = [row("DC Output Specifications for 2080-LC20-20QBB(R)", 700), row("Attribute Value", 680, 8), row("Extracted QBB model-table row", 650, 8), kept];
    const layout = sectionTableLayout(items, true, [kept])!;
    const parts = scope.split(kept.str, layout);
    expect(parts).toEqual([{ text: kept.str, scope: "section", models: [QBB] }]);
    expect(parts[0].models).not.toContain(QWB);
  });
  it.each(["shared", "section"])("a missing caption in the table remainder cannot inherit prior %s scope", (previous) => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    splitCaption(scope, previous === "shared" ? "Analog Output Specifications" : "Relay Output Specifications for 2080-LC20-20QWB(R)");
    const source = caption("DC Output Specifications for 2080-LC20-20QBB(R)");
    const missingCaptionText = "Attribute Value\nVoltage, max 250 V, AC";
    const parts = scope.split(missingCaptionText, source.layout);
    expect(parts.find((part) => part.text.includes("Voltage, max"))).toEqual(expect.objectContaining({ scope: "unresolved", models: expect.arrayContaining([AWB, QBB, QWB]) }));
  });
  it("another document starts without the preceding upload's active scope", () => {
    const first = new SectionTableScope(readOutputTypes(complete()));
    splitCaption(first, "Relay Output Specifications for 2080-LC20-20QWB(R)");
    const second = new SectionTableScope(readOutputTypes(complete()));
    expect(second.split("ordinary prose on another upload", null)).toEqual([{ text: "ordinary prose on another upload" }]);
  });
});

// Section assertions are source evidence in their own right; no circuit row is required.
describe("explicit model captions without an output-circuit inventory", () => {
  it("scopes the whole long section and an unheaded continuation from its caption", () => {
    const scope = new SectionTableScope(new Map());
    const source = caption("Output Specifications for RX410", "Current 2 A\n".repeat(250));
    expect(scope.split(source.text, source.layout).every((p) => p.scope === "section" && p.models?.join() === "RX410")).toBe(true);
    expect(scope.split("continued current 2 A", null)).toEqual([{text:"continued current 2 A",scope:"section",models:["RX410"]}]);
  });
  it("an unreadable gap after an explicit model caption does not release it", () => {
    const scope = new SectionTableScope(new Map());
    splitCaption(scope, "Output Specifications for RX410");
    expect(scope.unreadable("uncertain geometry")[0].scope).toBe("unresolved");
    expect(scope.split("continued current 2 A", null)[0].scope).toBe("unresolved");
  });
  it("a compatible subsequent generic table ends the explicit restriction without asserting exact-model certification", () => {
    const scope = new SectionTableScope(new Map());
    splitCaption(scope,"Output Specifications for RX410");
    const generic=splitCaption(scope,"Analog Output Specifications");
    expect(generic.every((p)=>p.scope === undefined && p.models === undefined)).toBe(true);
  });
});

it("a service sentence above a product display/description header cannot declare model scope", () => {
  const items=[row("For service, contact Northfield technical support.",700,10),row("Description",680,8,100),row("Display on",680,8,300),row("RX410(X)",668,8,300),row("Keypad",656,8,300),row("Fault code",630,8,100),row("E001",630,8,300)];
  const layout=sectionTableLayout(items);
  expect(layout?.headings.filter((h)=>h.table) ?? []).toEqual([]);
});

it("a direct catalog noun-title scopes a common Value column and continuation",()=>{
 const l=sectionTableLayout([row("Input Specifications ZX740-02A",700,12),row("Attribute Value",680),row("Settling interval 12 ms",660)])!;
 expect(modelSectionModels(l)).toEqual(["ZX74002A"]);
 const scope=new SectionTableScope(new Map(),true,modelSectionModels(l));
 expect(scope.split(l.text,l).find(s=>s.text.includes("Settling interval"))).toMatchObject({scope:"section",models:["ZX74002A"]});
 expect(scope.split("Further timing values continue without a catalog label.",null)[0]).toMatchObject({scope:"section",models:["ZX74002A"]});
});
it("a direct title and foreign model header contradict rather than choosing the header",()=>{
 const l=sectionTableLayout([row("Input Specifications ZX740-02A",700,12),row("Attribute ZX740-08B",680),row("Settling interval 12 ms",660)])!;
 const scope=new SectionTableScope(new Map(),true,modelSectionModels(l));
 expect(scope.split(l.text,l).find(s=>s.text.includes("Settling interval"))).toMatchObject({scope:"unresolved"});
});

it("explicit mixed-family caption lists preserve each agreeing extracted column", () => {
  const items = [row("Input Specifications ZX740-02A, RQ830-08B", 700, 12),
    row("Attribute", 680, 10, 100), row("ZX740-02A", 680, 10, 250), row("RQ830-08B", 680, 10, 400),
    row("Interval", 660, 10, 100), row("12 ms", 660, 10, 250), row("24 ms", 660, 10, 400)];
  const layout = sectionTableLayout(items)!;
  const chunks = ["ZX74002A", "RQ83008B"].map((key) => ({ text: `${key}: Interval`, models: [key], unqualified: false, sourceTop: 680 }));
  expect(scopeTableChunks(chunks, layout).every((c) => !c.unqualified)).toBe(true);
  // A caption naming just one of those columns contradicts the other header.
  const conflict = sectionTableLayout([{ ...items[0], str: "Input Specifications ZX740-02A" }, ...items.slice(1)])!;
  expect(scopeTableChunks(chunks, conflict).every((c) => c.unqualified && c.scope === "unresolved")).toBe(true);
});

it.each([
  "ZX740 Control Terminal Specifications",
  "Input Specifications ZX740-02A service information",
])("a prefix product or catalog-bearing prose does not become a direct catalog suffix: %s", (title) => {
  const layout = sectionTableLayout([row(title, 700, 12), row("Attribute Value", 680), row("Interval 12 ms", 660)])!;
  expect(modelSectionModels(layout)).toEqual([]);
});

it.each(["table", "named-smaller", "unnamed-smaller"])("F7 rejects an unsplit block crossing a later %s section", (kind) => {
  const item = (str: string, x: number, y: number, size = 8) => ({ str, x, y, size, w: str.length * size * 0.4 });
  const layout = sectionTableLayout([
    item("Output Specifications for 2080-LC20-20QWB, 2080-LC20-20AWB", 100, 740, kind === "table" ? 10 : 12),
    item("Attribute", 100, 720), item("2080-LC20-20QWB", 280, 720), item("2080-LC20-20AWB", 420, 720),
    item("Load current max", 100, 706), item("2 A", 280, 706), item("1 A", 420, 706),
    item(kind === "table" ? "Output Specifications for 2080-LC20-20QBB" : kind === "named-smaller" ? "DC Output Data for 2080-LC20-20QBB" : "DC Output Data", 100, 676, 10), item("Attribute Value", 100, 662), item("Point current max 9 A", 100, 648),
  ])!;
  const chunk = { text: "2080-LC20-20QWB: Point current max 9 A", models: ["2080LC2020QWB"], unqualified: false,
    sourceTop: 720, sourceBottom: 648, sourceHeaderSize: 8, sourceBodySize: 8, sourceCaption: "Output Specifications for 2080-LC20-20QWB, 2080-LC20-20AWB" };
  expect(scopeTableChunks([chunk], layout)[0]).toMatchObject({ unqualified: true, scope: "unresolved" });
});


it.each(["named", "unnamed", "next-page", "named-no-header", "unnamed-no-header", "next-page-no-header", "named-no-header-tall-header", "named-no-header-tall-label", "named-no-header-close", "named-no-header-unicode", "named-no-header-long", "named-no-header-body-note", "named-no-header-heading-note", "named-no-header-negative", "named-no-header-indented", "named-no-header-raw-values", "named-no-header-split-title", "next-page-no-header-indented", "next-page-no-header-split-title", "named-no-header-indented-bold-label", "named-no-header-larger-body", "named-no-header-same-body-font", "named-no-header-same-body-font-negative", "named-no-header-wide-gap", "named-no-header-page-end"])("F10 a smaller %s heading interrupts a single-model section without extracted columns", (kind) => {
  const title = kind.startsWith("unnamed") ? "DC Output Data" : "DC Output Data for 2080-LC20-20QBB";
  const items = [row("Output Specifications for 2080-LC20-20QWB", 740, 12),
    row("Attribute Value", 720, 8), row("Load current max 2 A", 706, 8),
    row(title, 676, 10), row("Attribute Value", 662, 8),
    row("Point current max 9 A", 648, 8), row("Point surge max 11 A", 634, 8)];
  if (kind.endsWith("tall-header") || kind.endsWith("tall-label")) { items[0].size = 16; items[1].size = 12; }
  if (kind.endsWith("tall-label")) items.splice(2, 1, row("Load current max", 706, 14), row("2 A", 706, 8, 320));
  if (kind.includes("no-header")) items.splice(items.findIndex((r) => r.y === 662), 1);
  if (kind.endsWith("close")) for (const r of items) {
    if (r.y === 676) r.y = 692; else if (r.y === 648) r.y = 678; else if (r.y === 634) r.y = 664;
  }
  if (kind.endsWith("body-note")) {
    items[0].size=16;items[1].size=12;
    items.splice(2,1,row("Load current max",706,14),row("2 A",706,8,320),row("(1)",706,4,330));
  }
  if (kind.endsWith("heading-note")) {
    const title=items.find((r)=>r.str.startsWith("DC Output Data"))!;
    items.push(row("(1)",title.y,4,title.x+title.w+2));
  }
  if (kind.endsWith("negative")) items.find((r)=>r.str.startsWith("DC Output Data"))!.str="DC Output Data (not for 2080-LC20-20QWB)";
  if (kind.endsWith("unicode")) items.find((r) => r.str.startsWith("DC Output Data"))!.str = items.find((r) => r.str.startsWith("DC Output Data"))!.str.replaceAll("-", "\u2011");
  if (kind.includes("indented")) for (const r of items) { if (r.y === 648 || r.y === 634) r.x = 180; }
  if (kind.endsWith("raw-values")) for (const r of items) {
    if (r.y === 648 || r.y === 634) { r.str = r.y === 648 ? "9 A" : "11 A"; r.x = 350; }
  }
  if (kind.endsWith("split-title")) {
    const at = items.findIndex((r) => r.str.startsWith("DC Output Data"));
    items.splice(at, 1, row("DC Output Data for", 676, 10), row("2080-LC20-20QBB", 676, 10, 350));
  }
  if (kind.endsWith("bold-label")) {
    const at = items.findIndex((r) => r.y === 648);
    items.splice(at, 1, row("Point current max", 648, 11, 180), row("9 A", 648, 8, 350));
  }
  if (kind.endsWith("larger-body")) for (const r of items) { if (r.y === 648 || r.y === 634) r.size = 11; }
  if (kind.includes("same-body-font")) items.find((r) => r.str.startsWith("DC Output Data"))!.size = 8;
  if (kind.endsWith("wide-gap")) for (const r of items) { if (r.y === 648 || r.y === 634) r.y -= 48; }
  if (kind.endsWith("long")) {
    items.find((r) => r.y === 634)!.y = 320;
    for (let n=0;n<20;n++) items.push(row("Additional electrical operating conditions and parameter context without a new model assertion.",620-n*14,8));
  }
  expect(pageWithTables(items)).toBeNull();
  const scope = new SectionTableScope(new Map(), true, [QWB]);
  const original = sectionTableLayout(kind.startsWith("next-page") ? items.slice(0, 3) : kind.endsWith("page-end") ? items.slice(0, 4) : items)!;
  const first = scope.splitPage(original.text, original, []);
  expect(first.sections.find((part) => part.text.includes("Load current max"))).toMatchObject({ models: [QWB], scope: "section" });
  const nextItems = kind.startsWith("next-page") ? items.slice(3) : kind.endsWith("page-end") ? items.slice(4) : null;
  const next = nextItems ? sectionTableLayout(nextItems) : null;
  const result = nextItems ? scope.splitPage(next?.text ?? nextItems.map((r) => r.str).join("\n"), next, []) : first;
  const later = result.sections.find((part) => part.text.includes(kind.endsWith("raw-values") ? "9 A" : "Point current max"))!;
  expect(later).toMatchObject({ scope: "unresolved" });
  expect(later.text).not.toContain("Load current max");
  expect(scope.split("Point current max 9 A continued", null)[0]).toMatchObject({ scope: "unresolved" });
});

it.each(measuredMatrix)("F10 measured data $id preserves valid original values", (c) => {
  const items = measuredMatrixPage(c);
  const layout = sectionTableLayout(items)!;
  const parts = new SectionTableScope(new Map(), true, [QWB]).splitPage(layout.text, layout, []).sections;
  for (const token of ["zzmeasureoriginal", "zzmeasurelast"]) {
    const rows = parts.filter((p) => p.text.includes(token));
    expect(rows.length).toBeGreaterThan(0);
    if (c.font === 14 && token === "zzmeasurelast") expect(rows.every((p) => p.scope === "unresolved")).toBe(true);
    else expect(rows.every((p) => p.scope === "section" && p.models?.includes(QWB))).toBe(true);
  }
});

it.each(boundaryMatrix)("F10 geometry-independent boundary $id preserves only the original model values", (c) => {
  const scope = new SectionTableScope(new Map(), true, [QWB]);
  const parts = boundaryMatrixPages(c).flatMap((items) => {
    const layout = sectionTableLayout(items);
    return scope.splitPage(layout?.text ?? items.map((r) => r.str).join("\n"), layout, []).sections;
  });
  const original = parts.filter((p) => p.text.includes("zzmatrixoriginal"));
  expect(original.length).toBeGreaterThan(0);
  expect(original.every((p) => p.scope === "section" && p.models?.includes(QWB))).toBe(true);
  for (const token of ["zzmatrixfirst", "zzmatrixlast", "zzmatrixcontinued"]) {
    const later = parts.filter((p) => p.text.includes(token));
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((p) => p.scope === "unresolved")).toBe(true);
    expect(later.every((p) => !p.text.includes("zzmatrixoriginal"))).toBe(true);
  }
});

it("F10 local boundaries neither qualify unrelated tables nor mistake larger grid rows or service prose for headings", () => {
  const ordinary = sectionTableLayout([row("DC Output Data", 700, 10), row("Attribute Value", 680, 8), row("Point current max 9 A", 660, 8)])!;
  expect(new SectionTableScope(new Map()).split(ordinary.text, ordinary)).toEqual([{ text: ordinary.text }]);
  const items = [row("Output Specifications for 2080-LC20-20QWB", 740, 12), row("Attribute Value", 720, 8),
    row("Load current max", 706, 10), row("2 A", 706, 8, 280), row("Switching time max 10 ms", 692, 8),
    row("For service, contact technical support.", 676, 10), row("Description Value", 662, 8),
    row("Operating temperature 50 C", 648, 8), row("1", 620, 4)];
  const layout = sectionTableLayout(items)!;
  const parts = new SectionTableScope(new Map(), true, [QWB]).split(layout.text, layout);
  expect(parts.find((part) => part.text.includes("Switching time max"))).toMatchObject({ models: [QWB], scope: "section" });
  expect(parts.find((part) => part.text.includes("Operating temperature"))).toMatchObject({ models: [QWB], scope: "section" });
});

it.each([null, undefined])("F8 distinguishes a successfully headingless page from unreadable geometry (%s)", (layout) => {
  const chunk = { text: "2080-LC20-20QWB: Load current max 2 A", models: [QWB], unqualified: false, sourceTop: 720, sourceBottom: 686, sourceHeaderSize: 8 };
  const result = scopeTableChunks([chunk], layout)[0];
  expect(result.unqualified).toBe(layout === undefined);
  expect(result.scope).toBe(layout === undefined ? "unresolved" : undefined);
});


it.each(["same", "alias"])("duplicate %s catalog columns retain every cell as unresolved data", (kind) => {
  const item = (str: string, x: number, y: number) => ({ str, x, y, size: 8, w: str.length * 3.2 });
  const items = [item("Attribute", 100, 720), item("RX-420", 280, 720), item(kind === "same" ? "RX-420" : "RX420", 420, 720),
    item("Connection", 100, 706), item("internally", 280, 706), item("externally", 420, 706),
    item("Inputs per Module", 100, 692), item("4", 280, 692), item("8", 420, 692)];
  const block = detectModelTables(items)[0];
  expect(block).toBeDefined();
  for (const chunks of [tableChunks(block), pageWithTables(items)!.chunks]) {
    expect(chunks.every((c) => c.unqualified)).toBe(true);
    expect(chunks.every((c) => c.models.length === 1 && c.models[0] === "RX420")).toBe(true);
    const text = chunks.map((c) => c.text).join("\n");
    for (const word of [...block.models, "internally", "externally", "4", "8"]) expect(text).toContain(word);
  }
});


it("an anonymous parameter-column span stays unqualified within its original domain", () => {
  const item = (str: string, x: number, y: number, size = 8) => ({ str, x, y, size, w: str.length * size * 0.4 });
  const items = [item("Attribute", 100, 720), item("P01.20", 280, 720), item("P01.21", 420, 720),
    item("Current max", 100, 706), item("2 A", 280, 706), item("1 A", 420, 706),
    item("Switching time", 100, 692), item("10 ms", 280, 692), item("8 ms", 420, 692),
    item("DC Output Data", 100, 676, 10), item("Attribute", 100, 662), item("Value", 280, 662),
    item("Point current max", 100, 648), item("9 A", 280, 648)];
  const unsplit = pageWithTables(items)!;
  const result = scopeTableChunks(unsplit.chunks, sectionTableLayout(items));
  expect(result.filter((c) => !c.unqualified)).toHaveLength(0);
  expect(result.every((c) => c.scope === undefined)).toBe(true);
});

it("body-font headings do not turn uniform larger numeric rows or a small footnote into new sections", () => {
 const items=[row("Output Specifications for 2080-LC20-20QWB",740,12),row("Attribute Value",720,8),
  row("Load current max 2 A",706,10),row("Switching time max 10 ms",692,8),
  row("Output circuit type Relay",678,8),row("1",664,4.9)];
 const layout=sectionTableLayout(items)!; const scope=new SectionTableScope(new Map(),true,[QWB]);
 const result=scope.splitPage(layout.text,layout,[]);
 for(const value of ["2 A","10 ms","Relay"]) expect(result.sections.find(p=>p.text.includes(value))).toMatchObject({scope:"section",models:[QWB]});
 expect(scope.split("Continued load current max 2 A",null)[0]).toMatchObject({scope:"section",models:[QWB]});
});

it("a title followed only by raw smaller-font values ends inherited scope", () => {
 const items=[row("Output Specifications for 2080-LC20-20QWB",740,12),row("Attribute Value",720,8),row("Load current max 2 A",706,8),
 row("DC Output Data",692,10),row("9 A",678,8),row("11 A",664,8)];
 const layout=sectionTableLayout(items)!; const scope=new SectionTableScope(new Map(),true,[QWB]);
 const result=scope.splitPage(layout.text,layout,[]);
 expect(result.sections.find(p=>p.text.includes("2 A"))).toMatchObject({scope:"section",models:[QWB]});
 expect(result.sections.find(p=>p.text.includes("9 A"))).toMatchObject({scope:"unresolved"});
 expect(scope.split("11 A continued",null)[0]).toMatchObject({scope:"unresolved"});
});

it("a new local body title cannot release whole-page uncertainty from an equal-or-larger unqualified heading", () => {
 const scope=new SectionTableScope(new Map(),true,[QWB]);
 const previous=caption("Output Specifications for 2080-LC20-20QWB");
 scope.split(previous.text,previous.layout);
 const items=[row("Potential continuation current 2 A",740,8),row("DC Output Data for 2080-LC20-20QBB",700,9),
 row("Point current max 9 A",680,8),row("Unqualified page heading",100,14)];
 const layout=sectionTableLayout(items)!;
 const result=scope.splitPage(layout.text,layout,[]);
 expect(result.sections.every(p=>p.scope==="unresolved")).toBe(true);
});

it("a larger value-only row is data rather than a section title", () => {
 const items=[row("Output Specifications for 2080-LC20-20QWB",740,12),row("Attribute Value",720,8),
 row("Load current max",706,8),row("9 A",692,10),row("Switching time max 10 ms",678,8)];
 const layout=sectionTableLayout(items)!; const scope=new SectionTableScope(new Map(),true,[QWB]);
 const result=scope.splitPage(layout.text,layout,[]);
 expect(result.sections.find(p=>p.text.includes("9 A"))).toMatchObject({scope:"section",models:[QWB]});
 expect(result.sections.find(p=>p.text.includes("10 ms"))).toMatchObject({scope:"section",models:[QWB]});
});
