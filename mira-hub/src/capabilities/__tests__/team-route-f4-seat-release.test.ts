// #4878 review round 1, F4 (Codex #4664 F4 / #4768) — a seat reservation
// that never produced a usable invite (the magic-token insert fails right
// after the seat was reserved) must be released, not permanently stranded.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/users", () => ({
  createMagicToken: vi.fn(),
  ensureSchema: vi.fn(async () => undefined),
}));
vi.mock("@/capabilities/pilot-access", () => ({
  PilotSeatCapError: class PilotSeatCapError extends Error {},
  reservePilotSeat: vi.fn(),
  releasePilotSeatReservation: vi.fn(async () => undefined),
}));

import { POST } from "@/app/api/team/route";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { createMagicToken } from "@/lib/users";
import { releasePilotSeatReservation, reservePilotSeat } from "../pilot-access";

const TENANT = "tenant-1";
const session = { userId: "u_admin", tenantId: TENANT, email: "admin@example.com" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryMock = (pool as any).query as ReturnType<typeof vi.fn>;

function postReq(body: Record<string, unknown>) {
  return new Request("http://t/api/team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOr401).mockResolvedValue(session as never);
  queryMock.mockImplementation((sql: string) => {
    if (/SELECT role, status/.test(sql)) {
      return Promise.resolve({ rows: [{ role: "owner", status: "approved" }] });
    }
    if (/SELECT id, tenant_id/.test(sql)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
  vi.mocked(reservePilotSeat).mockResolvedValue({ reserved: true });
});

describe("POST /api/team — F4 seat release on token-creation failure", () => {
  it("releases the reservation when createMagicToken fails after a successful reservation", async () => {
    vi.mocked(createMagicToken).mockRejectedValue(new Error("db insert failed"));

    const res = await POST(postReq({ email: "fifth@example.com", role: "technician" }));

    expect(res.status).toBe(500);
    expect(releasePilotSeatReservation).toHaveBeenCalledWith(TENANT, "fifth@example.com");
  });

  it("CONTROL — does not release the reservation when createMagicToken succeeds", async () => {
    vi.mocked(createMagicToken).mockResolvedValue("tok-ok");

    const res = await POST(postReq({ email: "sixth@example.com", role: "technician" }));

    expect(res.status).toBe(200);
    expect(releasePilotSeatReservation).not.toHaveBeenCalled();
  });
});
