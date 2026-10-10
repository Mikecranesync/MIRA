/** #4343: unknown generation usage must not become a free completion. */
import { describe, expect, it } from "vitest";
import { estimateCostUsd, usageFromRaw } from "@/lib/inference/canonical-cascade";

describe("canonical inference cost accounting", () => {
  it("#4343 keeps absent or partial usage unpriced rather than free", () => {
    expect(estimateCostUsd("Groq", null, null, null)).toBeNull();
    expect(estimateCostUsd("Groq", 100, 0, null)).toBeNull();
    expect(estimateCostUsd("Groq", null, 0, 100)).toBeNull();
    expect(usageFromRaw("Cerebras", "m", undefined, "primary", []).costUsdEstimate).toBeNull();
  });

  it("#4343 rejects malformed token counts instead of understating cost", () => {
    for (const bad of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(estimateCostUsd("Groq", bad, 0, 10)).toBeNull();
      expect(estimateCostUsd("Groq", 10, 0, bad)).toBeNull();
      expect(estimateCostUsd("Groq", 10, bad, 10)).toBeNull();
    }
    expect(estimateCostUsd("Groq", 10, 11, 10)).toBeNull();
  });

  it("#4343 distinguishes known zero usage from unknown usage", () => {
    expect(estimateCostUsd("Groq", 0, null, 0)).toBe(0);
  });

});
