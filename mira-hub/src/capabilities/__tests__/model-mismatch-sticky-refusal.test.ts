/**
 * Regression tests for #5720 and #5416: model-mismatch refusal bugs
 * 
 * Bug a) Sticky refusal: After one wrong-model refusal, every later question
 * gets the same refusal even after typing the correct model.
 * 
 * Bug b) Over-broad model detection: Port names, registers, fault codes, and
 * short product forms are treated as "different models".
 */

import { describe, test, expect } from "vitest";
import { unlistedModelNumbers } from "../manual-applicability";

describe("Bug b) Over-broad model detection", () => {
  describe("Fault codes should NOT be treated as model numbers", () => {
    test("F30003 is not a model number", () => {
      const numbers = unlistedModelNumbers("F30003");
      expect(numbers).toEqual([]);
    });

    test("F30001, F30002, F30003 together are not model numbers", () => {
      const numbers = unlistedModelNumbers("F30001 F30002 F30003");
      expect(numbers).toEqual([]);
    });

    test("C01700 is not a model number", () => {
      const numbers = unlistedModelNumbers("C01700");
      expect(numbers).toEqual([]);
    });

    test("F07900 is not a model number", () => {
      const numbers = unlistedModelNumbers("F07900");
      expect(numbers).toEqual([]);
    });

    test("F.30001. (first-of-several notation) is not a model number", () => {
      const numbers = unlistedModelNumbers("F.30001.");
      expect(numbers).toEqual([]);
    });

    test("A09300 (alarm code) is not a model number", () => {
      const numbers = unlistedModelNumbers("A09300");
      expect(numbers).toEqual([]);
    });

    test("N12345 (notification code) is not a model number", () => {
      const numbers = unlistedModelNumbers("N12345");
      expect(numbers).toEqual([]);
    });
  });

  describe("Port names should NOT be treated as model numbers", () => {
    test("PORT2 is not a model number", () => {
      const numbers = unlistedModelNumbers("PORT2");
      expect(numbers).toEqual([]);
    });

    test("port2 (lowercase) is not a model number", () => {
      const numbers = unlistedModelNumbers("port2");
      expect(numbers).toEqual([]);
    });

    test("PORT10 is not a model number", () => {
      const numbers = unlistedModelNumbers("PORT10");
      expect(numbers).toEqual([]);
    });
  });

  describe("Registers should NOT be treated as model numbers", () => {
    test("R4158 is not a model number", () => {
      const numbers = unlistedModelNumbers("R4158");
      expect(numbers).toEqual([]);
    });

    test("R0949 (parameter register) is not a model number", () => {
      const numbers = unlistedModelNumbers("R0949");
      expect(numbers).toEqual([]);
    });

    test("R12345 is not a model number", () => {
      const numbers = unlistedModelNumbers("R12345");
      expect(numbers).toEqual([]);
    });
  });

  describe("Display codes should NOT be treated as model numbers", () => {
    test("L24 is not a model number", () => {
      const numbers = unlistedModelNumbers("L24");
      expect(numbers).toEqual([]);
    });

    test("S200 (display text) is not a model number", () => {
      const numbers = unlistedModelNumbers("S200");
      expect(numbers).toEqual([]);
    });

    test("P210 (parameter) is not a model number", () => {
      const numbers = unlistedModelNumbers("P210");
      expect(numbers).toEqual([]);
    });
  });

  describe("Real model numbers should STILL be detected", () => {
    test("lxm32 is detected as a model number", () => {
      const numbers = unlistedModelNumbers("lxm32");
      expect(numbers.map((n) => n.key)).toContain("LXM32");
    });

    test("LXM32A is detected as a model number", () => {
      const numbers = unlistedModelNumbers("LXM32A");
      expect(numbers.map((n) => n.key)).toContain("LXM32A");
    });

    test("6EP4134-3AB00-2AY0 (spaced) is detected as a model number", () => {
      const numbers = unlistedModelNumbers("6EP4134 - 3AB00 -2AY0");
      expect(numbers.length).toBeGreaterThan(0);
      expect(numbers.some((n) => n.key.includes("6EP4134"))).toBe(true);
    });

    test("6SL5510-1BE11-0AF0 is detected as a model number", () => {
      const numbers = unlistedModelNumbers("6SL5510-1BE11-0AF0");
      expect(numbers.length).toBeGreaterThan(0);
      expect(numbers.some((n) => n.key.includes("6SL5510"))).toBe(true);
    });
  });

  describe("Mixed text with fault codes and real models", () => {
    test("Question with both model and fault code extracts only the model", () => {
      const numbers = unlistedModelNumbers("My 6EP4134-3AB00-2AY0 shows F30003");
      expect(numbers.some((n) => n.key.includes("6EP4134"))).toBe(true);
      expect(numbers.some((n) => n.key === "F30003")).toBe(false);
    });

    test("Question with model, fault code, and register extracts only the model", () => {
      const numbers = unlistedModelNumbers("6SL5510-1BE11-0AF0 F30003 R4158 PORT2");
      expect(numbers.some((n) => n.key.includes("6SL5510"))).toBe(true);
      expect(numbers.some((n) => n.key === "F30003")).toBe(false);
      expect(numbers.some((n) => n.key === "R4158")).toBe(false);
      expect(numbers.some((n) => n.key === "PORT2")).toBe(false);
    });
  });
});

describe("Bug b) Real-world phrasing from #5720 overnight walk", () => {
  test("Fault codes in Gus's question are not treated as models", () => {
    const question = "For F30001, F30002, F30003, F07900 and C01700 — stop response and acknowledgment for each";
    const numbers = unlistedModelNumbers(question);
    expect(numbers.some((n) => n.key.startsWith("F"))).toBe(false);
    expect(numbers.some((n) => n.key.startsWith("C"))).toBe(false);
  });

  test("Display code L24 is not treated as a model", () => {
    const numbers = unlistedModelNumbers("What does L24 mean on the display?");
    expect(numbers.some((n) => n.key === "L24")).toBe(false);
  });

  test("S200 display text is not treated as a model", () => {
    const numbers = unlistedModelNumbers("The drive shows S 200 on startup");
    expect(numbers.some((n) => n.key === "S200")).toBe(false);
  });
});

describe("Bug b) Real-world phrasing from #5416 spaced part numbers", () => {
  test("Spaced SITOP number with real model extracted correctly", () => {
    const question = "6EP4134 - 3AB00 -2AY0    buffer time max   how long it actually run";
    const numbers = unlistedModelNumbers(question);
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.some((n) => n.key.includes("6EP4134"))).toBe(true);
  });

  test("Later question about voltage doesn't inherit the spaced number", () => {
    // This tests that the fix for bug a) works: a later question that doesn't
    // mention the model shouldn't inherit the refusal from the spaced number
    const numbers = unlistedModelNumbers("what voltage is the switch in threshold set to from the factory");
    expect(numbers.length).toBe(0);
  });
});
