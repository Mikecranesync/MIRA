import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/suggestion-accept", () => ({ decideSuggestion: vi.fn() }));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { decideSuggestion } from "@/lib/suggestion-accept";

const ID = "22222222-2222-2222-2222-222222222222";
const goodSession = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  userId: "u1",
  email: "t@e.com",
  status: "active",
  trialExpiresAt: null,
};

function post(id: string, body: unknown): Promise<Response> {
  const req = new Request(`http://hub.test/api/suggestions/${id}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id }) }) as unknown as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOr401).mockResolvedValue(goodSession);
});

describe("POST /api/suggestions/[id]/decide", () => {
  it("verify → 200 with entityId, scoped to the tenant", async () => {
    vi.mocked(decideSuggestion).mockResolvedValue({
      kind: "ok",
      decision: "verify",
      status: "accepted",
      entityId: "kg-1",
    });
    const res = await post(ID, { decision: "verify" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "accepted", entityId: "kg-1" });
    expect(vi.mocked(decideSuggestion).mock.calls[0][0]).toBe(goodSession.tenantId);
  });

  it("404 when the suggestion is absent", async () => {
    vi.mocked(decideSuggestion).mockResolvedValue({ kind: "not_found" });
    const res = await post(ID, { decision: "reject" });
    expect(res.status).toBe(404);
  });

  it("409 for an already-decided suggestion", async () => {
    vi.mocked(decideSuggestion).mockResolvedValue({ kind: "wrong_state", status: "accepted" });
    const res = await post(ID, { decision: "verify" });
    expect(res.status).toBe(409);
  });

  it("400 on an invalid id (no decide call)", async () => {
    const res = await post("not-a-uuid", { decision: "verify" });
    expect(res.status).toBe(400);
    expect(vi.mocked(decideSuggestion)).not.toHaveBeenCalled();
  });

  it("400 on a bad decision value", async () => {
    const res = await post(ID, { decision: "maybe" });
    expect(res.status).toBe(400);
    expect(vi.mocked(decideSuggestion)).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated (no decide call)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await post(ID, { decision: "verify" });
    expect(res.status).toBe(401);
    expect(vi.mocked(decideSuggestion)).not.toHaveBeenCalled();
  });
});
