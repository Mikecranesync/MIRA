// Vitest coverage for POST /api/namespace/files/[id]/verify — marking a filed
// document verified (kept forever) is a governance action gated on
// namespace.admin; the route stamps verified_at/verified_by.
//
// Run: cd mira-hub && npx vitest run "src/app/api/namespace/files/[id]/verify"

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/capabilities", () => ({ requireCapability: vi.fn() }));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { requireCapability } from "@/lib/capabilities";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

const goodSession = {
  userId: "u_1",
  tenantId: "tenant-aaaa-bbbb",
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

const makeReq = (body: unknown) =>
  new Request(`https://hub.test/api/namespace/files/${VALID_UUID}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
});

describe("POST /api/namespace/files/[id]/verify", () => {
  it("403s when the caller lacks namespace.admin", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(requireCapability).mockReturnValue(
      NextResponse.json({ error: "forbidden" }, { status: 403 }),
    );

    const res = await POST(makeReq({ verified: true }), makeParams(VALID_UUID));
    expect(res.status).toBe(403);
    expect(requireCapability).toHaveBeenCalledWith(goodSession, "namespace.admin");
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it("marks a document verified", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(requireCapability).mockReturnValue(null);
    vi.mocked(withTenantContext).mockResolvedValue({
      id: VALID_UUID,
      verified: true,
      verified_at: "2026-07-03T00:00:00Z",
    });

    const res = await POST(makeReq({ verified: true }), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; file: { verified: boolean } };
    expect(body.ok).toBe(true);
    expect(body.file.verified).toBe(true);
  });

  it("422s on a non-boolean verified field", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(requireCapability).mockReturnValue(null);

    const res = await POST(makeReq({ verified: "yes" }), makeParams(VALID_UUID));
    expect(res.status).toBe(422);
  });

  it("404s when the file is not the tenant's", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(requireCapability).mockReturnValue(null);
    vi.mocked(withTenantContext).mockResolvedValue(null);

    const res = await POST(makeReq({ verified: true }), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
  });
});
