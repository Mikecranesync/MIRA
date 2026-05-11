import { describe, expect, test } from "bun:test";
import { parseStructuredText } from "../src/parser/st.ts";

describe("parseStructuredText", () => {
  test("parses PROGRAM name", () => {
    const r = parseStructuredText("PROGRAM Prog2\n  x := 1;\nEND_PROGRAM");
    expect(r.programName).toBe("Prog2");
  });

  test("parses a VAR_GLOBAL block", () => {
    const src = `
      VAR_GLOBAL
        motor_running : BOOL := FALSE;
        conv_state : INT := 0;
      END_VAR
    `;
    const r = parseStructuredText(src);
    expect(r.variables).toEqual([
      { name: "motor_running", dataType: "BOOL", scope: "VAR_GLOBAL", initialValue: "FALSE", comment: null },
      { name: "conv_state", dataType: "INT", scope: "VAR_GLOBAL", initialValue: "0", comment: null },
    ]);
  });

  test("strips block and line comments before extracting identifiers", () => {
    const src = `
      PROGRAM Demo
        (* hidden_var should not appear *)
        motor_running := TRUE; // also_hidden
      END_PROGRAM
    `;
    const r = parseStructuredText(src);
    expect(r.referencedIdentifiers).toContain("motor_running");
    expect(r.referencedIdentifiers).not.toContain("hidden_var");
    expect(r.referencedIdentifiers).not.toContain("also_hidden");
  });

  test("excludes ST keywords from referenced identifiers", () => {
    const src = `
      IF motor_running AND NOT fault_alarm THEN
        conv_state := 2;
      END_IF
    `;
    const r = parseStructuredText(src);
    expect(r.referencedIdentifiers).toContain("motor_running");
    expect(r.referencedIdentifiers).toContain("fault_alarm");
    expect(r.referencedIdentifiers).toContain("conv_state");
    expect(r.referencedIdentifiers).not.toContain("IF");
    expect(r.referencedIdentifiers).not.toContain("AND");
    expect(r.referencedIdentifiers).not.toContain("NOT");
    expect(r.referencedIdentifiers).not.toContain("THEN");
  });
});
