import { describe, expect, it } from "vitest";
import { clampLimit, clampOffset, readTotal, hasMorePage } from "./route";

// #1892: paging math for /api/proposals. The route returns a real COUNT(*) OVER()
// total (not the page size) + offset paging so large queues aren't truncated.

describe("clampLimit", () => {
  it("defaults to 100 when missing or invalid", () => {
    expect(clampLimit(null)).toBe(100);
    expect(clampLimit("abc")).toBe(100);
    expect(clampLimit("0")).toBe(100);
    expect(clampLimit("-5")).toBe(100);
  });
  it("honors a valid limit and caps at 500", () => {
    expect(clampLimit("50")).toBe(50);
    expect(clampLimit("500")).toBe(500);
    expect(clampLimit("5000")).toBe(500);
    expect(clampLimit("100.9")).toBe(100);
  });
});

describe("clampOffset", () => {
  it("defaults to 0 when missing or invalid/negative", () => {
    expect(clampOffset(null)).toBe(0);
    expect(clampOffset("abc")).toBe(0);
    expect(clampOffset("-3")).toBe(0);
  });
  it("floors a valid offset", () => {
    expect(clampOffset("100")).toBe(100);
    expect(clampOffset("250.7")).toBe(250);
  });
});

describe("readTotal", () => {
  it("reads COUNT(*) OVER() off the first row", () => {
    expect(readTotal([{ total_count: 4213 }, { total_count: 4213 }])).toBe(4213);
  });
  it("returns 0 for an empty page (no matches)", () => {
    expect(readTotal([])).toBe(0);
  });
  it("coerces and tolerates a missing/garbage total_count", () => {
    expect(readTotal([{}])).toBe(0);
    expect(readTotal([{ total_count: NaN }])).toBe(0);
  });
});

describe("hasMorePage", () => {
  it("true when more rows remain beyond the current page", () => {
    expect(hasMorePage(0, 100, 4213)).toBe(true);
    expect(hasMorePage(100, 100, 4213)).toBe(true);
  });
  it("false on the last page or when fully loaded", () => {
    expect(hasMorePage(0, 50, 50)).toBe(false);
    expect(hasMorePage(4200, 13, 4213)).toBe(false);
    expect(hasMorePage(0, 0, 0)).toBe(false);
  });
});
