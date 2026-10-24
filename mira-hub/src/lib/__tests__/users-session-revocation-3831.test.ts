// #3831: revokeUserSessions bumps exactly one hub_users.session_version.
// Disabling an account (pending / expired) must ride the same increment so
// the existing admin Revoke / Expire actions actually kill the JWT.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));

import pool from "@/lib/db";
import { revokeUserSessions, updateUserStatus } from "../users";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryMock = (pool as any).query as ReturnType<typeof vi.fn>;

function callMatching(pattern: RegExp): { sql: string; params: unknown[] } {
  const call = queryMock.mock.calls.find((args) => pattern.test(String(args[0])));
  if (!call) throw new Error(`No query matched ${pattern}`);
  return { sql: String(call[0]), params: (call[1] as unknown[]) ?? [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockResolvedValue({ rows: [] });
});

describe("revokeUserSessions (#3831)", () => {
  it("increments session_version for exactly one user id", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (/UPDATE hub_users[\s\S]*session_version = session_version \+ 1/i.test(sql)) {
        return Promise.resolve({ rows: [{ session_version: 3 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    await expect(revokeUserSessions("user-leaked")).resolves.toEqual({
      found: true,
      sessionVersion: 3,
    });
    const upd = callMatching(/session_version = session_version \+ 1/i);
    expect(upd.params).toEqual(["user-leaked"]);
    expect(upd.sql).toMatch(/WHERE id = \$1/i);
    expect(upd.sql).not.toMatch(/tenant_id/i);
  });

  it("reports not-found when the id matches no row (no other user touched)", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await expect(revokeUserSessions("ghost")).resolves.toEqual({
      found: false,
      sessionVersion: null,
    });
  });
});

describe("updateUserStatus connects disable → session kill (#3831)", () => {
  it.each(["pending", "expired"] as const)(
    "status %s increments session_version on the same row",
    async (status) => {
      await updateUserStatus("user-1", status);
      const upd = callMatching(/UPDATE hub_users/);
      expect(upd.sql).toMatch(/session_version = session_version \+ 1/i);
      expect(upd.params[0]).toBe(status);
      expect(upd.params[1]).toBe("user-1");
    },
  );

  it.each(["approved", "trial", "admin"] as const)(
    "status %s does not increment session_version (account stays signed in)",
    async (status) => {
      await updateUserStatus("user-1", status);
      const upd = callMatching(/UPDATE hub_users/);
      expect(upd.sql).not.toMatch(/session_version/i);
      expect(upd.params).toEqual([status, "user-1"]);
    },
  );
});
