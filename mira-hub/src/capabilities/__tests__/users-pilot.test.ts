import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));

import pool from "@/lib/db";
import {
  INVITE_MAGIC_LINK_TTL_MINUTES,
  LOGIN_MAGIC_LINK_TTL_MINUTES,
  PILOT_WINDOW_DAYS,
} from "@/lib/config";
import { PilotSeatCapError } from "@/capabilities/trial-access";
import {
  assertPilotSeatAvailable,
  createMagicToken,
  ensureUserAndTenant,
} from "@/lib/users";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryMock = (pool as any).query as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const connectMock = (pool as any).connect as ReturnType<typeof vi.fn>;

function callMatching(pattern: RegExp): { sql: string; params: unknown[] } {
  const call = queryMock.mock.calls.find((args) => pattern.test(String(args[0])));
  if (!call) throw new Error(`No query matched ${pattern}`);
  return { sql: String(call[0]), params: (call[1] as unknown[]) ?? [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockResolvedValue({ rows: [] });
  connectMock.mockResolvedValue({
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  });
});

describe("pilot invite and trial window persistence (#4362)", () => {
  it("keeps invite tokens live for the 30-day pilot window", async () => {
    await createMagicToken("invited@example.com", {
      tenantId: "tenant-1",
      role: "technician",
      invitedBy: "user-admin",
    });
    const insert = callMatching(/INSERT INTO hub_magic_tokens/);
    expect(insert.sql).toMatch(/\$6::int \* INTERVAL '1 minute'/);
    expect(insert.params[5]).toBe(INVITE_MAGIC_LINK_TTL_MINUTES);
    expect(insert.params[5]).toBe(30 * 24 * 60);
  });

  it("keeps ordinary login tokens on the 15-minute hop", async () => {
    await createMagicToken("buyer@example.com");
    const insert = callMatching(/INSERT INTO hub_magic_tokens/);
    expect(insert.params[2]).toBeNull();
    expect(insert.params[5]).toBe(LOGIN_MAGIC_LINK_TTL_MINUTES);
    expect(insert.params[5]).toBe(15);
  });

  it("creates the buyer trial for the full 30-day window", async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (/INSERT INTO hub_tenants/.test(sql)) {
        return { rows: [{ id: "tenant-1" }] };
      }
      if (/INSERT INTO hub_users/.test(sql)) {
        return { rows: [{ id: "user-1", email: "buyer@example.com" }] };
      }
      return { rows: [] };
    });
    connectMock.mockResolvedValue({
      query: clientQuery,
      release: vi.fn(),
    });

    await expect(
      ensureUserAndTenant({ email: "buyer@example.com", name: "Buyer" }),
    ).resolves.toEqual({
      id: "user-1",
      tenantId: "tenant-1",
      email: "buyer@example.com",
    });

    const insert = clientQuery.mock.calls.find((args) => /INSERT INTO hub_users/.test(String(args[0])));
    expect(insert).toBeTruthy();
    expect(String(insert?.[0])).toMatch(/\$6::int \* INTERVAL '1 day'/);
    expect(insert?.[1]).toEqual([
      "buyer@example.com",
      null,
      null,
      "tenant-1",
      "Buyer",
      PILOT_WINDOW_DAYS,
    ]);
  });
});

describe("assertPilotSeatAvailable", () => {
  function scriptPilotQueries(opts: {
    isPilot: boolean;
    members: string[];
    pending: string[];
  }) {
    queryMock.mockImplementation((sql: string) => {
      if (/status = 'trial'/.test(sql)) {
        return Promise.resolve({ rows: opts.isPilot ? [{ "?column?": 1 }] : [] });
      }
      if (/SELECT email_lower FROM hub_users/.test(sql)) {
        return Promise.resolve({
          rows: opts.members.map((email) => ({ email_lower: email })),
        });
      }
      if (/SELECT email FROM hub_magic_tokens/.test(sql)) {
        return Promise.resolve({
          rows: opts.pending.map((email) => ({ email })),
        });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  it("rejects a sixth new invite on a 5-user pilot site", async () => {
    scriptPilotQueries({
      isPilot: true,
      members: [
        "owner@site.test",
        "a@site.test",
        "b@site.test",
        "c@site.test",
        "d@site.test",
      ],
      pending: [],
    });
    await expect(assertPilotSeatAvailable("tenant-1", "sixth@site.test")).rejects.toBeInstanceOf(
      PilotSeatCapError,
    );
  });

  it("counts unused pending invites toward the 5-user cap", async () => {
    scriptPilotQueries({
      isPilot: true,
      members: ["owner@site.test", "a@site.test", "b@site.test"],
      pending: ["pending-1@site.test", "pending-2@site.test"],
    });
    await expect(assertPilotSeatAvailable("tenant-1", "sixth@site.test")).rejects.toMatchObject({
      name: "PilotSeatCapError",
      message: expect.stringMatching(/limited to 5 users/),
    });
  });

  it("lets an existing member be re-invited without consuming a new seat", async () => {
    scriptPilotQueries({
      isPilot: true,
      members: [
        "owner@site.test",
        "a@site.test",
        "b@site.test",
        "c@site.test",
        "d@site.test",
      ],
      pending: [],
    });
    await expect(assertPilotSeatAvailable("tenant-1", "a@site.test")).resolves.toBeUndefined();
  });

  it("does not cap a site that is no longer on trial", async () => {
    scriptPilotQueries({
      isPilot: false,
      members: [
        "owner@site.test",
        "a@site.test",
        "b@site.test",
        "c@site.test",
        "d@site.test",
        "e@site.test",
      ],
      pending: [],
    });
    await expect(assertPilotSeatAvailable("tenant-1", "sixth@site.test")).resolves.toBeUndefined();
  });
});
