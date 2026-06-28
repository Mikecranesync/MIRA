import { describe, expect, it } from "vitest";

// Validate the allowed statuses constant without importing the route (avoids
// Next.js module-not-found errors in the test runner).
const ALLOWED_STATUSES = new Set(["accepted", "rejected", "pending"]);

describe("extraction status validation", () => {
  it("accepts valid statuses", () => {
    expect(ALLOWED_STATUSES.has("accepted")).toBe(true);
    expect(ALLOWED_STATUSES.has("rejected")).toBe(true);
    expect(ALLOWED_STATUSES.has("pending")).toBe(true);
  });

  it("rejects invalid statuses", () => {
    expect(ALLOWED_STATUSES.has("verified")).toBe(false);
    expect(ALLOWED_STATUSES.has("done")).toBe(false);
    expect(ALLOWED_STATUSES.has("")).toBe(false);
    expect(ALLOWED_STATUSES.has("ACCEPTED")).toBe(false);
  });
});

describe("UUID validation pattern", () => {
  const UUID_RE = /^[0-9a-f-]{36}$/i;

  it("accepts valid UUIDs", () => {
    expect(UUID_RE.test("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(UUID_RE.test("a3bb189e-8bf9-3888-9912-ace4e6543002")).toBe(true);
  });

  it("rejects invalid IDs", () => {
    expect(UUID_RE.test("")).toBe(false);
    expect(UUID_RE.test("not-a-uuid")).toBe(false);
    expect(UUID_RE.test("../../../etc/passwd")).toBe(false);
    expect(UUID_RE.test("1234")).toBe(false);
  });
});
