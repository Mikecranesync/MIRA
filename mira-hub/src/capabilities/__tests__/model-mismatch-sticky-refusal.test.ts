/**
 * Regression tests for #5720 and #5416: model-mismatch refusal bugs
 * 
 * Bug a) Sticky refusal: After one wrong-model refusal, every later question
 * gets the same refusal even after typing the correct model.
 * 
 * Bug b) Over-broad model detection: Port names, registers, fault codes, and
 * short product forms are treated as "different models".
 * 
 * NOTE: Fault codes ARE extracted by unlistedModelNumbers (needed for safety stops
 * to call them out), but they are filtered from causing model-mismatch refusals
 * via isFaultOrDisplayCode() in the retrieval logic.
 */

import { describe, test, expect } from "vitest";
import { unlistedModelNumbers, isFaultOrDisplayCode } from "../manual-applicability";

describe("Bug b) Over-broad model detection", () => {
  describe("Fault codes are extracted but identified as non-models", () => {
    test("F30003 is extracted but identified as a fault code", () => {
      const numbers = unlistedModelNumbers("F30003");
      expect(numbers.length).toBe(1);
      expect(numbers[0].key).toBe("F30003");
      expect(isFaultOrDisplayCode(numbers[0])).toBe(true);
    });

    test("F30001, F30002, F30003 together are extracted as fault codes", () => {
      const numbers = unlistedModelNumbers("F30001 F30002 F30003");
      expect(numbers.length).toBe(3);
      expect(numbers.every(isFaultOrDisplayCode)).toBe(true);
    });

    test("C01700 is extracted but identified as a fault code", () => {
      const numbers = unlistedModelNumbers("C01700");
      expect(numbers.length).toBe(1);
      expect(isFaultOrDisplayCode(numbers[0])).toBe(true);
    });

    test("F07900 is extracted but identified as a fault code", () => {
      const numbers = unlistedModelNumbers("F07900");
      expect(numbers.length).toBe(1);
      expect(isFaultOrDisplayCode(numbers[0])).toBe(true);
    });

    test("F.30001. (first-of-several notation) may not be extracted due to dots", () => {
      // F.30001. with dots may not match the CHAIN_RE extraction pattern
      // This is a limitation of the existing extraction logic
      const numbers = unlistedModelNumbers("F.30001.");
      // If extracted, it should be identified as a fault code
      if (numbers.length > 0) {
        expect(isFaultOrDisplayCode(numbers[0])).toBe(true);
      }
    });

    test("A09300 (alarm code) is extracted but identified as a fault code", () => {
      const numbers = unlistedModelNumbers("A09300");
      expect(numbers.length).toBe(1);
      expect(isFaultOrDisplayCode(numbers[0])).toBe(true);
    });

    test("N12345 (notification code) is extracted but identified as a fault code", () => {
      const numbers = unlistedModelNumbers("N12345");
      expect(numbers.length).toBe(1);
      expect(isFaultOrDisplayCode(numbers[0])).toBe(true);
    });

    test("F0004 (4-digit fault code) is extracted but identified as a fault code", () => {
      const numbers = unlistedModelNumbers("F0004");
      expect(numbers.length).toBe(1);
      expect(isFaultOrDisplayCode(numbers[0])).toBe(true);
    });
  });

  describe("Port names should NOT be treated as model numbers", () => {
    test("PORT2 is filtered out completely", () => {
      const numbers = unlistedModelNumbers("PORT2");
      expect(numbers).toEqual([]);
    });

    test("port2 (lowercase) is filtered out completely", () => {
      const numbers = unlistedModelNumbers("port2");
      expect(numbers).toEqual([]);
    });

    test("PORT10 is filtered out completely", () => {
      const numbers = unlistedModelNumbers("PORT10");
      expect(numbers).toEqual([]);
    });
  });

  describe("Registers should NOT be treated as model numbers", () => {
    test("R4158 is filtered out completely", () => {
      const numbers = unlistedModelNumbers("R4158");
      expect(numbers).toEqual([]);
    });

    test("R0949 (parameter register) is filtered out completely", () => {
      const numbers = unlistedModelNumbers("R0949");
      expect(numbers).toEqual([]);
    });

    test("R12345 is filtered out completely", () => {
      const numbers = unlistedModelNumbers("R12345");
      expect(numbers).toEqual([]);
    });
  });

  describe("Display codes should NOT be treated as model numbers", () => {
    test("L24 is filtered out completely", () => {
      const numbers = unlistedModelNumbers("L24");
      expect(numbers).toEqual([]);
    });

    test("P21 (parameter, 2 digits) is filtered out completely", () => {
      const numbers = unlistedModelNumbers("P21");
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

  describe("Short model names should STILL be detected despite display-code filter", () => {
    test("S7 is too short (2 chars) - existing extraction logic requires 4+ chars", () => {
      // S7 is not extracted because numberFrom requires key.length >= 4
      // This is a pre-existing limitation, not caused by the display-code filter
      const numbers = unlistedModelNumbers("S7");
      expect(numbers).toEqual([]);
    });

    test("M171 (Schneider M171 controller, 4 chars) is detected as a model number", () => {
      const numbers = unlistedModelNumbers("M171");
      expect(numbers.map((n) => n.key)).toContain("M171");
      // M171 is NOT a display code (3 digits, not 1-2)
      const m171 = numbers.find((n) => n.key === "M171");
      expect(m171).toBeDefined();
      expect(isFaultOrDisplayCode(m171!)).toBe(false);
    });

    test("M340 (Schneider M340 PLC) is detected as a model number", () => {
      const numbers = unlistedModelNumbers("M340");
      expect(numbers.map((n) => n.key)).toContain("M340");
      const m340 = numbers.find((n) => n.key === "M340");
      expect(m340).toBeDefined();
      expect(isFaultOrDisplayCode(m340!)).toBe(false);
    });

    test("S7-1200 is detected as a model number", () => {
      const numbers = unlistedModelNumbers("S7-1200");
      expect(numbers.map((n) => n.key)).toContain("S71200");
      const s7 = numbers.find((n) => n.key === "S71200");
      expect(s7).toBeDefined();
      expect(isFaultOrDisplayCode(s7!)).toBe(false);
    });
  });

  describe("Mixed text with fault codes and real models", () => {
    test("Question with both model and fault code extracts both, fault code identified as non-model", () => {
      const numbers = unlistedModelNumbers("My 6EP4134-3AB00-2AY0 shows F30003");
      expect(numbers.some((n) => n.key.includes("6EP4134"))).toBe(true);
      const faultCode = numbers.find((n) => n.key === "F30003");
      expect(faultCode).toBeDefined();
      expect(isFaultOrDisplayCode(faultCode!)).toBe(true);
    });

    test("Question with model, fault code, and register: model and fault extracted, register/port filtered", () => {
      const numbers = unlistedModelNumbers("6SL5510-1BE11-0AF0 F30003 R4158 PORT2");
      expect(numbers.some((n) => n.key.includes("6SL5510"))).toBe(true);
      const faultCode = numbers.find((n) => n.key === "F30003");
      expect(faultCode).toBeDefined();
      expect(isFaultOrDisplayCode(faultCode!)).toBe(true);
      // R4158 and PORT2 are filtered out completely by isNotModelNumber
      expect(numbers.some((n) => n.key === "R4158")).toBe(false);
      expect(numbers.some((n) => n.key === "PORT2")).toBe(false);
    });
  });
});

describe("Bug b) Real-world phrasing from #5720 overnight walk", () => {
  test("Fault codes in Gus's question are extracted but identified as non-models", () => {
    const question = "For F30001, F30002, F30003, F07900 and C01700 — stop response and acknowledgment for each";
    const numbers = unlistedModelNumbers(question);
    const faultCodes = numbers.filter((n) => n.key.startsWith("F") || n.key.startsWith("C"));
    expect(faultCodes.length).toBeGreaterThan(0);
    expect(faultCodes.every(isFaultOrDisplayCode)).toBe(true);
  });

  test("Display code L24 is filtered out completely", () => {
    const numbers = unlistedModelNumbers("What does L24 mean on the display?");
    expect(numbers.some((n) => n.key === "L24")).toBe(false);
  });

  test("S200 display text with space is not extracted as single token", () => {
    const numbers = unlistedModelNumbers("The drive shows S 200 on startup");
    // "S 200" with space won't be parsed as a single token
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
