import { describe, expect, it } from "vitest";
import { mergeOutputTypes, readOutputTypes, SectionTableScope, sectionTableLayout } from "../section-table-scope";
import type { LayoutItem, TableChunk } from "../table-rows";

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
    expect(readOutputTypes(chunks).size).toBe(0);
  });
  it.each(["Unknown", "See note 3", "DC input only; output type unspecified", "FET compatibility is not specified", "Relay compatibility is not specified", "Relay not fitted"])("does not convert uncertain type %s into authoritative non-relay evidence", (value) => {
    const chunks = complete(); chunks[1] = column(QBB, value);
    expect(readOutputTypes(chunks).size).toBe(0);
  });
  it("a table with only one model cannot establish sibling applicability", () => {
    expect(readOutputTypes([column(AWB, "Relay")]).size).toBe(0);
  });
  it("multi-model and unqualified chunks do not identify a value for each model", () => {
    const chunks = complete();
    chunks[1] = { ...chunks[1], models: [QBB, QWB] };
    expect(readOutputTypes(chunks).size).toBe(0);
    expect(readOutputTypes(complete().map((c) => ({ ...c, unqualified: true }))).size).toBe(0);
  });
  it("an unreadable model column cannot silently disappear behind two readable columns", () => {
    const chunks = [column(AWB, "Relay"), column(QBB, "FET"), {
      text: "Output circuit type cannot be assigned", models: [AWB, QBB, QWB], unqualified: true,
    }];
    expect(readOutputTypes(chunks).size).toBe(0);
  });
  it("conflicting duplicate columns cannot use the last value as authoritative", () => {
    expect(readOutputTypes([...complete(), column(QBB, "Relay")]).size).toBe(0);
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
    expect(parts.some((p) => p.scope === "section" || p.models !== undefined)).toBe(false);
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
      const parts = splitCaption(scope, title, "Isolated inputs for 2080-LC20-20QWB(R), 2080-LC20-20QBB(R) only");
      expect(parts).toEqual([expect.objectContaining({ scope: "shared" })]);
      expect(parts[0].models).toBeUndefined();
    }
  });
  it("a scope persists in unheaded continuation text on the next page", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    splitCaption(scope, "Relay Output Specifications for 2080-LC20-20QWB(R), 2080-LC20-20AWB(R)");
    expect(scope.split("continued relay row", null)).toEqual([{ text: "continued relay row", models: [QWB, AWB], scope: "section" }]);
  });
  it("an unrelated heading on the same page resets relay scope before its body", () => {
    const items = [row("Relay Output Specifications for 2080-LC20-20QWB(R)", 700), row("Attribute Value", 680, 8), row("Life 100000 cycles", 660, 8), row("Maintenance Instructions", 620), row("Common care instructions", 600, 8)];
    const layout = sectionTableLayout(items)!;
    const parts = new SectionTableScope(readOutputTypes(complete())).split(layout.text, layout);
    const common = parts.find((p) => p.text.includes("Common care instructions"))!;
    expect(common.models).toBeUndefined();
    expect(common.scope).toBeUndefined();
  });
  it("an unrelated next-page heading resets relay scope even without another table caption", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    splitCaption(scope, "Relay Output Specifications for 2080-LC20-20QWB(R)");
    const items = [row("Maintenance Instructions", 700), row("Common care instructions", 680, 8)];
    const layout = sectionTableLayout(items);
    const parts = scope.split(layout?.text ?? "Maintenance Instructions\nCommon care instructions", layout);
    expect(parts.find((p) => p.text.includes("Common care instructions"))?.models).toBeUndefined();
  });
  it("a shared table marker cannot bypass explicit sibling-only prose after an unrelated next-page heading", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    expect(splitCaption(scope, "Analog Output Specifications")[0].scope).toBe("shared");
    const items = [row("Relay Output Data", 700), row("2080-LC20-20QWB(R) only: relay output endurance evidence.", 680, 8)];
    const layout = sectionTableLayout(items)!;
    const parts = scope.split(layout.text, layout);
    const sibling = parts.find((p) => p.text.includes("relay output endurance evidence"))!;
    expect(sibling.scope).toBeUndefined();
    expect(sibling.models).toBeUndefined();
  });
  it("a shared table marker clears at a next page whose layout cannot be read", () => {
    const scope = new SectionTableScope(readOutputTypes(complete()));
    expect(splitCaption(scope, "DC Input Specifications")[0].scope).toBe("shared");
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
  it("another document starts without the preceding upload's active scope", () => {
    const first = new SectionTableScope(readOutputTypes(complete()));
    splitCaption(first, "Relay Output Specifications for 2080-LC20-20QWB(R)");
    const second = new SectionTableScope(readOutputTypes(complete()));
    expect(second.split("ordinary prose on another upload", null)).toEqual([{ text: "ordinary prose on another upload" }]);
  });
});
