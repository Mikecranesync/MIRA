/**
 * Unit tests for the tag-import wizard pure helpers.
 *
 * Run: cd mira-hub && npx vitest run src/lib/__tests__/tag-import.test.ts
 *
 * No DB or network — pure logic only.
 */
import { describe, it, expect } from "vitest";
import {
  parseCsvLine,
  parseTagCsv,
  buildTagSuggestions,
  inferUnsPath,
  MAX_IMPORT_ROWS,
} from "../tag-import";

// ---------------------------------------------------------------------------
// parseCsvLine
// ---------------------------------------------------------------------------
describe("parseCsvLine", () => {
  it("splits a simple line", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields containing commas", () => {
    expect(parseCsvLine('"a,b",c')).toEqual(["a,b", "c"]);
  });

  it("handles doubled double-quotes inside quoted field", () => {
    expect(parseCsvLine('"say ""hello""",world')).toEqual(['say "hello"', "world"]);
  });

  it("handles empty fields", () => {
    expect(parseCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("handles trailing comma", () => {
    expect(parseCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });
});

// ---------------------------------------------------------------------------
// inferUnsPath
// ---------------------------------------------------------------------------
describe("inferUnsPath", () => {
  it("builds a path under a known site root", () => {
    const result = inferUnsPath("Line5/B16/PE2_Occupied", "enterprise.orlando_plant");
    expect(result).toBe("enterprise.orlando_plant.line5_b16_pe2_occupied");
  });

  it("uses dot separator too", () => {
    const result = inferUnsPath("Line5.Conveyor_B16.Motor_Current", "enterprise.plant");
    expect(result).toBe("enterprise.plant.line5_conveyor_b16_motor_current");
  });

  it("returns just the leaf when site path is null", () => {
    const result = inferUnsPath("Line5/Motor", null);
    // tokens = ["line5", "motor"], joined as UNS dot-notation
    expect(result).toBe("line5.motor");
  });

  it("returns null for a tag that slugifies to nothing", () => {
    const result = inferUnsPath("!!!/???", null);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseTagCsv
// ---------------------------------------------------------------------------
describe("parseTagCsv", () => {
  const THREE_ROW_CSV = [
    "tag_path,description,data_type,units,suggested_uns",
    "Line5/B16/PE2,Photo eye 2,BOOL,,enterprise.plant.line5.b16.pe2",
    "Line5/B16/Speed,Motor speed,REAL,rpm,",
    "Line5/B16/Fault,Fault code,INT,,",
  ].join("\n");

  it("returns 3 rows for a 3-row CSV", () => {
    const { rows, skipped } = parseTagCsv(THREE_ROW_CSV);
    expect(rows).toHaveLength(3);
    expect(skipped).toHaveLength(0);
  });

  it("honours explicit suggested_uns on the first row", () => {
    const { rows } = parseTagCsv(THREE_ROW_CSV);
    expect(rows[0].suggested_uns).toBe("enterprise.plant.line5.b16.pe2");
  });

  it("treats empty suggested_uns as null", () => {
    const { rows } = parseTagCsv(THREE_ROW_CSV);
    expect(rows[1].suggested_uns).toBeNull();
    expect(rows[2].suggested_uns).toBeNull();
  });

  it("normalises data_type INT → INT32", () => {
    const { rows } = parseTagCsv(THREE_ROW_CSV);
    expect(rows[2].data_type).toBe("INT32");
  });

  it("normalises data_type REAL stays REAL", () => {
    const { rows } = parseTagCsv(THREE_ROW_CSV);
    expect(rows[1].data_type).toBe("REAL");
  });

  it("skips rows with missing tag_path but keeps others", () => {
    const csv = [
      "tag_path,description",
      ",Missing path",
      "Line5/B16/Good,OK",
    ].join("\n");
    const { rows, skipped } = parseTagCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].tag_path).toBe("Line5/B16/Good");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe("missing_tag_path");
  });

  it("does not crash on a row with extra empty trailing columns", () => {
    const csv = [
      "tag_path,description,data_type",
      "Line5/Motor,Motor,,,,",
    ].join("\n");
    const { rows } = parseTagCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].tag_path).toBe("Line5/Motor");
  });

  it("skips rows beyond MAX_IMPORT_ROWS with reason 'row_cap_exceeded'", () => {
    // Build a CSV with MAX_IMPORT_ROWS + 2 data rows
    const header = "tag_path";
    const dataRows = Array.from(
      { length: MAX_IMPORT_ROWS + 2 },
      (_, i) => `Tag${i}`,
    );
    const csv = [header, ...dataRows].join("\n");
    const { rows, skipped } = parseTagCsv(csv);
    expect(rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(skipped.filter((s) => s.reason === "row_cap_exceeded")).toHaveLength(2);
  });

  it("returns error in skipped when required header tag_path is missing", () => {
    const csv = "description,data_type\nMotor desc,BOOL";
    const { rows, skipped } = parseTagCsv(csv);
    expect(rows).toHaveLength(0);
    expect(skipped[0].reason).toBe("missing_required_header:tag_path");
  });

  it("records invalid_suggested_uns_ignored but still imports the row", () => {
    const csv = [
      "tag_path,suggested_uns",
      "Line5/Tag1,NOT A VALID PATH!!!",
    ].join("\n");
    const { rows, skipped } = parseTagCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].suggested_uns).toBeNull();  // stripped
    expect(skipped.some((s) => s.reason === "invalid_suggested_uns_ignored")).toBe(true);
  });

  it("skips blank lines without adding to skipped list", () => {
    const csv = "tag_path\nTag1\n\n\nTag2\n";
    const { rows } = parseTagCsv(csv);
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// buildTagSuggestions
// ---------------------------------------------------------------------------
describe("buildTagSuggestions", () => {
  const TENANT_ID = "00000000-0000-0000-0000-000000000001";

  const threeRows = [
    { tag_path: "Line5/B16/PE2", description: "Photo eye", data_type: "BOOL",
      units: null, suggested_uns: "enterprise.plant.line5.b16.pe2", source_address: null },
    { tag_path: "Line5/B16/Speed", description: null, data_type: "REAL",
      units: "rpm", suggested_uns: null, source_address: "HR:101" },
    { tag_path: "!!!invalid slug only", description: null, data_type: "STRING",
      units: null, suggested_uns: null, source_address: null },
  ];

  it("produces one suggestion per row", () => {
    const suggestions = buildTagSuggestions(threeRows, TENANT_ID, "enterprise.plant");
    expect(suggestions).toHaveLength(3);
  });

  it("always sets tenant_id from the passed tenantId arg, not from rows", () => {
    const suggestions = buildTagSuggestions(threeRows, TENANT_ID, null);
    for (const s of suggestions) {
      expect(s.tenant_id).toBe(TENANT_ID);
    }
  });

  it("uses explicit suggested_uns with high confidence (0.8)", () => {
    const suggestions = buildTagSuggestions(threeRows, TENANT_ID, null);
    const s = suggestions[0];
    expect(s.extracted_data.candidate_uns_path).toBe("enterprise.plant.line5.b16.pe2");
    expect(s.extracted_data.uns_path_source).toBe("explicit");
    expect(s.confidence).toBeCloseTo(0.8);
  });

  it("uses heuristic path with low confidence (0.35) when no suggested_uns", () => {
    const suggestions = buildTagSuggestions(threeRows, TENANT_ID, "enterprise.plant");
    const s = suggestions[1];
    expect(s.extracted_data.uns_path_source).toBe("heuristic");
    expect(s.confidence).toBeCloseTo(0.35);
    expect(s.extracted_data.candidate_uns_path).not.toBeNull();
  });

  it("assigns confidence 0.1 and source 'none' when path cannot be inferred", () => {
    // Row 3 has a tag_path that slugifies to something (not truly nothing),
    // but test with a dedicated all-non-alnum path to hit the 'none' branch
    const noPathRows = [
      { tag_path: "!!!", description: null, data_type: "BOOL",
        units: null, suggested_uns: null, source_address: null },
    ];
    const suggestions = buildTagSuggestions(noPathRows, TENANT_ID, null);
    expect(suggestions[0].extracted_data.uns_path_source).toBe("none");
    expect(suggestions[0].confidence).toBeCloseTo(0.1);
  });

  it("status is always 'pending' (not 'proposed')", () => {
    const suggestions = buildTagSuggestions(threeRows, TENANT_ID, null);
    for (const s of suggestions) {
      expect(s.status).toBe("pending");
    }
  });

  it("suggestion_type is always 'tag_mapping'", () => {
    const suggestions = buildTagSuggestions(threeRows, TENANT_ID, null);
    for (const s of suggestions) {
      expect(s.suggestion_type).toBe("tag_mapping");
    }
  });

  it("proposed_by is 'import:ignition_csv'", () => {
    const suggestions = buildTagSuggestions(threeRows, TENANT_ID, null);
    for (const s of suggestions) {
      expect(s.proposed_by).toBe("import:ignition_csv");
    }
  });

  it("extracted_data carries tag_path, data_type, source_address", () => {
    const suggestions = buildTagSuggestions(threeRows, TENANT_ID, null);
    const s = suggestions[1];
    expect(s.extracted_data.tag_path).toBe("Line5/B16/Speed");
    expect(s.extracted_data.data_type).toBe("REAL");
    expect(s.extracted_data.source_address).toBe("HR:101");
  });
});
