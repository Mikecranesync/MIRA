import { describe, test, expect } from "vitest";
import {
  slugify,
  sitePath,
  linePath,
  equipmentPath,
  manufacturerPath,
  modelPath,
} from "../uns";

describe("uns.slugify", () => {
  test("lowercases", () => {
    expect(slugify("Plant 1")).toBe("plant_1");
  });

  test("collapses non-alphanumeric runs to single underscore", () => {
    expect(slugify("Site A — Bay 3")).toBe("site_a_bay_3");
  });

  test("strips leading/trailing underscore", () => {
    expect(slugify("__hello world__")).toBe("hello_world");
  });

  test("caps at 64 chars", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBe(64);
  });

  test("falls back to underscore for empty input", () => {
    expect(slugify("")).toBe("_");
    expect(slugify("!@#$%")).toBe("_");
  });

  test("matches SQL uns_slug semantics for typical CMMS strings", () => {
    expect(slugify("Ingersoll Rand")).toBe("ingersoll_rand");
    expect(slugify("PowerFlex 525")).toBe("powerflex_525");
    expect(slugify("Air Compressor #1")).toBe("air_compressor_1");
  });
});

describe("uns path builders", () => {
  test("sitePath", () => {
    expect(sitePath("Lake Wales Plant")).toBe("enterprise.lake_wales_plant");
  });

  test("linePath under site", () => {
    expect(linePath("Lake Wales Plant", "Line 3")).toBe(
      "enterprise.lake_wales_plant.line_3",
    );
  });

  test("manufacturerPath under knowledge_base", () => {
    expect(manufacturerPath("Rockwell Automation")).toBe(
      "enterprise.knowledge_base.rockwell_automation",
    );
  });

  test("modelPath under manufacturer", () => {
    expect(modelPath("Rockwell Automation", "PowerFlex 525")).toBe(
      "enterprise.knowledge_base.rockwell_automation.powerflex_525",
    );
  });
});

describe("equipmentPath", () => {
  test("appends slug under parent line", () => {
    expect(equipmentPath("enterprise.plant_a.line_1", "Compressor-7")).toBe(
      "enterprise.plant_a.line_1.compressor_7",
    );
  });

  test("returns null with no parent path", () => {
    expect(equipmentPath(null, "Compressor-7")).toBeNull();
  });

  test("returns null with no equipment identifier", () => {
    expect(equipmentPath("enterprise.plant_a.line_1", null)).toBeNull();
    expect(equipmentPath("enterprise.plant_a.line_1", "")).toBeNull();
  });

  test("rejects identifier that slugifies to bare underscore", () => {
    expect(equipmentPath("enterprise.plant_a.line_1", "!!!")).toBeNull();
  });
});
