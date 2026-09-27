import { describe, expect, it } from "vitest";
import { formatRecordedFixes, validateFixInput, type FixRecord } from "@/capabilities/fix-records";

function fix(overrides: Partial<FixRecord> = {}): FixRecord {
  return {
    id: "f1",
    notebookId: "nb1",
    equipmentEntityId: null,
    symptom: "Conveyor stalls under load",
    faultCode: null,
    fix: "Replaced worn drive belt",
    recordedBy: "u_1",
    createdAt: "2026-09-20T14:03:00.000Z",
    ...overrides,
  };
}

describe("validateFixInput", () => {
  it("accepts a minimal valid body", () => {
    const res = validateFixInput({ symptom: "Won't start", fix: "Reset E-stop" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual({
        symptom: "Won't start",
        fix: "Reset E-stop",
        faultCode: null,
        sourceTurnId: null,
      });
    }
  });

  it("trims symptom, fix, and faultCode", () => {
    const res = validateFixInput({ symptom: "  loud noise  ", fix: "  tightened bolts  ", faultCode: "  F0004  " });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.symptom).toBe("loud noise");
      expect(res.value.fix).toBe("tightened bolts");
      expect(res.value.faultCode).toBe("F0004");
    }
  });

  it("rejects a non-object body", () => {
    expect(validateFixInput(null)).toEqual({ ok: false, error: "invalid_body" });
    expect(validateFixInput("nope")).toEqual({ ok: false, error: "invalid_body" });
    expect(validateFixInput(42)).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a missing or empty symptom", () => {
    expect(validateFixInput({ fix: "did a thing" })).toEqual({ ok: false, error: "symptom_required" });
    expect(validateFixInput({ symptom: "   ", fix: "did a thing" })).toEqual({ ok: false, error: "symptom_required" });
    expect(validateFixInput({ symptom: 42, fix: "did a thing" })).toEqual({ ok: false, error: "symptom_required" });
  });

  it("rejects a symptom over 500 chars", () => {
    const res = validateFixInput({ symptom: "x".repeat(501), fix: "ok" });
    expect(res).toEqual({ ok: false, error: "symptom_too_long" });
  });

  it("accepts a symptom at exactly 500 chars", () => {
    const res = validateFixInput({ symptom: "x".repeat(500), fix: "ok" });
    expect(res.ok).toBe(true);
  });

  it("rejects a missing or empty fix", () => {
    expect(validateFixInput({ symptom: "loud noise" })).toEqual({ ok: false, error: "fix_required" });
    expect(validateFixInput({ symptom: "loud noise", fix: "   " })).toEqual({ ok: false, error: "fix_required" });
    expect(validateFixInput({ symptom: "loud noise", fix: [] })).toEqual({ ok: false, error: "fix_required" });
  });

  it("rejects a fix over 2000 chars", () => {
    const res = validateFixInput({ symptom: "ok", fix: "x".repeat(2001) });
    expect(res).toEqual({ ok: false, error: "fix_too_long" });
  });

  it("accepts a fix at exactly 2000 chars", () => {
    const res = validateFixInput({ symptom: "ok", fix: "x".repeat(2000) });
    expect(res.ok).toBe(true);
  });

  it("allows an absent faultCode (defaults to null)", () => {
    const res = validateFixInput({ symptom: "ok", fix: "ok" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.faultCode).toBeNull();
  });

  it("treats an empty-string faultCode as absent (null)", () => {
    const res = validateFixInput({ symptom: "ok", fix: "ok", faultCode: "   " });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.faultCode).toBeNull();
  });

  it("rejects a non-string faultCode", () => {
    expect(validateFixInput({ symptom: "ok", fix: "ok", faultCode: 4 })).toEqual({
      ok: false,
      error: "invalid_fault_code",
    });
  });

  it("rejects a faultCode over 64 chars", () => {
    const res = validateFixInput({ symptom: "ok", fix: "ok", faultCode: "F".repeat(65) });
    expect(res).toEqual({ ok: false, error: "fault_code_too_long" });
  });

  it("accepts a faultCode at exactly 64 chars", () => {
    const res = validateFixInput({ symptom: "ok", fix: "ok", faultCode: "F".repeat(64) });
    expect(res.ok).toBe(true);
  });

  it("allows an absent sourceTurnId (defaults to null)", () => {
    const res = validateFixInput({ symptom: "ok", fix: "ok" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.sourceTurnId).toBeNull();
  });

  it("accepts a valid UUID sourceTurnId", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const res = validateFixInput({ symptom: "ok", fix: "ok", sourceTurnId: id });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.sourceTurnId).toBe(id);
  });

  it("rejects a non-UUID sourceTurnId", () => {
    expect(validateFixInput({ symptom: "ok", fix: "ok", sourceTurnId: "not-a-uuid" })).toEqual({
      ok: false,
      error: "invalid_source_turn_id",
    });
    expect(validateFixInput({ symptom: "ok", fix: "ok", sourceTurnId: 123 })).toEqual({
      ok: false,
      error: "invalid_source_turn_id",
    });
  });
});

describe("formatRecordedFixes", () => {
  it("returns '' for an empty list", () => {
    expect(formatRecordedFixes([])).toBe("");
  });

  it("renders one record with the expected shape", () => {
    const out = formatRecordedFixes([fix()]);
    expect(out).toBe(
      'RECORDED FIXES ON THIS MACHINE (technician-confirmed; cite as "Recorded fix"):\n' +
        "- 2026-09-20 — symptom: Conveyor stalls under load → fix: Replaced worn drive belt",
    );
  });

  it("includes the fault code when present", () => {
    const out = formatRecordedFixes([fix({ faultCode: "F0004" })]);
    expect(out).toContain("symptom: Conveyor stalls under load; fault F0004 → fix:");
  });

  it("renders multiple records, one line each, in the given order", () => {
    const out = formatRecordedFixes([
      fix({ id: "f1", symptom: "A", fix: "did A" }),
      fix({ id: "f2", symptom: "B", fix: "did B" }),
    ]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("symptom: A → fix: did A");
    expect(lines[2]).toContain("symptom: B → fix: did B");
  });

  it("collapses newlines inside symptom/fix/faultCode to spaces", () => {
    const out = formatRecordedFixes([
      fix({
        symptom: "Line 1\nLine 2\r\nLine 3",
        fix: "Step 1\nStep 2",
        faultCode: "F1\nF2",
      }),
    ]);
    expect(out).toContain("symptom: Line 1 Line 2 Line 3; fault F1 F2 → fix: Step 1 Step 2");
    expect(out).not.toContain("\n\n");
  });
});
