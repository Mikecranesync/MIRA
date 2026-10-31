// Codex #4882 F7: the approve route must report a seat-cap refusal as 409, not 500.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(async () => ({ userId: "admin-1", tenantId: "t-admin" })),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/capabilities", () => ({ requireCapability: vi.fn(() => null) }));

const { approveMock } = vi.hoisted(() => ({ approveMock: vi.fn() }));
vi.mock("@/capabilities/pilot-access", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/capabilities/pilot-access")>();
  return { ...real, isPilotApprovalRequired: () => true, approvePilotTenant: approveMock };
});

import { PilotSeatCapError } from "@/capabilities/pilot-access";
import { POST } from "@/app/(hub)/api/admin/pilots/[tenantId]/approve/route";

describe("POST /api/admin/pilots/[tenantId]/approve", () => {
  beforeEach(() => approveMock.mockReset());

  it("returns 409 with the seat-cap message when approval exceeds the seat cap", async () => {
    approveMock.mockRejectedValueOnce(new PilotSeatCapError(5));
    const res = await POST(new Request("http://x/"), { params: Promise.resolve({ tenantId: "t1" }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("limited to 5 users");
  });

  it("still returns 500 for an unexpected error", async () => {
    approveMock.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(new Request("http://x/"), { params: Promise.resolve({ tenantId: "t1" }) });
    expect(res.status).toBe(500);
  });
});
