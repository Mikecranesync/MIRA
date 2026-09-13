/**
 * Gate 1 — asset-chat ownership pre-check fails closed.
 *
 * #2374 added the tenant ownership probe. Its catch used to fall through
 * ("graceful degradation") and continue the chat — a fail-open IDOR when
 * Neon blips. A DB error is now 503: not 404 (would lie about existence)
 * and not a cascade call.
 *
 * Lives in the adapter root; the route's own `__tests__/` is a guarded path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(),
}));
vi.mock("@/lib/session", () => sessionMock);

const poolMock = vi.hoisted(() => ({
  connect: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ default: poolMock }));

vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/knowledge-graph/extractor", () => ({ extractAndStore: vi.fn() }));
vi.mock("@/lib/knowledge-graph/context-builder", () => ({ buildGraphContext: vi.fn() }));
vi.mock("@/lib/workspace-files", () => ({
  linkedDocIdsForTarget: vi.fn(async () => []),
}));
vi.mock("@/lib/manual-rag", () => ({
  retrieveManualChunks: vi.fn(),
  retrieveNodeChunks: vi.fn(async () => []),
  appendManualContext: vi.fn((prompt: string) => prompt),
  buildManualUserContent: vi.fn((content: string) => content),
  chunksToSources: vi.fn(() => []),
  neutralizeReferenceText: vi.fn((text: string) => text),
}));
vi.mock("@/lib/approved-context", () => ({
  approvedAskEnforcementEnabled: vi.fn(() => false),
  approvedContextReady: vi.fn(() => true),
  buildApprovedContextRefusal: vi.fn(() => ({ gate: "approved_context" })),
}));
vi.mock("@/lib/agents/safety-alert", () => ({
  scanBoth: vi.fn(() => null),
  handleSafetyAlert: vi.fn(),
  safetyAlertSseChunk: vi.fn(),
}));
vi.mock("@/lib/machine-context-packet", () => ({
  buildMachineContextPacket: vi.fn().mockResolvedValue(null),
  renderMachineEvidenceSection: vi.fn(() => ""),
}));

import { POST } from "@/app/api/assets/[id]/chat/route";

const ASSET_ID = "11111111-2222-3333-4444-555555555555";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function req(body: unknown): Request {
  return new Request(`https://hub.test/api/assets/${ASSET_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: ASSET_ID }) };

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  process.env.GROQ_API_KEY = "test-key";
  sessionMock.sessionOr401.mockResolvedValue({
    userId: "u_1",
    tenantId: TENANT_ID,
    email: "x@y",
    status: "trial",
    trialExpiresAt: null,
  });
  fetchSpy = vi.fn(async () => {
    throw new Error("LLM / drive-pack fetch must not run when ownership is unverified");
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/assets/[id]/chat — ownership fail-closed", () => {
  it("returns 503 and does not call fetch when the ownership probe throws", async () => {
    const errorClient = {
      query: vi.fn(async () => {
        throw new Error("Connection timeout");
      }),
      release: vi.fn(),
    };
    poolMock.connect.mockResolvedValue(errorClient);

    const res = await POST(req({ messages: [{ role: "user", content: "help" }] }), params);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Asset ownership could not be verified" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorClient.release).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when pool.connect itself throws — still no fetch", async () => {
    poolMock.connect.mockRejectedValue(new Error("pool exhausted"));

    const res = await POST(req({ messages: [{ role: "user", content: "help" }] }), params);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Asset ownership could not be verified" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still hard-stops a LOTO phrase when the ownership probe would throw", async () => {
    poolMock.connect.mockRejectedValue(new Error("pool exhausted"));

    const res = await POST(
      req({
        messages: [
          { role: "user", content: "I see melted insulation on this panel, what should I do?" },
        ],
      }),
      params,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Safety-Stop")).toBe("melted insulation");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(poolMock.connect).not.toHaveBeenCalled();
  });
});
