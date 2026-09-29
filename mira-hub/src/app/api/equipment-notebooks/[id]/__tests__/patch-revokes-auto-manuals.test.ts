/**
 * #4075 / Codex #4118 F3 — changing a notebook's identity turns off manuals an
 * automatic search enabled for the OLD identity.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: "t1", userId: "u1" })) }));
const domain = vi.hoisted(() => ({
  deleteNotebook: vi.fn(),
  getNotebook: vi.fn(),
  listSources: vi.fn(),
  listTurns: vi.fn(),
  updateNotebook: vi.fn(async () => true),
}));
vi.mock("@/lib/equipment-notebooks", () => domain);
const acq = vi.hoisted(() => ({ revokeStaleAutoAcquiredSources: vi.fn(async () => 1) }));
vi.mock("@/capabilities/notebook-manual-acquisition", () => acq);

import { PATCH } from "../route";

const req = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/nb", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: Promise.resolve({ id: "nb" }) };

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/equipment-notebooks/[id]", () => {
  it("after a successful update, revokes auto-acquired manuals for the notebook", async () => {
    const res = await PATCH(req({ model: "VQ1000-XYZ" }), params);
    expect(res.status).toBe(200);
    expect(domain.updateNotebook).toHaveBeenCalledTimes(1);
    expect(acq.revokeStaleAutoAcquiredSources).toHaveBeenCalledWith("t1", "nb");
    // Revocation runs AFTER the identity write, never before.
    expect(domain.updateNotebook.mock.invocationCallOrder[0]).toBeLessThan(
      acq.revokeStaleAutoAcquiredSources.mock.invocationCallOrder[0],
    );
  });
  it("control: a rejected update revokes nothing", async () => {
    domain.updateNotebook.mockResolvedValueOnce(false);
    const res = await PATCH(req({ model: "X" }), params);
    expect(res.status).toBe(404);
    expect(acq.revokeStaleAutoAcquiredSources).not.toHaveBeenCalled();
  });
});
