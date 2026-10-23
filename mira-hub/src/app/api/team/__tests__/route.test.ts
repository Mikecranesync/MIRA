import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/users", () => ({
  createMagicToken: vi.fn(),
  ensureSchema: vi.fn(),
  assertPilotSeatAvailable: vi.fn(),
}));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { assertPilotSeatAvailable, createMagicToken } from "@/lib/users";
import { PilotSeatCapError } from "@/lib/trial-access";

const TENANT_ID = "tenant-pilot";
const goodSession = {
  userId: "owner-1",
  tenantId: TENANT_ID,
  email: "owner@site.test",
  status: "trial",
  trialExpiresAt: null,
  role: "owner",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryMock = (pool as any).query as ReturnType<typeof vi.fn>;

function makeReq(body: unknown) {
  return new Request("https://hub.test/api/team", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  delete process.env.RESEND_API_KEY;
  vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
  vi.mocked(createMagicToken).mockResolvedValue("tok_invite");
  vi.mocked(assertPilotSeatAvailable).mockResolvedValue(undefined);
  queryMock.mockImplementation((sql: string) => {
    if (/SELECT role, status/.test(sql)) {
      return Promise.resolve({ rows: [{ role: "owner", status: "trial" }] });
    }
    if (/SELECT id, tenant_id/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
});

describe("POST /api/team — pilot seat cap (#4362)", () => {
  it("rejects a sixth invite with a clear 409", async () => {
    vi.mocked(assertPilotSeatAvailable).mockRejectedValue(new PilotSeatCapError());

    const res = await POST(makeReq({ email: "sixth@site.test", role: "technician" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/limited to 5 users/);
    expect(body.error).toMatch(/sixth invite/);
    expect(createMagicToken).not.toHaveBeenCalled();
  });

  it("sends the fifth invite when a seat is free", async () => {
    const res = await POST(makeReq({ email: "fifth@site.test", role: "technician" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      email: "fifth@site.test",
      role: "technician",
    });
    expect(assertPilotSeatAvailable).toHaveBeenCalledWith(TENANT_ID, "fifth@site.test");
    expect(createMagicToken).toHaveBeenCalledWith("fifth@site.test", {
      tenantId: TENANT_ID,
      role: "technician",
      invitedBy: "owner-1",
    });
  });
});
