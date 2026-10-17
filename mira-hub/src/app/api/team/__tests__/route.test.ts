// #4370 — a missing RESEND_API_KEY must not silently read back as "Invite
// sent". Covers the POST /api/team send-failure surfacing without a real DB
// or a real Resend call.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/users", () => ({
  createMagicToken: vi.fn(async () => "tok-123"),
  ensureSchema: vi.fn(async () => undefined),
}));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

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
  delete process.env.RESEND_API_KEY;
  vi.mocked(sessionOr401).mockResolvedValue(session as never);
  queryMock.mockImplementation((sql: string) => {
    if (/SELECT role, status/.test(sql)) return Promise.resolve({ rows: [{ role: "owner", status: "approved" }] });
    if (/SELECT id, tenant_id/.test(sql)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
});

describe("POST /api/team — invite send-failure surfacing", () => {
  it("surfaces emailSent:false and a warning when no email provider is configured", async () => {
    const res = await POST(postReq({ email: "tech@example.com", role: "technician" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, emailSent: false });
    expect(body.warning).toMatch(/no email provider is configured/i);
  });

  it("never logs the bearer invite URL/token when email is not configured", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(postReq({ email: "tech3@example.com", role: "technician" }));
      const text = await res.text();
      const allLoggedText = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
        .flat()
        .map((v) => String(v))
        .join("\n");
      expect(allLoggedText).not.toMatch(/tok-123/);
      expect(allLoggedText).not.toMatch(/token=/);
      expect(allLoggedText).not.toMatch(/magic\?token/);
      expect(text).not.toMatch(/tok-123/);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("does not warn when RESEND_API_KEY is configured and the send succeeds", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    try {
      const res = await POST(postReq({ email: "tech2@example.com", role: "technician" }));
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, emailSent: true });
      expect(body.warning).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.RESEND_API_KEY;
    }
  });
});
