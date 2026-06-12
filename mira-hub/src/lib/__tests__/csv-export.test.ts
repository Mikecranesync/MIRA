import { describe, it, expect } from "vitest";
import { csvEscape, neutralizeFormula, toCsv } from "../csv-export";

describe("neutralizeFormula — CSV/spreadsheet formula injection", () => {
  it("prefixes a single quote on every dangerous lead char", () => {
    for (const lead of ["=", "+", "@", "\t", "\r"]) {
      expect(neutralizeFormula(`${lead}SUM(A1)`)).toBe(`'${lead}SUM(A1)`);
    }
  });

  it("neutralises the QA repro payloads", () => {
    expect(neutralizeFormula('=HYPERLINK("http://evil.example","asset")')).toBe(
      `'=HYPERLINK("http://evil.example","asset")`,
    );
    expect(neutralizeFormula("=2+5")).toBe("'=2+5");
    expect(neutralizeFormula('=cmd|"/C calc"!A0')).toBe(`'=cmd|"/C calc"!A0`);
  });

  it("neutralises a '-'/'+' lead that is NOT a plain number (formula-looking)", () => {
    expect(neutralizeFormula("-2+3")).toBe("'-2+3");
    expect(neutralizeFormula("+SUM(1)")).toBe("'+SUM(1)");
    expect(neutralizeFormula("-1+1+cmd")).toBe("'-1+1+cmd");
  });

  it("preserves legitimate signed numbers (a value, not a formula)", () => {
    for (const n of ["-5", "+12", "-3.14", "-5e2", "+0", "-0.0"]) {
      expect(neutralizeFormula(n)).toBe(n);
    }
  });

  it("leaves ordinary text and empty strings untouched", () => {
    for (const s of ["", "Pump 17", "PowerFlex 525", "medium", "Bay-3 East"]) {
      expect(neutralizeFormula(s)).toBe(s);
    }
  });
});

describe("csvEscape — neutralise then RFC 4180 quote", () => {
  it("neutralises a formula, then quotes it when it also has CSV specials", () => {
    // Has commas/quotes → must be quoted AND the leading '=' neutralised.
    expect(csvEscape('=HYPERLINK("http://evil.example","asset")')).toBe(
      `"'=HYPERLINK(""http://evil.example"",""asset"")"`,
    );
  });

  it("neutralises a bare formula with no CSV specials (no quoting needed)", () => {
    expect(csvEscape("=2+5")).toBe("'=2+5");
    expect(csvEscape("@foo")).toBe("'@foo");
  });

  it("still quotes ordinary values containing commas / quotes / newlines", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("a CR/TAB-led cell is neutralised AND quoted (CR forces quoting)", () => {
    expect(csvEscape("\r=2+5")).toBe(`"'\r=2+5"`);
    expect(csvEscape("\t=2+5")).toBe("'\t=2+5"); // TAB alone is not an RFC4180 special
  });

  it("preserves signed numbers and normal strings unquoted", () => {
    expect(csvEscape("-5")).toBe("-5");
    expect(csvEscape("+12")).toBe("+12");
    expect(csvEscape("Pump 17")).toBe("Pump 17");
  });

  it("handles null and array cells", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
    expect(csvEscape(["a", "b"])).toBe("a; b");
    // An array whose joined value leads with a formula char is still neutralised.
    expect(csvEscape(["=2+5", "b"])).toBe("'=2+5; b");
  });
});

describe("toCsv — full row integration", () => {
  it("emits a header row and neutralises hostile cells in the body", () => {
    const out = toCsv([
      { tag: "FORMULA_001", name: '=HYPERLINK("http://evil.example","asset")', model: "=2+5" },
    ]);
    const [header, body] = out.split("\n");
    expect(header).toBe("tag,name,model");
    // The injected formulas must NOT begin a cell with '=' anymore.
    expect(body).toBe(`FORMULA_001,"'=HYPERLINK(""http://evil.example"",""asset"")",'=2+5`);
    expect(body).not.toMatch(/,=/); // no cell starts a value with a bare '='
  });

  it("returns empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });
});
