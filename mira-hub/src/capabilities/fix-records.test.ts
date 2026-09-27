import { describe, expect, it } from "vitest";
import { isUuid, requestFingerprint, validateFixInput } from "@/capabilities/fix-records";

const RID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TURN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("validateFixInput", () => {
  it("accepts a minimal valid body", () => {
    const res = validateFixInput({ symptom: "Won't start", fix: "Reset E-stop", clientRequestId: RID, sourceTurnId: TURN });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual({
        symptom: "Won't start",
        fix: "Reset E-stop",
        faultCode: null,
        sourceTurnId: TURN,
        clientRequestId: RID,
      });
    }
  });

  it("trims symptom, fix, and faultCode", () => {
    const res = validateFixInput({ symptom: "  loud noise  ", fix: "  tightened bolts  ", faultCode: "  F0004  ", clientRequestId: RID, sourceTurnId: TURN });
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
    expect(validateFixInput({ fix: "did a thing", clientRequestId: RID, sourceTurnId: TURN })).toEqual({ ok: false, error: "symptom_required" });
    expect(validateFixInput({ symptom: "   ", fix: "did a thing", clientRequestId: RID, sourceTurnId: TURN })).toEqual({ ok: false, error: "symptom_required" });
    expect(validateFixInput({ symptom: 42, fix: "did a thing", clientRequestId: RID, sourceTurnId: TURN })).toEqual({ ok: false, error: "symptom_required" });
  });

  it("rejects a symptom over 500 chars", () => {
    const res = validateFixInput({ symptom: "x".repeat(501), fix: "ok", clientRequestId: RID, sourceTurnId: TURN });
    expect(res).toEqual({ ok: false, error: "symptom_too_long" });
  });

  it("accepts a symptom at exactly 500 chars", () => {
    const res = validateFixInput({ symptom: "x".repeat(500), fix: "ok", clientRequestId: RID, sourceTurnId: TURN });
    expect(res.ok).toBe(true);
  });

  it("rejects a missing or empty fix", () => {
    expect(validateFixInput({ symptom: "loud noise", clientRequestId: RID, sourceTurnId: TURN })).toEqual({ ok: false, error: "fix_required" });
    expect(validateFixInput({ symptom: "loud noise", fix: "   ", clientRequestId: RID, sourceTurnId: TURN })).toEqual({ ok: false, error: "fix_required" });
    expect(validateFixInput({ symptom: "loud noise", fix: [], clientRequestId: RID, sourceTurnId: TURN })).toEqual({ ok: false, error: "fix_required" });
  });

  it("rejects a fix over 2000 chars", () => {
    const res = validateFixInput({ symptom: "ok", fix: "x".repeat(2001), clientRequestId: RID, sourceTurnId: TURN });
    expect(res).toEqual({ ok: false, error: "fix_too_long" });
  });

  it("accepts a fix at exactly 2000 chars", () => {
    const res = validateFixInput({ symptom: "ok", fix: "x".repeat(2000), clientRequestId: RID, sourceTurnId: TURN });
    expect(res.ok).toBe(true);
  });

  it("allows an absent faultCode (defaults to null)", () => {
    const res = validateFixInput({ symptom: "ok", fix: "ok", clientRequestId: RID, sourceTurnId: TURN });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.faultCode).toBeNull();
  });

  it("treats an empty-string faultCode as absent (null)", () => {
    const res = validateFixInput({ symptom: "ok", fix: "ok", faultCode: "   ", clientRequestId: RID, sourceTurnId: TURN });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.faultCode).toBeNull();
  });

  it("rejects a non-string faultCode", () => {
    expect(validateFixInput({ symptom: "ok", fix: "ok", faultCode: 4, clientRequestId: RID, sourceTurnId: TURN })).toEqual({
      ok: false,
      error: "invalid_fault_code",
    });
  });

  it("rejects a faultCode over 64 chars", () => {
    const res = validateFixInput({ symptom: "ok", fix: "ok", faultCode: "F".repeat(65), clientRequestId: RID, sourceTurnId: TURN });
    expect(res).toEqual({ ok: false, error: "fault_code_too_long" });
  });

  it("accepts a faultCode at exactly 64 chars", () => {
    const res = validateFixInput({ symptom: "ok", fix: "ok", faultCode: "F".repeat(64), clientRequestId: RID, sourceTurnId: TURN });
    expect(res.ok).toBe(true);
  });

  it("refuses a fix with no answer turn (Codex #4058 post-cap F1)", () => {
    expect(validateFixInput({ symptom: "ok", fix: "ok", clientRequestId: RID })).toEqual({
      ok: false,
      error: "source_turn_id_required",
    });
    expect(validateFixInput({ symptom: "ok", fix: "ok", clientRequestId: RID, sourceTurnId: null })).toEqual({
      ok: false,
      error: "source_turn_id_required",
    });
  });

  it("accepts a valid UUID sourceTurnId", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const res = validateFixInput({ symptom: "ok", fix: "ok", sourceTurnId: id, clientRequestId: RID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.sourceTurnId).toBe(id);
  });

  it("rejects a non-UUID sourceTurnId", () => {
    expect(validateFixInput({ symptom: "ok", fix: "ok", sourceTurnId: "not-a-uuid", clientRequestId: RID })).toEqual({
      ok: false,
      error: "invalid_source_turn_id",
    });
    expect(validateFixInput({ symptom: "ok", fix: "ok", sourceTurnId: 123, clientRequestId: RID })).toEqual({
      ok: false,
      error: "invalid_source_turn_id",
    });
  });
});

describe("clientRequestId / isUuid", () => {
  it("accepts a UUID client request id, normalised to lower case", () => {
    const r = validateFixInput({ symptom: "s", fix: "f", clientRequestId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", sourceTurnId: TURN });
    expect(r).toEqual({ ok: true, value: expect.objectContaining({ clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) });
  });

  it("rejects a malformed client request id", () => {
    expect(validateFixInput({ symptom: "s", fix: "f", clientRequestId: "retry-1" })).toEqual({ ok: false, error: "invalid_client_request_id" });
  });

  it("isUuid guards every value the route casts to ::uuid", () => {
    expect(isUuid("22222222-2222-4222-8222-222222222222")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("../x")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("request id is required and fingerprinted (post-hardening F2/F3)", () => {
  it("refuses a save without a client request id", () => {
    expect(validateFixInput({ symptom: "s", fix: "f" })).toEqual({ ok: false, error: "client_request_id_required" });
  });

  it("fingerprints the content AND the machine, deterministically", () => {
    const v = { symptom: "s", fix: "f", faultCode: null, sourceTurnId: TURN, clientRequestId: RID };
    expect(requestFingerprint(v, "m1")).toBe(requestFingerprint({ ...v }, "m1"));
    expect(requestFingerprint(v, "m1")).not.toBe(requestFingerprint({ ...v, fix: "g" }, "m1"));
    expect(requestFingerprint(v, "m1")).not.toBe(requestFingerprint(v, "m2"));
    expect(requestFingerprint(v, "m1")).not.toBe(requestFingerprint(v, null));
  });
});
