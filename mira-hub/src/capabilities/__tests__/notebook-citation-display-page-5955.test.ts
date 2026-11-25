/**
 * #5955 (display only) — the notebook chat citation chip must show the same
 * page the prompt excerpt shows: `displayPage(c)`, which hides a page number
 * that is only the chunk's ordinal (a mis-stamp), instead of the raw stored
 * `source_page`. The citation NUMBERING must stay keyed on the raw page so
 * `[n]` in the answer keeps pointing at the same chunk.
 *
 * Lives under `src/capabilities/__tests__/` (not the route's own `__tests__/`)
 * because the Legacy UI Lifecycle Guard flags a sibling test of `route.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  resolveBoundAsset: vi.fn(async (): Promise<Record<string, unknown>> => ({ state: "unbound" })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

vi.mock("@/lib/visual-evidence-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/visual-evidence-context")>("@/lib/visual-evidence-context");
  return { ...actual, loadVisualEvidenceForAsset: vi.fn(async () => [] as unknown[]) };
});

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

vi.mock("@/lib/inference/canonical-cascade", () => ({
  canonicalSeamEnabled: vi.fn(() => false),
  canonicalProviders: vi.fn(() => []),
  buildRequestBody: vi.fn(() => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));

import { POST, chunkCitationIds } from "@/app/api/equipment-notebooks/[id]/chat/route";

function providerStream(text: string) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      out.push(JSON.parse(line.slice(6)));
    } catch {
      /* [DONE] / partial */
    }
  }
  return out;
}

const params = { params: Promise.resolve({ id: NB }) };
const req = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const chunk = (sourcePage: number | null, chunkIndex: number | null, content: string) => ({
  docId: DOC_A,
  sourceUrl: "520-um001_-en-e.pdf",
  sourceTitle: "PowerFlex 525 manual",
  sourcePage,
  chunkIndex,
  content,
});

type Cite = { citationId: string; page: number | null };
const citesOf = (fr: Record<string, unknown>[]) => (fr.find((f) => f.kind === "sources")?.citations ?? []) as Cite[];

beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.GROQ_API_KEY = "test-key";
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
});

describe("#5955 notebook citation chip page", () => {
  it("hides a mis-stamped page (sourcePage === chunkIndex) and keeps a real one", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([
      chunk(715, 715, "F004 is DC bus undervoltage."),
      chunk(161, 40, "F004 UnderVoltage: check the supply."),
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("F004 is undervoltage [1][2]."), { status: 200 })));
    const cites = citesOf(await frames(await POST(req({ message: "what is F004" }), params)));
    expect(cites.map((c) => c.citationId)).toEqual(["1", "2"]);
    expect(cites[0].page).toBeNull(); // mis-stamp: not shown
    expect(cites[1].page).toBe(161); // real page: shown
  });

  it("numbers by the RAW page: two mis-stamped pages of one document stay two citations", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([chunk(715, 715, "A"), chunk(672, 672, "B")]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("A [1] B [2]."), { status: 200 })));
    const cites = citesOf(await frames(await POST(req({ message: "what is F004" }), params)));
    expect(cites.map((c) => c.citationId)).toEqual(["1", "2"]);
    expect(cites.map((c) => c.page)).toEqual([null, null]);
  });
});

describe("#5955 chunkCitationIds — the rating gate matches by citationId, never by page", () => {
  it("gives each chunk the id of its raw-page citation; two null-display pages do not collide", () => {
    const a = chunk(715, 715, "A");
    const b = chunk(672, 672, "B");
    const a2 = chunk(715, 715, "A again");
    expect(chunkCitationIds([a, b, a2] as never)).toEqual(["1", "2", "1"]);
  });
});
