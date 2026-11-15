import { describe, expect, it } from "bun:test";
import {
  EQUIPMENT_FIXTURE,
  expandedFor,
  findEntry,
  indexEquipment,
  locationOf,
  placeOf,
  pushRecent,
  repeatedTagIds,
  sameTarget,
  searchEquipment,
  shortPlaceOf,
  targetFor,
  targetText,
} from "@factorylm/interaction";

const entries = indexEquipment(EQUIPMENT_FIXTURE);
const entry = (id: string) => {
  const found = findEntry(entries, id);
  if (!found) throw new Error(`fixture is missing ${id}`);
  return found;
};

describe("equipment hierarchy", () => {
  it("indexes site > area > line > machine > assembly > component in tree order", () => {
    expect(entries.map((e) => e.node.id).slice(0, 8)).toEqual([
      "site-lw", "area-garage", "line-bench", "m-gs10-bench", "asm-panel", "c-vfd1-bench", "c-q1-mlc-bench", "c-plc1-bench",
    ]);
    expect(placeOf(entry("c-plc1-bench"))).toBe("Lake Wales plant › Garage › Bench line › GS10 bench › Control panel");
  });

  it("short place is line and machine: enough to tell two VFD1s apart", () => {
    expect(shortPlaceOf(entry("c-vfd1-bench"))).toBe("Bench line › GS10 bench");
    expect(shortPlaceOf(entry("c-vfd1-line2"))).toBe("Line 2 › Conveyor 2");
  });

  it("location stops above the machine", () => {
    expect(locationOf(entry("c-vfd1-bench"))).toBe("Lake Wales plant › Garage › Bench line");
    expect(locationOf(entry("c-vfd1-line2"))).toBe("Lake Wales plant › Garage › Line 2");
  });

  it("opening a row's ancestors makes it visible", () => {
    expect([...expandedFor(entries, "c-vfd1-bench")]).toEqual(["site-lw", "area-garage", "line-bench", "m-gs10-bench", "asm-panel"]);
    expect(expandedFor(entries, null).size).toBe(0);
  });
});

describe("repeated tags show where they are", () => {
  it("both VFD1 rows are flagged", () => {
    const repeated = repeatedTagIds(entries);
    expect(repeated.has("c-vfd1-bench")).toBe(true);
    expect(repeated.has("c-vfd1-line2")).toBe(true);
  });
  it("control: a unique tag is not flagged", () => {
    const repeated = repeatedTagIds(entries);
    expect(repeated.has("c-plc1-bench")).toBe(false);
    expect(repeated.has("c-q1-mlc-bench")).toBe(false);
    expect(repeated.has("m-gs10-bench")).toBe(false);
  });
});

describe("search bypasses the tree", () => {
  it("finds both VFD1s by tag, each with a different place", () => {
    const hits = searchEquipment(entries, "vfd1");
    expect(hits.map((h) => h.node.id)).toEqual(["c-vfd1-bench", "c-vfd1-line2"]);
    expect(new Set(hits.map(placeOf)).size).toBe(2);
  });
  it("finds a component by model", () => {
    expect(searchEquipment(entries, "micro820").map((h) => h.node.id)).toEqual(["c-plc1-bench"]);
  });
  it("finds MLC by its label, drawing designation, catalog number and PLC symbol", () => {
    for (const query of ["mlc", "q1", "ca3kn22bd", "_io_em_do_02"]) {
      expect(searchEquipment(entries, query).map((h) => h.node.id)).toEqual(["c-q1-mlc-bench"]);
    }
  });
  it("MLC is not the PLC: the relay and the Micro820 are separate rows", () => {
    const mlc = entry("c-q1-mlc-bench").node;
    expect(mlc).toMatchObject({ label: "MLC", tag: "Q1", detail: "Schneider TeSys CA3KN22BD control relay", plcSymbol: "_IO_EM_DO_02" });
    expect(mlc.detail).not.toMatch(/micro\s?820|plc/i);
    expect(entry("c-plc1-bench").node).toMatchObject({ label: "PLC1", detail: "Allen-Bradley Micro820" });
    expect(entry("c-plc1-bench").node.plcSymbol).toBeUndefined();
  });
  it("control: a blank query returns nothing, and site/area rows are not results", () => {
    expect(searchEquipment(entries, "   ")).toEqual([]);
    expect(searchEquipment(entries, "garage")).toEqual([]);
  });
});

describe("question target", () => {
  it("a component row targets that component on its machine", () => {
    const target = targetFor(entry("c-q1-mlc-bench"));
    expect(target).toEqual({
      machineId: "m-gs10-bench",
      machineLabel: "GS10 bench",
      componentId: "c-q1-mlc-bench",
      componentLabel: "MLC",
      location: "Lake Wales plant › Garage › Bench line",
    });
    expect(targetText(target!)).toBe("MLC on GS10 bench");
  });
  it("a machine row targets the whole machine", () => {
    const target = targetFor(entry("m-air"));
    expect(target?.componentId).toBeNull();
    expect(targetText(target!)).toBe("Air compressor (whole machine)");
  });
  it("control: site, area and line rows are not askable", () => {
    expect(targetFor(entry("site-lw"))).toBeNull();
    expect(targetFor(entry("area-garage"))).toBeNull();
    expect(targetFor(entry("line-bench"))).toBeNull();
  });
  it("the two VFD1s are different targets", () => {
    expect(sameTarget(targetFor(entry("c-vfd1-bench")), targetFor(entry("c-vfd1-line2")))).toBe(false);
    expect(sameTarget(targetFor(entry("c-vfd1-bench")), targetFor(entry("c-vfd1-bench")))).toBe(true);
  });
});

describe("recent items", () => {
  it("most recent first, de-duplicated, capped", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent(["a", "b", "c", "d", "e"], "f")).toEqual(["f", "a", "b", "c", "d"]);
  });
});
