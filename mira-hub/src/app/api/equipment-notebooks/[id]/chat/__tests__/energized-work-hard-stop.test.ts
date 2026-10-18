/**
 * TQ-29 (2026-10-17 prod test) — a hands-on ask on a POWERED machine is a hard
 * stop that cites the manual's own lockout page (GS10 p.2-15), with no removal
 * steps and no torques, and no provider call.
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/energized-work-hard-stop.test.ts"
 *
 * The retrieval mock answers the QUESTION with the torque page (what the model
 * would otherwise have been handed) and the lockout query with the WARNING
 * page, so the test can prove the stop cites 2-15 and never leaks 10 in-lb.
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

const TORQUE_CHUNK = {
  content: "Remove the four cover screws (M4). Tighten the cover screws to 10 in-lb (1.1 N·m) on reassembly.",
  docId: DOC_A,
  manufacturer: "",
  modelNumber: "",
  sourceUrl: "node-doc/u1/gs10_manual.pdf",
  sourcePage: 43,
  pageLabel: "4-3",
  chunkIndex: null,
  title: "GS10 User Manual.pdf",
  rank: 0.4,
  verified: true,
};
const LOCKOUT_CHUNK = {
  ...TORQUE_CHUNK,
  content:
    "WARNING! Hazardous voltage. Disconnect all power to the drive and wait at least 5 minutes for the DC bus capacitors to discharge before servicing. Lock out and tag out the disconnect.",
  sourcePage: 25,
  pageLabel: "2-15",
  rank: 0.3,
};

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

const ASK = "Can I swap the cooling fan on the GS10 while it's powered? What torque on the cover screws?";

function providerAnswers(text: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  delete process.env.NOTEBOOK_ENERGIZED_HARD_STOP;
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "GS10 drive", manufacturer: "AutomationDirect", model: "GS10" });
  // The question's own retrieval hands back the torque page; the lockout
  // query (LOCKOUT_PAGE_QUERY) hands back the WARNING page.
  ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, query: unknown) =>
    /lockout tagout/i.test(String(query)) ? [LOCKOUT_CHUNK] : [TORQUE_CHUNK],
  );
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  providerAnswers("Remove the four cover screws and tighten to 10 in-lb on reassembly.");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.NOTEBOOK_ENERGIZED_HARD_STOP;
});

describe("TQ-29 — energized-work ask hard-stops and cites the manual's lockout page", () => {
  it("stops before generation, cites p.2-15, carries no torque or removal step, persists a safety_stop", async () => {
    const res = await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(200);
    const out = await frames(res);

    // No provider call — the stop is served from the deterministic path.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    const safety = out.find((f) => f.kind === "safety") as { trigger: string } | undefined;
    expect(safety).toBeDefined();

    const content = out.filter((f) => f.kind === "content").map((f) => String(f.content)).join("");
    expect(content).toContain("p.2-15");
    expect(content).toContain("GS10 User Manual.pdf");
    expect(content).not.toMatch(/in-lb|N·m|torque|cover screws|remove the/i);

    const status = out.find((f) => f.kind === "status") as { status: string };
    expect(status.status).toBe("answered");

    // The lockout page is the only citation the stop carries.
    const sources = out.find((f) => f.kind === "sources") as { citations: Array<{ page: number | null; docId: string }> };
    expect(sources.citations).toHaveLength(1);
    expect(sources.citations[0].docId).toBe(DOC_A);
    expect(sources.citations[0].page).toBe(25);

    expect(nbMock.recordTurn).toHaveBeenCalledTimes(1);
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as {
      answerStatus: string;
      answerText: string | null;
      basis?: string | null;
      evidence: Array<Record<string, unknown>>;
    };
    expect(persisted.answerStatus).toBe("answered");
    expect(persisted.answerText).toContain("p.2-15");
    expect(persisted.answerText).not.toMatch(/in-lb|torque/i);
    expect(persisted.basis ?? null).toBeNull();
    expect(persisted.evidence.some((e) => e.kind === "safety_stop")).toBe(true);
    expect(persisted.evidence.some((e) => e.kind === "safety_notice")).toBe(true);
  });

  it("with no lockout page in the attached manuals, still stops and points at the site LOTO procedure (never invents a page)", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([TORQUE_CHUNK]);
    const res = await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params);
    const out = await frames(res);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const content = out.filter((f) => f.kind === "content").map((f) => String(f.content)).join("");
    expect(content).toMatch(/site's lockout\/tagout procedure/);
    expect(content).not.toMatch(/p\.\d/);
    const sources = out.find((f) => f.kind === "sources") as { citations: unknown[] };
    expect(sources.citations).toEqual([]);
  });

  it("kill switch NOTEBOOK_ENERGIZED_HARD_STOP=0 restores flag-and-answer (control)", async () => {
    process.env.NOTEBOOK_ENERGIZED_HARD_STOP = "0";
    const res = await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params);
    const out = await frames(res);
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    expect(out.some((f) => f.kind === "safety")).toBe(false);
  });

  it("an ordinary question on the same notebook is answered normally (control)", async () => {
    providerAnswers("Fault oC is an overcurrent trip [1].");
    const res = await POST(req({ message: "what does fault oC mean on the GS10", sourceDocIds: [DOC_A] }), params);
    const out = await frames(res);
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    expect(out.some((f) => f.kind === "safety")).toBe(false);
    // The lockout retrieval only runs for an energized-work ask.
    const lockoutCalls = vi.mocked(ragMock.retrieveNodeChunks).mock.calls.filter((c) => /lockout tagout/i.test(String(c[2])));
    expect(lockoutCalls).toHaveLength(0);
  });
});
