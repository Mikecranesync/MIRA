/**
 * CV-101 journey S6 (2026-11-08, staging b304d5dcf, trace a8b01dd93e30789a38f2895cf26a8be9):
 * a Micro850 question in a notebook holding only the Micro820 manual got the
 * generic "Add the manual for the equipment you're asking about". When retrieval
 * proves the mismatch, the served refusal names both models — and still serves
 * nothing from the Micro820 manual (no provider call, no citation).
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/named-model-mismatch-reply.test.ts"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);


const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
  neutralizeReferenceText: vi.fn((t: string) => t),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

const filesMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async (): Promise<{ fileId: string; capturedAt: string } | null> => null),
}));
vi.mock("@/lib/workspace-files", () => filesMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({ query: vi.fn(async () => ({ rows: [] })) }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "groq", url: "https://x/y", key: "k", model: "m" }]),
  buildRequestBody: vi.fn(() => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage", provider: "groq" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

import { POST } from "../route";

function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && !l.startsWith("data: [DONE]"))
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
}



const S6_ASK = "What are the relay contact ratings at 120 V AC on a Micro850 2080-LC50-48QWB?";

function providerAnswers(text: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue({
    id: NB,
    displayName: "CV-101 conveyor PLC",
    manufacturer: "Rockwell Automation",
    model: "2080-LC20-20QWB",
    identityStatus: "user_confirmed",
  });
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  providerAnswers("At 120 V AC the relay is rated 15 A make.");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Opts = { diagnostics?: Record<string, unknown> };

describe("CV-101 S6 — a wrong-model ask names the mismatch and answers nothing from the wrong manual", () => {
  it("serves insufficient_evidence naming Micro820 vs Micro850, with no provider call and no citation", async () => {
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
      const o = opts as Opts;
      if (o?.diagnostics) o.diagnostics.namedModelMismatch = { requested: ["MICRO850"], declared: ["MICRO820"] };
      return [];
    });
    const out = await frames(await POST(req({ message: S6_ASK, sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const status = out.find((f) => f.kind === "status") as { status: string; message?: string };
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toContain("for the Micro820, not the Micro850 you asked about");
    expect(status.message).not.toMatch(/15 A|1\.5 A/);
    const sources = out.find((f) => f.kind === "sources") as { citations: unknown[] };
    expect(sources.citations).toEqual([]);
  });

  it("control: without proof of a mismatch the generic refusal is unchanged", async () => {
    ragMock.retrieveNodeChunks.mockImplementation(async () => []);
    const out = await frames(await POST(req({ message: S6_ASK, sourceDocIds: [DOC_A] }), params));
    const status = out.find((f) => f.kind === "status") as { status: string; message?: string };
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toBe(
      "I couldn't find support for that in this notebook's manuals. Add the manual for the equipment you're asking about, or the page that covers it, and ask again.",
    );
  });
});

describe("garage pilot L8 (Mike 2026-11-12): a sibling of the record's number is refused by name, from this project's manual", () => {
  it("serves insufficient_evidence naming GS11N-20P2 vs GS13N-20P2, no provider call, no citation, no value", async () => {
    nbMock.getNotebook.mockResolvedValue({
      id: NB, displayName: "Garage GS10", manufacturer: "AutomationDirect", model: "GS10",
      catalogNumber: "GS11N-20P2", identityStatus: "user_confirmed",
    });
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
      const o = opts as Opts;
      if (o?.diagnostics) {
        o.diagnostics.siblingOfRecordAsk = { asked: ["GS13N-20P2"], record: "GS11N-20P2" };
        o.diagnostics.recordNumber = null;
      }
      return [];
    });
    const out = await frames(
      await POST(req({ message: "What is the rated input current of the GS13N-20P2?", sourceDocIds: [DOC_A] }), params),
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const status = out.find((f) => f.kind === "status") as { status: string; message?: string };
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toContain("GS11N-20P2");
    expect(status.message).toContain("GS13N-20P2");
    expect(status.message).toMatch(/manual/i);
    // The harness L8 refusal regex (rules v2) must match the served wording.
    expect(status.message).toMatch(/not (covered|found|in this manual|provided|stated|mentioned|specified|given)|do(es)? not (cover|include|list|provide|state|mention|give|specify)|can(no|['’])?t (answer|find|give|determine|provide)|isn'?t (covered|in)/i);
    expect(status.message).not.toMatch(/\d+(\.\d+)?\s*A\b/);
    const sources = out.find((f) => f.kind === "sources") as { citations: unknown[] };
    expect(sources.citations).toEqual([]);
  });
});

describe("#5355 — two sibling models with no comparison get a which-one question", () => {
  it("serves insufficient_evidence asking SMC-50 or SMC Flex, with no provider call and no citation", async () => {
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
      const o = opts as Opts;
      if (o?.diagnostics) o.diagnostics.ambiguousModelAsk = { named: ["SMC50", "SMCFLEX"] };
      return [];
    });
    const out = await frames(
      await POST(req({ message: "my SMC-50 or SMC Flex flagged fault 10, what is it?", sourceDocIds: [DOC_A] }), params),
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const status = out.find((f) => f.kind === "status") as { status: string; message?: string };
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toContain("Which one is it — the SMC-50 or the SMC Flex?");
    const sources = out.find((f) => f.kind === "sources") as { citations: unknown[] };
    expect(sources.citations).toEqual([]);
  });
});
