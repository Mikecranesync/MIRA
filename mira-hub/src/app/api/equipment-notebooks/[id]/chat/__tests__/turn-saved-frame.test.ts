/**
 * #4074 — the live answer carries its PERSISTED turn id back to the client.
 *
 * The `trace` frame's `turnId` is the client request id (or a random UUID),
 * never `equipment_notebook_turns.id`, so a client could not tell which saved
 * row a live answer became. The route now emits one `turn_saved` frame with
 * `turnRowId` — the id `recordTurn` returned — immediately BEFORE `status`,
 * and only when a row was actually persisted with a UUID-shaped id.
 *
 * Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks/\[id\]/chat/__tests__/turn-saved-frame"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
/** The persisted row id: what `recordTurn` returns from the INSERT. */
const ROW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** The client request id the phone minted. Must NOT be mistaken for the row. */
const CID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  claimNotebookTurnRequest: vi.fn(),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  listTurns: vi.fn(async () => [] as unknown[]),
  normalizeNotebookThreadId: (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveManualChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
  neutralizeReferenceText: vi.fn((t: string) => t),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
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

function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

/** Every frame, in wire order, with its position so order can be asserted. */
async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const raw = await res.text();
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const p = line.slice(6);
    if (p === "[DONE]") continue;
    try {
      out.push(JSON.parse(p));
    } catch {
      /* partial */
    }
  }
  return out;
}

const turnSaved = (f: Record<string, unknown>[]) => f.filter((x) => x.kind === "turn_saved");
const indexOfKind = (f: Record<string, unknown>[], kind: string) => f.findIndex((x) => x.kind === kind);

beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  nbMock.recordTurn.mockResolvedValue(ROW);
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(providerStream("Check the DC bus first."), { status: 200 })),
  );
});

describe("#4074 — answered live turn carries the persisted row id", () => {
  it("emits one turn_saved frame with the row id (not the request id) before status", async () => {
    const res = await POST(req({ message: "drive trips", mode: "general", clientRequestId: CID }), params);
    const f = await frames(res);
    const saved = turnSaved(f);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({ kind: "turn_saved", turnRowId: ROW });
    expect(saved[0].turnRowId).not.toBe(CID);
    expect(indexOfKind(f, "turn_saved")).toBeLessThan(indexOfKind(f, "status"));
    expect(f.at(-1)?.kind).not.toBe("turn_saved");
  });

  it("emits no turn_saved frame when recordTurn persisted nothing (null)", async () => {
    nbMock.recordTurn.mockResolvedValue(null);
    const f = await frames(await POST(req({ message: "drive trips", mode: "general", clientRequestId: CID }), params));
    expect(turnSaved(f)).toHaveLength(0);
    expect(f.find((x) => x.kind === "status")).toMatchObject({ status: "answered" });
  });

  it("emits no turn_saved frame when the returned id is not UUID-shaped", async () => {
    nbMock.recordTurn.mockResolvedValue("not-a-uuid");
    const f = await frames(await POST(req({ message: "drive trips", mode: "general", clientRequestId: CID }), params));
    expect(turnSaved(f)).toHaveLength(0);
  });

  it("two devices asking the same question each get their own row id", async () => {
    const other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    nbMock.recordTurn.mockResolvedValueOnce(ROW).mockResolvedValueOnce(other);
    const first = turnSaved(await frames(await POST(req({ message: "drive trips", mode: "general", clientRequestId: CID }), params)));
    const second = turnSaved(await frames(await POST(req({ message: "drive trips", mode: "general", clientRequestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }), params)));
    expect(first[0].turnRowId).toBe(ROW);
    expect(second[0].turnRowId).toBe(other);
  });
});

describe("#4074 — replayed (duplicate clientRequestId) turn returns the ORIGINAL row id", () => {
  it("replay frames carry the stored row id before status", async () => {
    nbMock.claimNotebookTurnRequest.mockResolvedValue({
      status: "replay",
      turn: {
        id: ROW,
        question: "drive trips",
        answerStatus: "answered",
        answerText: "Check the DC bus first.",
        enabledSourceDocIds: [],
        evidence: [],
        model: null,
        basis: "general_reasoning",
      },
    });
    const f = await frames(await POST(req({ message: "drive trips", mode: "general", clientRequestId: CID }), params));
    expect(turnSaved(f)).toEqual([{ kind: "turn_saved", turnRowId: ROW }]);
    expect(indexOfKind(f, "turn_saved")).toBeLessThan(indexOfKind(f, "status"));
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });
});
