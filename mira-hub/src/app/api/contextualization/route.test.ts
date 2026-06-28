import { describe, expect, it } from "vitest";
import { parseCreateBody } from "./route";

describe("parseCreateBody", () => {
  it("rejects missing name", () => {
    expect(parseCreateBody({})).toEqual({ error: "name is required" });
    expect(parseCreateBody({ name: "" })).toEqual({ error: "name is required" });
    expect(parseCreateBody({ name: "   " })).toEqual({ error: "name is required" });
    expect(parseCreateBody({ name: 42 })).toEqual({ error: "name is required" });
  });

  it("trims and accepts a valid name", () => {
    expect(parseCreateBody({ name: "  Conveyor L5X  " })).toEqual({
      name: "Conveyor L5X",
      description: null,
    });
  });

  it("passes a description string through trimmed", () => {
    expect(parseCreateBody({ name: "Test", description: "  My desc  " })).toEqual({
      name: "Test",
      description: "My desc",
    });
  });

  it("normalizes empty-string description to null", () => {
    expect(parseCreateBody({ name: "Test", description: "  " })).toEqual({
      name: "Test",
      description: null,
    });
    expect(parseCreateBody({ name: "Test", description: "" })).toEqual({
      name: "Test",
      description: null,
    });
  });

  it("ignores non-string description types", () => {
    expect(parseCreateBody({ name: "Test", description: 99 })).toEqual({
      name: "Test",
      description: null,
    });
  });
});
