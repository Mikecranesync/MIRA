// Vitest coverage for POST /api/assets/[id]/chat.
// Regression tests for grounding, safety, and ownership checks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { connect: vi.fn() } }));
vi.mock("@/lib/knowledge-graph/extractor", () => ({ extractAndStore: vi.fn() }));
vi.mock("@/lib/knowledge-graph/context-builder", () => ({ buildGraphContext: vi.fn() }));
vi.mock("@/lib/manual-rag", () => ({
  retrieveManualChunks: vi.fn(),
  appendManualContext: vi.fn((prompt: string) => prompt),
  buildManualUserContent: vi.fn((content: string) => content),
  chunksToSources: vi.fn((chunks: Array<{ title?: string; sourceUrl?: string; sourcePage?: number | null; verified?: boolean }>) =>
    chunks.map((chunk, index) => ({
      index: index + 1,
      title: chunk.title ?? "manual",
      url: chunk.sourceUrl ?? null,
      page: chunk.sourcePage ?? null,
      verified: chunk.verified === true,
    })),
  ),
  neutralizeReferenceText: vi.fn((text: string) =>
    text
      .replace(/---\s*\[\s*\d+\s*\][^\n]*?---/gi, "[REF_DELIMITER]")
      .replace(/\[Source:[^\]]+\]/gi, "[ref]"),
  ),
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

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { buildGraphContext } from "@/lib/knowledge-graph/context-builder";
import { retrieveManualChunks, appendManualContext } from "@/lib/manual-rag";
import { approvedAskEnforcementEnabled } from "@/lib/approved-context";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const TENANT_ID = "tenant-aaaa-bbbb";

const goodSession = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

const makeReq = (body: unknown) =>
  new Request(`https://hub.test/api/assets/${VALID_UUID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

const userMsg = (content: string) => ({ messages: [{ role: "user", content }] });

let fetchSpy: ReturnType<typeof vi.fn>;

async function drain(res: Response): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}

// Mock client factory for test handlers
function mockClient(handlers: Array<[RegExp, { rows: unknown[] }]>) {
  return {
    query: vi.fn(async (sql: string) => {
      for (const [re, res] of handlers) if (re.test(sql)) return res;
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

// The route now calls fetch() twice on the "reaches the cascade" path: once
// for the drive-pack pre-check (#2527) and once for the LLM provider. A bare
// `fetchSpy.mockResolvedValue(sameResponseInstance)` breaks because the same
// Response object's body gets consumed by the first call (drive-pack .json())
// and is then unreadable for the second (provider .body.getReader()). This
// helper differentiates by URL and returns a fresh Response per call.
function mockFetchNoMatchThenProvider(providerBody: string) {
  fetchSpy.mockImplementation(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("/drive-pack/ask")) {
      return new Response(JSON.stringify({ matched: false, answer_source: "none" }), {
        status: 200,
      });
    }
    return new Response(providerBody, { status: 200 });
  });
}

const goodAssetRow = {
  equipment_number: "MTR-101",
  manufacturer: "FactoryLM",
  model_number: "M100",
  serial_number: "S100",
  equipment_type: "Motor",
  location: "Plant.Line",
  criticality: "high",
  description: "Line Motor",
  installation_date: null,
  last_maintenance_date: null,
  last_reported_fault: null,
  work_order_count: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  process.env.GROQ_API_KEY = "test-key";
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/assets/[id]/chat", () => {
  it("503 when DB not configured", async () => {
    delete process.env.NEON_DATABASE_URL;
    const res = await POST(
      makeReq(userMsg("help")),
      makeParams(VALID_UUID)
    );
    expect(res.status).toBe(503);
  });

  it("401 passthrough when unauthenticated", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never
    );
    const res = await POST(
      makeReq(userMsg("help")),
      makeParams(VALID_UUID)
    );
    expect(res.status).toBe(401);
  });

  it("400 when messages array is missing", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    const res = await POST(
      makeReq({}),
      makeParams(VALID_UUID)
    );
    expect(res.status).toBe(400);
  });

  it("400 when messages array is empty", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    const res = await POST(
      makeReq({ messages: [] }),
      makeParams(VALID_UUID)
    );
    expect(res.status).toBe(400);
  });

  it("hard-stops on a physical-hazard phrase (safety stop)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    const res = await POST(
      makeReq(userMsg("I see melted insulation on this panel, what should I do?")),
      makeParams(VALID_UUID)
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Safety-Stop")).toBe("melted insulation");
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    // Safety stop should emit SSE-formatted response
    let raw = "";
    const reader = res.body?.getReader();
    const dec = new TextDecoder();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
      }
    }

    // The safety stop is streamed word-by-word, so look for the component words
    expect(raw).toContain("SAFETY");
    expect(raw).toContain("STOP");
    expect(raw).toContain("[DONE]");
    // Safety stop should NOT call fetch (provider)
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("filters unverified manual chunks when approved enforcement is enabled", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    vi.mocked(approvedAskEnforcementEnabled).mockReturnValue(true);
    vi.mocked(buildGraphContext).mockResolvedValue("");

    vi.mocked(retrieveManualChunks).mockResolvedValue([
      {
        content: "Approved bearing reset steps",
        manufacturer: "FactoryLM",
        modelNumber: "M100",
        sourceUrl: "https://docs.test/approved",
        sourcePage: 2,
        title: "Approved Manual",
        rank: 0.9,
        verified: true,
      },
      {
        content: "Draft-only bypass procedure",
        manufacturer: "FactoryLM",
        modelNumber: "M100",
        sourceUrl: "https://docs.test/draft",
        sourcePage: 3,
        title: "Draft Manual",
        rank: 0.8,
        verified: false,
      },
    ]);

    const client = mockClient([
      [/SELECT.*FROM cmms_equipment/, { rows: [goodAssetRow] }],
      [/FROM kg_relationships/, { rows: [{ count: 0 }] }],
    ]);
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    await POST(
      makeReq(userMsg("what does this fault mean?")),
      makeParams(VALID_UUID)
    );

    // appendManualContext should have been called with filtered chunks (only verified=true)
    expect(appendManualContext).toHaveBeenCalled();
    const chunks = vi.mocked(appendManualContext).mock.calls[0]?.[1] ?? [];
    expect(chunks.length).toBe(1);
    expect(chunks[0].verified).toBe(true);
  });

  it("allows KG relationship context when relationships exist", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    vi.mocked(buildGraphContext).mockResolvedValue("[KG] verified relationship context");
    vi.mocked(retrieveManualChunks).mockResolvedValue([]);
    mockFetchNoMatchThenProvider('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');

    const client = mockClient([
      [/SELECT.*FROM cmms_equipment/, { rows: [goodAssetRow] }],
      [/FROM kg_relationships/, { rows: [{ count: 1 }] }],
    ]);
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const res = await POST(
      makeReq(userMsg("what does this fault mean?")),
      makeParams(VALID_UUID)
    );

    expect(res.status).toBe(200);
    await drain(res);
    expect(fetchSpy).toHaveBeenCalled();
  });

  // ── Ownership regression tests (#2374) ──────────────────────────────────
  // These tests verify that the asset ownership pre-check works correctly
  // and that DB errors are handled gracefully (do not convert to 404).

  it("returns 404 when the asset is not owned by the caller's tenant", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    // Mock pool.connect() to return a client that returns no rows for the ownership check
    const client = mockClient([[/FROM cmms_equipment/, { rows: [] }]]);
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const res = await POST(
      makeReq(userMsg("help")),
      makeParams(VALID_UUID)
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Asset not found");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 200 streaming response when the asset is owned by the caller", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    vi.mocked(buildGraphContext).mockResolvedValue("");
    vi.mocked(retrieveManualChunks).mockResolvedValue([]);
    mockFetchNoMatchThenProvider('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');

    // Mock pool.connect() to return a client that has the asset for the owner
    const client = mockClient([
      [
        /SELECT 1 FROM cmms_equipment/,
        {
          rows: [{ "?column?": 1 }],  // Owned by this tenant
        },
      ],
      [
        /SELECT.*FROM cmms_equipment/,
        {
          rows: [goodAssetRow],
        },
      ],
      [/FROM kg_relationships/, { rows: [{ count: 0 }] }],
    ]);
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const res = await POST(
      makeReq(userMsg("help")),
      makeParams(VALID_UUID)
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await drain(res);
  });

  it("does NOT return 404 when DB error occurs during ownership check (graceful degradation)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    vi.mocked(buildGraphContext).mockResolvedValue("");
    vi.mocked(retrieveManualChunks).mockResolvedValue([]);
    mockFetchNoMatchThenProvider('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');

    // Mock pool.connect to return a client whose query() throws
    const errorClient = {
      query: vi.fn(async () => {
        throw new Error("Connection timeout");
      }),
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValue(errorClient as never);

    const res = await POST(
      makeReq(userMsg("help")),
      makeParams(VALID_UUID)
    );

    // DB error should NOT convert to 404 — the route falls through to graceful degradation
    expect(res.status).not.toBe(404);
    // Confirm it tries to proceed (200 or 412 depending on context)
    expect([200, 412, 503]).toContain(res.status);
  });

  // ── Drive-pack pre-check regression tests (#2527) ───────────────────────
  // The route pre-checks the read-only drive-pack answer service before the
  // LLM cascade. A match short-circuits with the pack's cited answer; a
  // non-match or any error falls straight through to the existing cascade.

  it("drive-pack match short-circuits the cascade with a cited answer", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    vi.mocked(buildGraphContext).mockResolvedValue("");
    vi.mocked(retrieveManualChunks).mockResolvedValue([]);

    fetchSpy.mockImplementation(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/drive-pack/ask")) {
        return new Response(
          JSON.stringify({
            matched: true,
            answer_source: "drive_pack",
            answer: "GS10 fault CE10 — modbus timeout...",
            citations: [{ doc: "DURApulse GS10 User Manual", page: "4-188" }],
            pack_id: "durapulse_gs10",
            fallback_used: false,
            live_telemetry: false,
            read_only: true,
          }),
          { status: 200 },
        );
      }
      throw new Error("LLM provider cascade should not be called on a drive-pack match");
    });

    const client = mockClient([
      [/SELECT 1 FROM cmms_equipment/, { rows: [{ "?column?": 1 }] }],
      [/SELECT.*FROM cmms_equipment/, { rows: [goodAssetRow] }],
      [/FROM kg_relationships/, { rows: [{ count: 0 }] }],
    ]);
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const res = await POST(
      makeReq(userMsg("what does CE10 mean on my gs10")),
      makeParams(VALID_UUID)
    );

    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("X-Drive-Pack")).toBe("durapulse_gs10");

    let raw = "";
    const reader = res.body?.getReader();
    const dec = new TextDecoder();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
      }
    }
    expect(raw).toContain("GS10 fault CE10");
    expect(raw).toContain("[Source: DURApulse GS10 User Manual p.4-188]");
    expect(raw.trim().endsWith("data: [DONE]")).toBe(true);

    // Only the drive-pack pre-check fetch happened — the LLM cascade never ran.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("drive-pack no-match falls through to the existing LLM cascade", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    vi.mocked(buildGraphContext).mockResolvedValue("");
    vi.mocked(retrieveManualChunks).mockResolvedValue([]);
    mockFetchNoMatchThenProvider('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');

    const client = mockClient([
      [/SELECT 1 FROM cmms_equipment/, { rows: [{ "?column?": 1 }] }],
      [/SELECT.*FROM cmms_equipment/, { rows: [goodAssetRow] }],
      [/FROM kg_relationships/, { rows: [{ count: 0 }] }],
    ]);
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const res = await POST(
      makeReq(userMsg("what is a proximity sensor")),
      makeParams(VALID_UUID)
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Drive-Pack")).toBeNull();
    await drain(res);

    // The drive-pack pre-check fired (no match) AND the cascade provider fired.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("drive-pack endpoint error falls through to the existing LLM cascade", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    vi.mocked(buildGraphContext).mockResolvedValue("");
    vi.mocked(retrieveManualChunks).mockResolvedValue([]);

    fetchSpy.mockImplementation(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/drive-pack/ask")) {
        throw new Error("connection refused");
      }
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
      });
    });

    const client = mockClient([
      [/SELECT 1 FROM cmms_equipment/, { rows: [{ "?column?": 1 }] }],
      [/SELECT.*FROM cmms_equipment/, { rows: [goodAssetRow] }],
      [/FROM kg_relationships/, { rows: [{ count: 0 }] }],
    ]);
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const res = await POST(
      makeReq(userMsg("help")),
      makeParams(VALID_UUID)
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Drive-Pack")).toBeNull();
    await drain(res);
  });
});
