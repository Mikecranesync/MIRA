import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));

import pool from "@/lib/db";
import { INVITE_MAGIC_LINK_TTL_MINUTES } from "@/lib/config";
import { createMagicToken, ensureInvitedUser, validateMagicToken } from "../users";

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

describe("team invite magic tokens", () => {
  it("persists tenant, role, and inviter metadata on invite tokens", async () => {
    const token = await createMagicToken("INVITED@EXAMPLE.COM", {
      tenantId: "tenant-1",
      role: "technician",
      invitedBy: "user-admin",
    });

    expect(token).toMatch(/[0-9a-f-]{36}/);
    const insert = callMatching(/INSERT INTO hub_magic_tokens/);
    expect(insert.sql).toMatch(/tenant_id, role, invited_by/);
    expect(insert.params.slice(1, 5)).toEqual([
      "invited@example.com",
      "tenant-1",
      "technician",
      "user-admin",
    ]);
  });

  it("returns invite metadata when a magic token is consumed", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (/UPDATE hub_magic_tokens/.test(sql)) {
        return Promise.resolve({
          rows: [
            {
              email: "invited@example.com",
              tenant_id: "tenant-1",
              role: "admin",
              invited_by: "user-admin",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(validateMagicToken("tok_123")).resolves.toEqual({
      email: "invited@example.com",
      tenantId: "tenant-1",
      role: "admin",
      invitedBy: "user-admin",
    });
  });
});

describe("magic token TTL (#4370 — invites expiring in 15 minutes)", () => {
  it("gives a workspace invitation (tenantId set) the configured invite window, not 15 minutes", async () => {
    await createMagicToken("invited@example.com", {
      tenantId: "tenant-1",
      role: "technician",
      invitedBy: "user-admin",
    });
    const insert = callMatching(/INSERT INTO hub_magic_tokens/);
    // #4664 owns the length (INVITE_MAGIC_LINK_TTL_MINUTES); this PR only needs
    // an invite to outlive the 15-minute sign-in hop that broke #4370.
    expect(insert.sql).toMatch(/NOW\(\) \+ \(\$6::int \* INTERVAL '1 minute'\)/);
    expect(insert.params[5]).toBe(INVITE_MAGIC_LINK_TTL_MINUTES);
    expect(insert.params[5]).toBeGreaterThanOrEqual(24 * 60);
  });

  it("keeps an ordinary sign-in magic link (no tenantId) at 15 minutes", async () => {
    await createMagicToken("owner@example.com");
    const insert = callMatching(/INSERT INTO hub_magic_tokens/);
    expect(insert.params[5]).toBe(15);
  });
});

describe("consumed magic tokens cannot replay", () => {
  it("returns the invite metadata once; a second validate of the same token fails", async () => {
    let consumed = false;
    queryMock.mockImplementation((sql: string) => {
      if (/UPDATE hub_magic_tokens/.test(sql)) {
        if (consumed) return Promise.resolve({ rows: [] });
        consumed = true;
        return Promise.resolve({
          rows: [
            {
              email: "invited@example.com",
              tenant_id: "tenant-1",
              role: "technician",
              invited_by: "user-admin",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(validateMagicToken("tok-once")).resolves.not.toBeNull();
    await expect(validateMagicToken("tok-once")).resolves.toBeNull();
  });
});

describe("ensureInvitedUser", () => {
  it("attaches a new invited user to the inviter's tenant as approved", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (/SELECT .*FROM hub_users WHERE email_lower/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      if (/INSERT INTO hub_users/.test(sql)) {
        return Promise.resolve({
          rows: [{ id: "user-new", email: "new@example.com", tenant_id: "tenant-1" }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      ensureInvitedUser({
        email: "NEW@EXAMPLE.COM",
        tenantId: "tenant-1",
        role: "technician",
      }),
    ).resolves.toEqual({
      id: "user-new",
      tenantId: "tenant-1",
      email: "new@example.com",
    });

    const insert = callMatching(/INSERT INTO hub_users/);
    expect(insert.sql).toMatch(/status\)/);
    expect(insert.sql).toMatch(/'approved'/);
    expect(insert.params).toEqual(["new@example.com", "tenant-1", "technician"]);
  });

  it("rejects an invite for an email that already belongs to another tenant", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (/SELECT .*FROM hub_users WHERE email_lower/.test(sql)) {
        return Promise.resolve({
          rows: [
            {
              id: "user-other",
              email: "existing@example.com",
              password_hash: null,
              google_sub: null,
              tenant_id: "tenant-other",
              name: null,
              role: "owner",
              status: "trial",
              trial_expires_at: null,
              plan: null,
              preferences: {},
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      ensureInvitedUser({
        email: "existing@example.com",
        tenantId: "tenant-1",
        role: "admin",
      }),
    ).rejects.toThrow("email already belongs to another workspace");
    expect(queryMock.mock.calls.some((args) => /UPDATE hub_users/.test(String(args[0])))).toBe(false);
    expect(queryMock.mock.calls.some((args) => /INSERT INTO hub_users/.test(String(args[0])))).toBe(false);
  });
});
