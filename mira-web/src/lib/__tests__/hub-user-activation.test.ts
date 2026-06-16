/**
 * hub-user-activation tests.
 *
 * We don't need a live NeonDB — we mock @neondatabase/serverless's `neon`
 * to capture the SQL the helpers issue and assert the shape. The real
 * SQL is exercised by the schema in mira-hub/src/lib/users.ts (status
 * column, email_lower generated column).
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

let capturedQueries: Array<{ strings: TemplateStringsArray; values: unknown[] }>;
let scriptedReturns: Array<unknown[]>;

mock.module("@neondatabase/serverless", () => ({
  neon: () => {
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedQueries.push({ strings, values });
      const next = scriptedReturns.shift() ?? [];
      return Promise.resolve(next);
    };
  },
}));

beforeEach(() => {
  capturedQueries = [];
  scriptedReturns = [];
  process.env.NEON_DATABASE_URL = "postgresql://fake:fake@fake/fake";
});

afterEach(() => {
  delete process.env.NEON_DATABASE_URL;
});

describe("activateHubUserByEmail", () => {
  test("returns matched=0 for empty email without touching DB", async () => {
    const { activateHubUserByEmail } = await import("../hub-user-activation");
    const out = await activateHubUserByEmail("   ");
    expect(out.matched).toBe(0);
    expect(capturedQueries.length).toBe(0);
  });

  test("issues an UPDATE that sets status to approved and clears trial_expires_at", async () => {
    scriptedReturns = [[{ id: "user-123" }]];
    const { activateHubUserByEmail } = await import("../hub-user-activation");
    const out = await activateHubUserByEmail("Mike@Factorylm.com");
    expect(out.matched).toBe(1);
    expect(capturedQueries.length).toBe(1);
    const sql = capturedQueries[0].strings.join("?");
    expect(sql).toContain("UPDATE hub_users");
    expect(sql).toContain("status = 'approved'");
    expect(sql).toContain("trial_expires_at = NULL");
    expect(sql).toContain("email_lower = LOWER(");
    expect(capturedQueries[0].values).toEqual(["Mike@Factorylm.com"]);
  });

  test("returns matched=0 when no rows affected (user not yet on Hub)", async () => {
    scriptedReturns = [[]];
    const { activateHubUserByEmail } = await import("../hub-user-activation");
    const out = await activateHubUserByEmail("nobody@example.com");
    expect(out.matched).toBe(0);
  });

  test("throws when NEON_DATABASE_URL is unset", async () => {
    delete process.env.NEON_DATABASE_URL;
    const { activateHubUserByEmail } = await import("../hub-user-activation");
    await expect(activateHubUserByEmail("a@b.com")).rejects.toThrow(
      /NEON_DATABASE_URL/,
    );
  });
});

describe("expireHubUserByEmail", () => {
  test("issues an UPDATE that sets status to expired", async () => {
    scriptedReturns = [[{ id: "user-456" }]];
    const { expireHubUserByEmail } = await import("../hub-user-activation");
    const out = await expireHubUserByEmail("paid@x.com");
    expect(out.matched).toBe(1);
    const sql = capturedQueries[0].strings.join("?");
    expect(sql).toContain("UPDATE hub_users");
    expect(sql).toContain("status = 'expired'");
    expect(sql).not.toContain("trial_expires_at"); // intentionally untouched
  });

  test("returns matched=0 for empty email", async () => {
    const { expireHubUserByEmail } = await import("../hub-user-activation");
    const out = await expireHubUserByEmail("");
    expect(out.matched).toBe(0);
    expect(capturedQueries.length).toBe(0);
  });
});
