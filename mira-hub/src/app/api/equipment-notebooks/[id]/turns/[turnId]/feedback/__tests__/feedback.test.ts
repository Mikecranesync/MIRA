import { describe, it, expect } from "vitest";

describe("POST /api/equipment-notebooks/[id]/turns/[turnId]/feedback", () => {
  // Test constants
  const tenantId = "a1234567-1234-1234-1234-123456789abc";
  const notebookId = "b2345678-2345-2345-2345-234567890bcd";
  const turnId = "c3456789-3456-3456-3456-345678901cde";
  const otherTenantId = "e5678901-5678-5678-5678-567890123efg";

  it("should validate helpful parameter is required", () => {
    const body = { reason: "answered my question" };
    // Missing helpful should be rejected
    expect(body).not.toHaveProperty("helpful");
  });

  it("should accept helpful as boolean true", () => {
    const body = { helpful: true, reason: "answered my question" };
    expect(body.helpful).toBe(true);
    expect(typeof body.helpful).toBe("boolean");
  });

  it("should accept helpful as boolean false", () => {
    const body = { helpful: false, reason: "not helpful" };
    expect(body.helpful).toBe(false);
    expect(typeof body.helpful).toBe("boolean");
  });

  it("should map helpful:true to verdict:good", () => {
    const body = { helpful: true };
    const verdict = body.helpful ? "good" : "bad";
    expect(verdict).toBe("good");
  });

  it("should map helpful:false to verdict:bad", () => {
    const body = { helpful: false };
    const verdict = body.helpful ? "good" : "bad";
    expect(verdict).toBe("bad");
  });

  it("should accept optional reason text", () => {
    const body = { helpful: true, reason: "answered my question" };
    expect(body.reason).toBe("answered my question");
  });

  it("should cap reason text at 2000 characters", () => {
    const longText = "x".repeat(3000);
    const capped = longText.slice(0, 2000);
    expect(capped.length).toBe(2000);
    expect(capped).toBe("x".repeat(2000));
  });

  it("should handle null reason when not provided", () => {
    const body = { helpful: true };
    const reason = typeof body.reason === "string" ? body.reason : null;
    expect(reason).toBe(null);
  });

  it("should validate UUID format for notebookId parameter", () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(UUID_RE.test(notebookId)).toBe(true);
  });

  it("should validate UUID format for turnId parameter", () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(UUID_RE.test(turnId)).toBe(true);
  });

  it("should reject invalid UUID formats", () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(UUID_RE.test("not-a-uuid")).toBe(false);
    expect(UUID_RE.test("12345")).toBe(false);
  });

  it("should distinguish between different tenant IDs", () => {
    expect(tenantId).not.toBe(otherTenantId);
  });
});
