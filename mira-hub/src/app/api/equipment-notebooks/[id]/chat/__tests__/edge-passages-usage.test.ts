/**
 * #5265 / Codex #5266 F7 — a passage-served edge turn records an honest,
 * non-error usage row, with the REAL usage helpers (canonical-cascade is not
 * mocked here), whether the canonical seam is on or off.
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/edge-passages-usage.test.ts"
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

const HOWTO_CHUNK = {
  content:
    "Weighing the aircraft. Drain the fuel, fill the oil, place the aircraft level on the scales, record each scale reading, and divide the total moment by the total weight to find the empty weight CG.",
  docId: DOC_A,
  manufacturer: "",
  modelNumber: "",
  sourceUrl: "node-doc/u1/faa-h-8083-1b.pdf",
  sourcePage: 43,
  pageLabel: "3-9",
  chunkIndex: null,
  title: "FAA-H-8083-1B Weight and Balance.pdf",
  rank: 0.4,
  verified: true,
};
// An index page: dotted leader lines and page numbers, no instruction.
const INDEX_CHUNK = {
  ...HOWTO_CHUNK,
  content:
    "E6-B flight compute .......................... 10-1 effects of weight ............................ 1-3 electronic calculator ................... 10-2",
  sourcePage: 111,
  pageLabel: "I-3",
  rank: 0.5,
};

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
  neutralizeReferenceText: vi.fn((t: string) => t),
  retrieveCitedPageChunks: vi.fn(async () => [] as unknown[]),
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
const persistMock = vi.hoisted(() => ({ persistTurnUsage: vi.fn(async () => undefined) }));
vi.mock("@/lib/inference/persist-usage", () => persistMock);


import { POST } from "../route";
import { EDGE_PASSAGES_LEAD } from "@/capabilities/edge-passages";
import { RESTART_BANNER } from "@/capabilities/restart-advisory";

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

const contentOf = (f: Record<string, unknown>[]) =>
  f.filter((x) => x.kind === "content").map((x) => String(x.content)).join("");

const ASK = "How do I find the empty weight center of gravity?";

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
  delete process.env.GROQ_API_KEY;
  process.env.MIRA_PROFILE = "edge";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Aircraft weight and balance", manufacturer: "FAA", model: "FAA-H-8083-1B" });
  ragMock.retrieveNodeChunks.mockResolvedValue([INDEX_CHUNK, HOWTO_CHUNK]);
  ragMock.retrieveCitedPageChunks.mockResolvedValue([]);
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  providerAnswers("Use the equipment list.");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.MIRA_PROFILE;
  delete process.env.NOTEBOOK_ANSWER_GATE;
});

type Usage = { provider: string | null; model: string | null; routeReason: string; status: string };
const persistedUsage = async (): Promise<Usage> => {
  await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
  return (persistMock.persistTurnUsage.mock.calls[0] as unknown as unknown[])[1] as Usage;
};
const EXPECTED = { provider: null, model: null, routeReason: "edge_verbatim_passages", status: "empty" };

describe("#5265 edge passage turns record honest usage (Codex #5266 F7)", () => {
  afterEach(() => delete process.env.MIRA_CANONICAL_SEAM);

  it.each([
    ["seam on, usable passage", "1", () => [INDEX_CHUNK, HOWTO_CHUNK], "answered"],
    ["seam on, index only", "1", () => [INDEX_CHUNK], "insufficient_evidence"],
    ["seam off, usable passage", undefined, () => [INDEX_CHUNK, HOWTO_CHUNK], "answered"],
  ])("%s", async (_label, seam, retrieved, status) => {
    if (seam) process.env.MIRA_CANONICAL_SEAM = seam;
    ragMock.retrieveNodeChunks.mockResolvedValue(retrieved());
    const out = await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect((out.find((f) => f.kind === "status") as { status: string }).status).toBe(status);
    const frame = out.find((f) => f.kind === "usage") as Usage | undefined;
    if (seam) expect(frame).toMatchObject(EXPECTED);
    else expect(frame).toBeUndefined(); // the legacy frame sequence carries no usage frame
    expect(await persistedUsage()).toMatchObject(EXPECTED);
  });
});
