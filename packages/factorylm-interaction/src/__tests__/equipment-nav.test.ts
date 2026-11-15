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
    expect(entries.map((e) => e.node.id).slice(0, 7)).toEqual([
      "site-lw", "area-garage", "line-bench", "m-gs10-bench", "asm-panel", "c-vfd1-bench", "c-plc1-bench",
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
  it("control: a blank query returns nothing, and site/area rows are not results", () => {
    expect(searchEquipment(entries, "   ")).toEqual([]);
    expect(searchEquipment(entries, "garage")).toEqual([]);
  });
});

describe("question target", () => {
  it("a component row targets that component on its machine", () => {
    const target = targetFor(entry("c-plc1-bench"));
    expect(target).toEqual({
      machineId: "m-gs10-bench",
      machineLabel: "GS10 bench",
      componentId: "c-plc1-bench",
      componentLabel: "PLC1",
      location: "Lake Wales plant › Garage › Bench line",
    });
    expect(targetText(target!)).toBe("PLC1 on GS10 bench");
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
