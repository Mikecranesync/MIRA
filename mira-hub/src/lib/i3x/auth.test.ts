import { describe, expect, it } from "vitest";
import { hashKey, resolveTenantFromKeyRow, parseBearer } from "@/lib/i3x/auth";

describe("parseBearer", () => {
  it("extracts the token from an Authorization header", () => {
    expect(parseBearer("Bearer abc123")).toBe("abc123");
  });
  it("is case-insensitive on the scheme", () => {
    expect(parseBearer("bearer abc123")).toBe("abc123");
  });
  it("returns null when missing or malformed", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("Basic xyz")).toBeNull();
    expect(parseBearer("Bearer")).toBeNull();
  });
});

describe("hashKey", () => {
  it("produces a stable lowercase hex sha256", () => {
    expect(hashKey("secret")).toBe(hashKey("secret"));
    expect(hashKey("secret")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey("a")).not.toBe(hashKey("b"));
  });
  it("produces the known sha256 digest for 'secret'", () => {
    expect(hashKey("secret")).toBe("2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b");
  });
});

describe("resolveTenantFromKeyRow", () => {
  it("returns the tenantId for an enabled key row", () => {
    expect(resolveTenantFromKeyRow({ tenant_id: "t1", enabled: true })).toBe("t1");
  });
  it("returns null for a disabled or missing row", () => {
    expect(resolveTenantFromKeyRow({ tenant_id: "t1", enabled: false })).toBeNull();
    expect(resolveTenantFromKeyRow(null)).toBeNull();
  });
});
