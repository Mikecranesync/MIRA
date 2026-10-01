// POST /api/equipment-notebooks/[id]/identity/confirm — "Use its manuals"
// (T2, #4175/#4189): confirming an identity_proposal (#4120) sets the
// notebook's own identity through the SAME updateNotebook seam the generic
// PATCH uses (never a second identity-write path), and reports whether
// migration 104 promoted a matching candidate manual.
//
// Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks/[id]/identity/confirm/__tests__/route"
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  getNotebook: vi.fn(),
  updateNotebook: vi.fn(),
  listSources: vi.fn(),
}));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources, updateNotebook } from "@/lib/equipment-notebooks";
// The real exported contract — proves the confirm route's key input shape
// matches the candidate-basis search's own key exactly (not re-implemented).
import { acquisitionKey } from "@/capabilities/notebook-manual-acquisition";

const NB = "11111111-2222-3333-4444-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";

function req(body?: unknown): NextRequest {
  return {
    url: `http://test/api/equipment-notebooks/${NB}/identity/confirm/`,
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ id: NB }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue({
    userId: "u_1",
    tenantId: TENANT,
    email: "tech@example.com",
    status: "trial",
    trialExpiresAt: null,
    role: "owner",
  } as never);
  vi.mocked(getNotebook).mockResolvedValue({ id: NB, nodeId: "node-1", asset: null } as never);
  vi.mocked(updateNotebook).mockResolvedValue(true as never);
  vi.mocked(listSources).mockResolvedValue([] as never);
});

describe("POST identity/confirm", () => {
  it("401s without a session", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(sessionOr401).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never);
    const res = await POST(req({ manufacturer: "SMC", model: "X" }), params);
    expect(res.status).toBe(401);
    expect(updateNotebook).not.toHaveBeenCalled();
  });

  it("404s a malformed notebook id without touching the database", async () => {
    const res = await POST(req({ manufacturer: "SMC", model: "X" }), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(res.status).toBe(404);
    expect(getNotebook).not.toHaveBeenCalled();
  });

  it("400s invalid JSON", async () => {
    const res = await POST(req(undefined), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("400s when manufacturer or model is missing or blank", async () => {
    expect((await POST(req({ model: "X" }), params)).status).toBe(400);
    expect((await POST(req({ manufacturer: "SMC" }), params)).status).toBe(400);
    expect((await POST(req({ manufacturer: "  ", model: "X" }), params)).status).toBe(400);
    expect(updateNotebook).not.toHaveBeenCalled();
  });

  it("404s a notebook that isn't the caller's", async () => {
    vi.mocked(getNotebook).mockResolvedValue(null as never);
    const res = await POST(req({ manufacturer: "SMC", model: "X" }), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "notebook_not_found" });
    expect(updateNotebook).not.toHaveBeenCalled();
  });

  it("confirms through updateNotebook with identity_status=user_confirmed, writing catalogNumber='' when absent", async () => {
    const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3-DUW01302" }), params);
    expect(res.status).toBe(200);
    expect(updateNotebook).toHaveBeenCalledWith(TENANT, NB, {
      manufacturer: "SMC",
      model: "SS5Y3-DUW01302",
      catalogNumber: "",
      identityStatus: "user_confirmed",
      identitySourceType: "user",
    });
  });

  it("passes through a provided catalogNumber verbatim", async () => {
    await POST(req({ manufacturer: "SMC", model: "SS5Y3", catalogNumber: "DUW01302" }), params);
    expect(updateNotebook).toHaveBeenCalledWith(TENANT, NB, expect.objectContaining({ catalogNumber: "DUW01302" }));
  });

  it("500s when the identity write itself fails, and reports no manual", async () => {
    vi.mocked(updateNotebook).mockResolvedValue(false as never);
    const res = await POST(req({ manufacturer: "SMC", model: "X" }), params);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "confirm_failed" });
    expect(listSources).not.toHaveBeenCalled();
  });

  it("reports manualReady:false and a 'I'll look for it' message when no verified+enabled source exists yet", async () => {
    vi.mocked(listSources).mockResolvedValue([
      { docId: "d1", enabledByDefault: false, matchState: "candidate", sourceRole: "manual" },
    ] as never);
    const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3-DUW01302" }), params);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, manualReady: false });
    expect(body.message).toMatch(/look for its manual/);
  });

  it("reports manualReady:true once migration 104 has promoted a matching candidate", async () => {
    // This is what the migration 104 trigger leaves behind on the SAME row
    // (verified + enabled_by_default=true) once the identity write commits —
    // asserted here by its real column semantics, not re-derived.
    vi.mocked(listSources).mockResolvedValue([
      { docId: "d1", enabledByDefault: true, matchState: "verified", sourceRole: "manual" },
    ] as never);
    const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3-DUW01302" }), params);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, manualReady: true });
    expect(body.message).toMatch(/ready to answer from/);
  });

  it("never reports manualReady:true for a merely-found, unverified candidate (a human still reviews it)", async () => {
    vi.mocked(listSources).mockResolvedValue([
      { docId: "d1", enabledByDefault: false, matchState: "candidate", sourceRole: "manual" },
      // Enabled but NOT verified should never happen post-104, but the route
      // must not treat "enabled" alone as ready — both conditions are required.
      { docId: "d2", enabledByDefault: true, matchState: "candidate", sourceRole: "manual" },
    ] as never);
    const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3" }), params);
    expect((await res.json()).manualReady).toBe(false);
  });

  it("degrades to manualReady:false (not a 500) when the Sources read fails after a successful confirm", async () => {
    vi.mocked(listSources).mockRejectedValue(new Error("db down") as never);
    const res = await POST(req({ manufacturer: "SMC", model: "X" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).manualReady).toBe(false);
  });

  it("writes an identity whose acquisitionKey matches the candidate-basis search's own key exactly (migration 104's promotion predicate)", async () => {
    await POST(req({ manufacturer: "SMC", model: "SS5Y3-DUW01302" }), params);
    const written = vi.mocked(updateNotebook).mock.calls[0][2] as {
      manufacturer: string;
      model: string;
      catalogNumber: string;
    };
    const confirmedKey = acquisitionKey({
      identityStatus: "user_confirmed",
      manufacturer: written.manufacturer,
      model: written.model,
      catalogNumber: written.catalogNumber,
    });
    // The EXACT shape notebook-manual-acquisition.ts's candidateAcquisitionOwnsTurn
    // block builds from an identity_proposal (chat/route.ts): catalogNumber: "".
    const candidateKey = acquisitionKey({
      identityStatus: "user_confirmed",
      manufacturer: "SMC",
      model: "SS5Y3-DUW01302",
      catalogNumber: "",
    });
    expect(confirmedKey).not.toBeNull();
    expect(confirmedKey).toBe(candidateKey);
  });
});
