import { describe, test, expect } from "vitest";
import {
  buildExtractorPrompt,
  parseAndValidate,
  EXTRACTOR_ALLOWLIST,
  HIGH_CONFIDENCE_THRESHOLD,
} from "../relationship-extractor";

describe("buildExtractorPrompt", () => {
  test("system prompt declares the predicate allowlist", () => {
    const { system } = buildExtractorPrompt("any text", []);
    for (const p of EXTRACTOR_ALLOWLIST) expect(system).toContain(p);
  });

  test("user prompt includes the entity list and conversation", () => {
    const { user } = buildExtractorPrompt(
      "VFD-07 tripped due to bearing seizure",
      [
        { ref: "VFD-07", type: "equipment" },
        { ref: "F004", type: "fault_code" },
      ],
    );
    expect(user).toContain("VFD-07 (equipment)");
    expect(user).toContain("F004 (fault_code)");
    expect(user).toContain("VFD-07 tripped due to bearing seizure");
  });

  test("user prompt handles empty entity list cleanly", () => {
    const { user } = buildExtractorPrompt("hello world", []);
    expect(user).toContain("(none)");
  });
});

describe("parseAndValidate", () => {
  const known = new Set(["VFD-07", "F004", "BEARING_NDE", "MOTOR_M1"]);

  test("accepts well-formed relationships", () => {
    const json = JSON.stringify({
      relationships: [
        { source: "VFD-07", predicate: "had_fault", target: "F004", confidence: 0.9 },
        { source: "F004", predicate: "caused_by", target: "BEARING_NDE", confidence: 0.7 },
      ],
    });
    const out = parseAndValidate(json, known);
    expect(out).toHaveLength(2);
    expect(out[0]?.predicate).toBe("had_fault");
    expect(out[1]?.predicate).toBe("caused_by");
  });

  test("drops relationships referencing unknown entities (hallucination guard)", () => {
    const json = JSON.stringify({
      relationships: [
        { source: "VFD-07", predicate: "caused_by", target: "GHOST_PUMP", confidence: 0.9 },
        { source: "ALSO_FAKE", predicate: "had_fault", target: "F004", confidence: 0.9 },
      ],
    });
    const out = parseAndValidate(json, known);
    expect(out).toHaveLength(0);
  });

  test("drops predicates not in the extractor allowlist", () => {
    const json = JSON.stringify({
      relationships: [
        { source: "VFD-07", predicate: "parent_of", target: "F004", confidence: 0.9 },
        { source: "VFD-07", predicate: "located_at", target: "F004", confidence: 0.9 },
        { source: "VFD-07", predicate: "fictional_predicate", target: "F004", confidence: 0.9 },
      ],
    });
    const out = parseAndValidate(json, known);
    expect(out).toHaveLength(0);
  });

  test("drops self-loops", () => {
    const json = JSON.stringify({
      relationships: [
        { source: "VFD-07", predicate: "caused_by", target: "VFD-07", confidence: 0.9 },
      ],
    });
    const out = parseAndValidate(json, known);
    expect(out).toHaveLength(0);
  });

  test("clamps confidence to [0, 1]", () => {
    const json = JSON.stringify({
      relationships: [
        { source: "VFD-07", predicate: "had_fault", target: "F004", confidence: 1.5 },
        { source: "F004", predicate: "caused_by", target: "BEARING_NDE", confidence: -0.2 },
      ],
    });
    const out = parseAndValidate(json, known);
    expect(out).toHaveLength(2);
    expect(out[0]?.confidence).toBe(1);
    expect(out[1]?.confidence).toBe(0);
  });

  test("survives malformed JSON", () => {
    expect(parseAndValidate("not json", known)).toEqual([]);
    expect(parseAndValidate("", known)).toEqual([]);
    expect(parseAndValidate('{"foo":"bar"}', known)).toEqual([]);
    expect(parseAndValidate('{"relationships":"not an array"}', known)).toEqual([]);
  });

  test("survives missing fields", () => {
    const json = JSON.stringify({
      relationships: [
        { predicate: "had_fault", target: "F004" },                  // missing source
        { source: "VFD-07", target: "F004" },                          // missing predicate
        { source: "VFD-07", predicate: "had_fault" },                  // missing target
      ],
    });
    expect(parseAndValidate(json, known)).toHaveLength(0);
  });

  test("defaults confidence to 0.5 when missing", () => {
    const json = JSON.stringify({
      relationships: [
        { source: "VFD-07", predicate: "had_fault", target: "F004" },
      ],
    });
    const out = parseAndValidate(json, known);
    expect(out[0]?.confidence).toBe(0.5);
  });
});

describe("HIGH_CONFIDENCE_THRESHOLD", () => {
  test("matches the spec-locked decision (0.6)", () => {
    expect(HIGH_CONFIDENCE_THRESHOLD).toBe(0.6);
  });
});
