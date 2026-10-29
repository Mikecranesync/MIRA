import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));

import pool from "@/lib/db";
import {
  INVITE_MAGIC_LINK_TTL_MINUTES,
  LOGIN_MAGIC_LINK_TTL_MINUTES,
  PILOT_WINDOW_DAYS,
} from "@/lib/config";
import {
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
      null, // #4902 terms_version — no consent supplied → not recorded
      null, // #4902 terms_sha256
    ]);
  });
});
