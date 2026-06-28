import { describe, expect, it } from "vitest";
import { sourceTypeFor } from "./route";

describe("sourceTypeFor", () => {
  it("maps PLC export extensions to their ctx_sources source_type", () => {
    expect(sourceTypeFor("Conveyor.L5X")).toBe("l5x");
    expect(sourceTypeFor("routine.st")).toBe("st");
    expect(sourceTypeFor("project.xml")).toBe("plcopen");
    expect(sourceTypeFor("tags.csv")).toBe("csv");
  });

  it("maps document extensions to 'manual'", () => {
    expect(sourceTypeFor("gs10-manual.pdf")).toBe("manual");
    expect(sourceTypeFor("notes.txt")).toBe("manual");
    expect(sourceTypeFor("README.md")).toBe("manual");
  });

  it("is case-insensitive on the extension", () => {
    expect(sourceTypeFor("PROGRAM.ST")).toBe("st");
    expect(sourceTypeFor("Tags.Csv")).toBe("csv");
  });

  it("falls back to 'other' for unknown or missing extensions", () => {
    expect(sourceTypeFor("mystery.bin")).toBe("other");
    expect(sourceTypeFor("noextension")).toBe("other");
  });
});
