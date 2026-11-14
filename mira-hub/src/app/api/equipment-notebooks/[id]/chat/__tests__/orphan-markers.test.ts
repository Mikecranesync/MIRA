/**
 * #4750 — a document-grounded turn that ships ZERO citations is labelled
 * "general_reasoning" but used to keep raw "[4]" markers in its text, so the
 * technician read "General guidance" with a dangling citation number.
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/orphan-markers.test.ts"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  // 085: chat citations resolve canonical origin server-side
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
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

/** A provider SSE stream that emits `text` as one delta, then [DONE]. */
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


beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: ["d1"], nodeId: "n1" });
  ragMock.retrieveNodeChunks.mockResolvedValue([
    { docId: "d1", filename: "PF525.pdf", page: 87, content: "Fault F004 is DC bus undervoltage." },
  ]);
});

async function ask(answer: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream(answer), { status: 200 })));
  const f = await frames(await POST(req({ message: "what is F004" }), params));
  const shown = f.filter((x) => x.kind === "content").map((x) => String(x.content ?? "")).join("");
  const stored = (nbMock.recordTurn.mock.calls.at(-1) as unknown[] | undefined)?.[2] as
    | { answer?: string; basis?: string | null }
    | undefined;
  return { f, shown, stored };
}

describe("#4750 orphan citation markers on a grounded turn", () => {
  it("strips [4] / [2][5] from the shown AND stored text when no citation is emitted", async () => {
    const { f, shown, stored } = await ask("The drive faults on DC bus undervoltage [4]. Check the supply [2][5].");
    expect(f.find((x) => x.kind === "sources")).toMatchObject({ citations: [] });
    expect(stored?.basis ?? null).not.toBe("oem_documentation");
    expect(shown).toContain("DC bus undervoltage");
    expect(shown).not.toMatch(/\[\d+\]/);
    expect(stored?.answer ?? "").not.toMatch(/\[\d+\]/);
  });

  it("CONTROL: keeps [1] when it resolves to an emitted citation", async () => {
    const { f, shown, stored } = await ask("F004 is DC bus undervoltage [1].");
    expect((f.find((x) => x.kind === "sources") as { citations: unknown[] }).citations).toHaveLength(1);
    expect(stored?.basis).toBe("oem_documentation");
    expect(shown).toContain("[1]");
  });
});
