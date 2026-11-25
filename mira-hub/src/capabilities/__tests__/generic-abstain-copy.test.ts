/**
 * #5863 (reply wording only): a notebook with a selected, confirmed manual whose
 * search finds nothing for a question was told "Add the manual for the
 * equipment you're asking about". The technician had just added it. The
 * generic reply now gives the steps that can work with the manual already
 * there: the manual's own words, or the section or page. It still names adding
 * a manual for the case where the question is about different equipment.
 *
 * Why the search found nothing for that project is a separate, open defect on
 * #5863; this file pins only the copy.
 *
 * Route-level: the real chat route, retrieval mocked at its seam (the same
 * harness as unlisted-model-refusal-reply.test.ts).
 *
 * Run: npx vitest run src/capabilities/__tests__/generic-abstain-copy.test.ts
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

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

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

// The reported walk question (#5863, 2026-11-24), on a Siemens Basic Panels project.
const ASK = "ktp600 touch is dead but the f keys work. wat now";
const FIRST_SENTENCE = "I couldn't find support for that in this notebook's manuals.";
const OLD_INSTRUCTION = "Add the manual for the equipment you're asking about";

async function ask(message = ASK) {
  const out = await frames(await POST(req({ message, sourceDocIds: [DOC_A] }), params));
  const status = out.find((f) => f.kind === "status") as { status: string; message?: string };
  const sources = out.find((f) => f.kind === "sources") as { citations: unknown[] };
  return { status, sources };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue({
    id: NB,
    displayName: "Basic Panels",
    manufacturer: null,
    model: null,
    identityStatus: "unknown",
  });
  ragMock.retrieveNodeChunks.mockImplementation(async () => []);
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  // If the route ever called a provider here, this is the ungrounded text it would serve.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "Recalibrate the touch screen." } }] })}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    ),
  );
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("#5863: the generic zero-hit reply, with a manual already selected", () => {
  it("precondition: a confirmed source is selected and the search ran and found nothing", async () => {
    await ask();
    expect(nbMock.validateChatSources).toHaveBeenCalled();
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalled();
    const scope = ragMock.retrieveNodeChunks.mock.calls[0][3] as { docIds?: string[] };
    expect(scope.docIds).toEqual([DOC_A]);
  });

  it("keeps the honest first sentence, drops 'add the manual', gives steps that can work", async () => {
    const { status, sources } = await ask();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message!.startsWith(`${FIRST_SENTENCE} `)).toBe(true);
    expect(status.message).not.toContain(OLD_INSTRUCTION);
    expect(status.message).toContain("Try the words the manual uses, or name the section or page");
    // Adding a manual is still the way out when the question is about other equipment.
    expect(status.message).toContain("If the question is about different equipment, add that equipment's manual");
    expect(sources.citations).toEqual([]);
  });

  it("the stored turn carries the same text as the live reply", async () => {
    const { status } = await ask();
    const turns = nbMock.recordTurn.mock.calls.map((c) => (c as unknown[])[2] as { answerStatus: string; answerText: string | null });
    const stored = turns.find((t) => t.answerStatus === "insufficient_evidence");
    expect(stored?.answerText).toBe(status.message);
  });
});
