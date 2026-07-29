import { describe, expect, it } from "vitest";
import {
  toVQT,
  toCurrentValueResult,
  toHistoricalValueResult,
  type MiraReading,
} from "@/lib/i3x/value";

const base: MiraReading = {
  value: "1",
  valueType: "float",
  quality: "good",
  freshness: "live",
  timestamp: "2026-06-14T12:00:00.000Z",
};

describe("toVQT", () => {
  it("builds a VQT with i3X quality and RFC 3339 UTC timestamp", () => {
    const vqt = toVQT(base);
    expect(vqt.quality).toBe("Good");
    expect(vqt.timestamp).toBe("2026-06-14T12:00:00.000Z");
  });

  it("coerces float value type to a number", () => {
    expect(toVQT({ ...base, value: "8.3", valueType: "float" }).value).toBe(8.3);
  });

  it("coerces int value type to an integer number", () => {
    expect(toVQT({ ...base, value: "42", valueType: "int" }).value).toBe(42);
  });

  it("coerces bool value type to a boolean", () => {
    expect(toVQT({ ...base, value: "true", valueType: "bool" }).value).toBe(true);
    expect(toVQT({ ...base, value: "false", valueType: "bool" }).value).toBe(false);
  });

  it("leaves string/enum values as strings", () => {
    expect(toVQT({ ...base, value: "running", valueType: "enum" }).value).toBe("running");
  });

  it("normalizes a Date timestamp to an ISO UTC string", () => {
    const vqt = toVQT({ ...base, timestamp: new Date("2026-06-14T12:00:00Z") });
    expect(vqt.timestamp).toBe("2026-06-14T12:00:00.000Z");
  });

  it("emits GoodNoData when value is null/absent", () => {
    const vqt = toVQT({ ...base, value: null });
    expect(vqt.quality).toBe("GoodNoData");
    expect(vqt.value).toBeNull();
  });

  it("preserves a numeric zero (does not treat 0 as absent)", () => {
    const vqt = toVQT({ ...base, value: "0", valueType: "int" });
    expect(vqt.value).toBe(0);
    expect(vqt.quality).toBe("Good");
  });
});

describe("toCurrentValueResult", () => {
  it("wraps a reading as a non-composition current value", () => {
    const cv = toCurrentValueResult(base);
    expect(cv.isComposition).toBe(false);
    expect(cv.value).toBe(1);
    expect(cv.quality).toBe("Good");
    expect(cv.timestamp).toBe("2026-06-14T12:00:00.000Z");
  });
});

describe("toHistoricalValueResult", () => {
  it("returns VQT values sorted ascending by timestamp", () => {
    const out = toHistoricalValueResult([
      { ...base, value: "3", timestamp: "2026-06-14T12:02:00.000Z" },
      { ...base, value: "1", timestamp: "2026-06-14T12:00:00.000Z" },
      { ...base, value: "2", timestamp: "2026-06-14T12:01:00.000Z" },
    ]);
    expect(out.isComposition).toBe(false);
    expect(out.values.map((v) => v.value)).toEqual([1, 2, 3]);
  });

  it("returns an empty value array for no readings", () => {
    expect(toHistoricalValueResult([]).values).toEqual([]);
  });
});
