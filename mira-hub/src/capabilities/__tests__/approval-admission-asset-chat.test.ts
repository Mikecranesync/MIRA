// #3437 — lives outside src/app/** because every test file there is a
// lifecycle-guarded path; the route under test is imported by alias.
// Vitest coverage for POST /api/assets/[id]/chat.
// Regression tests for grounding, safety, and ownership checks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { connect: vi.fn() } }));
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

import { POST } from "@/app/api/assets/[id]/chat/route";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { buildGraphContext } from "@/lib/knowledge-graph/context-builder";
import { retrieveManualChunks, retrieveNodeChunks, appendManualContext } from "@/lib/manual-rag";
import { linkedDocIdsForTarget } from "@/lib/workspace-files";
import {
  approvedAskEnforcementEnabled,
  approvedContextReady,
} from "@/lib/approved-context";
import { KB_GAP_ADMISSION } from "@/lib/kb-gap";

// A stable, unique fragment of the appended admission — used to assert the
// server-side safety net fired (or did not).
const GAP_MARKER = "so MIRA can cite it";

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

// Read the entire SSE stream into a single string (for content assertions).
async function readAll(res: Response): Promise<string> {
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
  return raw;
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

describe("asset chat — approval-gate admission (#3437)", () => {
  it("#3437: attached documents are retrieved by the validated set AND admitted as approved", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    vi.mocked(approvedAskEnforcementEnabled).mockReturnValue(false);
    vi.mocked(buildGraphContext).mockResolvedValue("");
    vi.mocked(retrieveManualChunks).mockResolvedValue([]);
    vi.mocked(linkedDocIdsForTarget).mockResolvedValue(["doc-1", "doc-2"]);
    vi.mocked(retrieveNodeChunks).mockResolvedValue([
      {
        content: "Rated current 1.27 A per phase",
        manufacturer: "",
        modelNumber: "",
        sourceUrl: "node-doc/doc-1/DGII.pdf",
        sourcePage: 43,
        title: "DGII Series Manual",
        rank: 0.9,
        verified: false,
      },
    ] as never);

    const client = mockClient([
      [/SELECT.*FROM cmms_equipment/, { rows: [goodAssetRow] }],
      [/FROM kg_relationships/, { rows: [{ count: 0 }] }],
    ]);
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    await POST(makeReq(userMsg("what is the rated current?")), makeParams(VALID_UUID));

    // Scoped to THIS asset's links...
    expect(linkedDocIdsForTarget).toHaveBeenCalledWith(
      goodSession.tenantId,
      "cmms_asset",
      VALID_UUID,
    );
    // ...and retrieved by the validated doc set, with the node filter bypassed
    // (these chunks carry the node_id they were ingested under, not the asset).
    const opts = vi.mocked(retrieveNodeChunks).mock.calls[0]?.[3] as Record<string, unknown>;
    expect(opts.docIds).toEqual(["doc-1", "doc-2"]);
    expect(opts.validatedDocScope).toBe(true);
    // #3437 — the attachment IS the approval, and retrieval must be told so,
    // or MIRA_ENFORCE_APPROVED_RETRIEVAL (prod) filters every private upload.
    expect(opts.approvedSourceDocIds).toEqual(["doc-1", "doc-2"]);

    const chunks = vi.mocked(appendManualContext).mock.calls[0]?.[1] ?? [];
    expect(chunks.length).toBe(1);
    expect(chunks[0].sourceUrl).toBe("node-doc/doc-1/DGII.pdf");
  });
});
