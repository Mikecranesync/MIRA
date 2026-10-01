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

// Codex F5 (MEDIUM) — "Use the existing acquisition entry point after
// confirmation ... reusing its claim/idempotency and feature gates." Same
// controllable-spy pattern as candidate-identity-acquisition.test.ts: the
// SAME capability module backs both the candidate-basis (chat route) and
// confirmed-identity (this route) search, proving WIRING here without
// re-proving the fencing SQL (notebook-manual-acquisition.test.ts owns that).
const acqMock = vi.hoisted(() => ({
  acquisitionEnabled: vi.fn(() => true),
  startManualAcquisition: vi.fn(async () => true),
  readAcquisition: vi.fn(async () => null as unknown),
}));
vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>();
  return {
    ...actual,
    acquisitionEnabled: acqMock.acquisitionEnabled,
    startManualAcquisition: acqMock.startManualAcquisition,
    readAcquisition: acqMock.readAcquisition,
    // acquisitionKey stays REAL — pure, already unit-proven; this suite
    // checks the route builds the exact same key the candidate-basis
    // search would (see the existing "writes an identity whose
    // acquisitionKey matches ..." test below).
  };
});

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
  // `clearAllMocks` resets call history, not a `mockReturnValue` a test
  // overrode — reset the acquisition spies to their defaults explicitly so
  // one test can never leak its override into the next.
  acqMock.acquisitionEnabled.mockReturnValue(true);
  acqMock.startManualAcquisition.mockResolvedValue(true);
  acqMock.readAcquisition.mockResolvedValue(null);
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

  // Codex F7 (LOW): `req.json()` happily parses the JSON literal `null`, and
  // the route's `body: Record<string, unknown>` cast does not make it one at
  // runtime — `readString` then dereferences `body[key]` on `null` and throws
  // instead of a controlled 400. Same for any other non-object JSON value.
  it.each([null, [], "a string", 42, true])(
    "400s a valid-JSON-but-non-object body (%p) instead of throwing",
    async (value) => {
      const res = await POST(req(value), params);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_body" });
      expect(getNotebook).not.toHaveBeenCalled();
      expect(updateNotebook).not.toHaveBeenCalled();
    },
  );

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
      { docId: "d1", enabledByDefault: false, matchState: "candidate", sourceRole: "manual", readiness: { canChat: false } },
    ] as never);
    const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3-DUW01302" }), params);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, manualReady: false });
    expect(body.message).toMatch(/look for its manual/);
  });

  it("reports manualReady:true once migration 104 has promoted a matching candidate (verified)", async () => {
    // This is what the migration 104 trigger leaves behind on the SAME row
    // (verified + enabled_by_default=true) once the identity write commits —
    // asserted here by its real column semantics, not re-derived.
    vi.mocked(listSources).mockResolvedValue([
      { docId: "d1", enabledByDefault: true, matchState: "verified", sourceRole: "manual", readiness: { canChat: true } },
    ] as never);
    const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3-DUW01302" }), params);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, manualReady: true });
    expect(body.message).toMatch(/ready to answer from/);
  });

  // Codex F3 (MEDIUM): manualReady must represent an APPLICABLE, ANSWERABLE
  // manual — sourceRole "manual", readiness.canChat true, and matchState
  // verified OR user_confirmed (mirrors validateChatSources' own trust bar).
  it("reports manualReady:true for a ready user_confirmed manual (not only 'verified')", async () => {
    vi.mocked(listSources).mockResolvedValue([
      { docId: "d1", enabledByDefault: true, matchState: "user_confirmed", sourceRole: "manual", readiness: { canChat: true } },
    ] as never);
    const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3-DUW01302" }), params);
    expect((await res.json()).manualReady).toBe(true);
  });

  it("never reports manualReady:true for a merely-found, unverified candidate (a human still reviews it)", async () => {
    vi.mocked(listSources).mockResolvedValue([
      { docId: "d1", enabledByDefault: false, matchState: "candidate", sourceRole: "manual", readiness: { canChat: true } },
      // Enabled but NOT verified should never happen post-104, but the route
      // must not treat "enabled" alone as ready — both conditions are required.
      { docId: "d2", enabledByDefault: true, matchState: "candidate", sourceRole: "manual", readiness: { canChat: true } },
    ] as never);
    const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3" }), params);
    expect((await res.json()).manualReady).toBe(false);
  });

  it("never reports manualReady:true for an enabled+verified manual that failed materialization (readiness.canChat false)", async () => {
    vi.mocked(listSources).mockResolvedValue([
      { docId: "d1", enabledByDefault: true, matchState: "verified", sourceRole: "manual", readiness: { canChat: false } },
    ] as never);
    const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3" }), params);
    expect((await res.json()).manualReady).toBe(false);
  });

  it("never reports manualReady:true for an unrelated enabled+verified source that isn't a manual (e.g. a wiring diagram)", async () => {
    vi.mocked(listSources).mockResolvedValue([
      { docId: "d1", enabledByDefault: true, matchState: "verified", sourceRole: "drawing", readiness: { canChat: true } },
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

  // Codex F5 (MEDIUM) — confirming must never promise a search it doesn't
  // start. The route reuses the EXISTING background-acquisition entry point
  // (startManualAcquisition, its claim/idempotency, its own feature gate) —
  // never a second acquisition path — and the "I'll look for its manual"
  // copy appears only when a search is honestly underway.
  describe("manual search on confirm (no manual ready yet)", () => {
    it("starts the background search through the canonical acquisition seam, keyed exactly as the candidate-basis search would", async () => {
      const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3-DUW01302" }), params);
      expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
      const call = (acqMock.startManualAcquisition.mock.calls[0] as unknown[])[0] as {
        tenantId: string;
        notebookId: string;
        nodeId: string;
        identity: { identityStatus: string; manufacturer: string; model: string; catalogNumber: string };
      };
      expect(call.tenantId).toBe(TENANT);
      expect(call.notebookId).toBe(NB);
      expect(call.nodeId).toBe("node-1");
      expect(call.identity).toEqual({
        identityStatus: "user_confirmed",
        manufacturer: "SMC",
        model: "SS5Y3-DUW01302",
        catalogNumber: "",
      });
      const key = acquisitionKey(call.identity);
      expect(key).not.toBeNull();
      expect(key).toBe(acquisitionKey({ identityStatus: "user_confirmed", manufacturer: "SMC", model: "SS5Y3-DUW01302", catalogNumber: "" }));
      const body = await res.json();
      expect(body.message).toMatch(/look for its manual/);
    });

    it("a repeated confirmation does not duplicate the search — a refused claim (already running) still reports the honest 'looking' copy, not a fabricated promise", async () => {
      // startManualAcquisition's OWN claim() refuses a duplicate for the
      // same key (idempotency lives there, not re-implemented here) — a
      // refusal means a search for this identity is already running.
      acqMock.startManualAcquisition.mockResolvedValue(false);
      acqMock.readAcquisition.mockResolvedValue({
        key: acquisitionKey({ identityStatus: "user_confirmed", manufacturer: "SMC", model: "SS5Y3-DUW01302", catalogNumber: "" }),
        state: "running",
        started_at: new Date().toISOString(),
        finished_at: null,
        candidate_host: null,
        match_state: null,
        oem_request_url: null,
      });
      const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3-DUW01302" }), params);
      expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
      const body = await res.json();
      expect(body.manualReady).toBe(false);
      expect(body.message).toMatch(/look(ing|) for its manual/);
    });

    it("when a refused claim's record does NOT match this identity's key, honestly says no search was started", async () => {
      acqMock.startManualAcquisition.mockResolvedValue(false);
      acqMock.readAcquisition.mockResolvedValue({
        key: "SOMEONE|ELSE|",
        state: "running",
        started_at: new Date().toISOString(),
        finished_at: null,
        candidate_host: null,
        match_state: null,
        oem_request_url: null,
      });
      const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3-DUW01302" }), params);
      const body = await res.json();
      expect(body.message).not.toMatch(/look for its manual/);
      expect(body.message).toMatch(/no (automatic )?(search|manual search) (was )?started/i);
    });

    it("never starts a search, and reports honestly, when acquisition is disabled (flag off)", async () => {
      acqMock.acquisitionEnabled.mockReturnValue(false);
      const res = await POST(req({ manufacturer: "SMC", model: "SS5Y3-DUW01302" }), params);
      expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
      const body = await res.json();
      expect(body.manualReady).toBe(false);
      expect(body.message).not.toMatch(/look for its manual/);
      expect(body.message).toMatch(/no (automatic )?(search|manual search) (was )?started/i);
    });

    it("never starts a search when a manual is already ready — nothing to search for", async () => {
      vi.mocked(listSources).mockResolvedValue([
        { docId: "d1", enabledByDefault: true, matchState: "verified", sourceRole: "manual", readiness: { canChat: true } },
      ] as never);
      await POST(req({ manufacturer: "SMC", model: "SS5Y3-DUW01302" }), params);
      expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    });
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
