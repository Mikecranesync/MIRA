/**
 * Lost usage drain through the REAL notebook-chat handler persists a NULL
 * cost, not $0 (#4978).
 *
 * The route tolerates losing the include_usage final chunk (it arrives AFTER
 * finish_reason "stop"): either the stream closes without it, or the drain
 * read throws (`stream.usage_drain_failed`). Either way the turn was served by
 * a PRICED provider, so a 0 cost would book a paid turn as free. The persisted
 * record must carry costUsdEstimate = null (migration 080; tenantSpendSince's
 * `IS NULL` filter then counts it as unpriced).
 *
 * persistTurnUsage is mocked: this proves the value the route hands the ledger.
 *
 * Run: npx vitest run src/capabilities/__tests__/lost-usage-cost-null.route.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  recordTurn: vi.fn(async () => undefined),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  getNotebook: vi.fn(async () => ({
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "PF525 — Line 1",
    manufacturer: "Allen-Bradley",
    model: "PowerFlex 525",
  })),
  listSources: vi.fn(async () => [{ filename: "PF525.pdf", docId: "33333333-3333-4333-8333-333333333333" }]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
const poolMock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/db", () => ({ default: poolMock }));

const persistMock = vi.hoisted(() => ({
  persistTurnUsage: vi.fn(async () => ({ persisted: true, traceId: "trace-1" })),
}));
vi.mock("@/lib/inference/persist-usage", () => persistMock);

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

const declared = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../tools/review_router/prices.json"), "utf8"),
).usd_per_mtok as Record<string, { input: number; cached_input: number; output: number }>;

const chatReq = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: Promise.resolve({ id: NB }) };

/**
 * Provider SSE stream, one chunk per pull(), so the stop chunk is READ before
 * the stream ends. `tail` decides what happens after the stop chunk:
 *  - "usage": a usage chunk then [DONE] (the normal include_usage shape)
 *  - "close": the stream simply closes — the usage frame never arrives
 *  - "error": the next read rejects — the post-stop drain fails
 */
function providerStream(text: string, tail: "usage" | "close" | "error", usage?: Record<string, unknown>): Response {
  const chunks = [
    ...text.split(" ").map((w) => `data: ${JSON.stringify({ choices: [{ delta: { content: w + " " } }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    ...(tail === "usage" ? [`data: ${JSON.stringify({ choices: [], usage })}\n\n`, "data: [DONE]\n\n"] : []),
  ];
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) {
        c.enqueue(enc.encode(chunks[i++]));
        return;
      }
      if (tail === "error") c.error(new Error("socket hang up"));
      else c.close();
    },
  });
  return new Response(body, { status: 200 });
}

async function drain(res: Response): Promise<void> {
  await res.text();
}

async function persistedUsage(): Promise<Record<string, unknown>> {
  await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
  const [, usage] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
  return usage;
}

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.MIRA_CANONICAL_SEAM = "1";
  process.env.OPENAI_API_KEY = "k-openai";
  process.env.OPENAI_MODEL = "gpt-5.4-mini";
  process.env.GROQ_API_KEY = "k1";
  process.env.CEREBRAS_API_KEY = "k2";
  process.env.TOGETHERAI_API_KEY = "k3";
  process.env.NOTEBOOK_ANSWER_GATE = "0";
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue([
    { docId: DOC_A, filename: "PF525.pdf", page: 87, content: "Fault F004 indicates DC bus undervoltage." },
  ] as never);
  persistMock.persistTurnUsage.mockResolvedValue({ persisted: true, traceId: "trace-1" } as never);
});
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 20));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...ENV };
});

describe("notebook chat — lost OpenAI usage persists a NULL cost (#4978)", () => {
  it("stream closes after stop with no usage frame → persisted cost is null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("DC bus undervoltage [1]", "close")));
    await drain(await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params));
    const usage = await persistedUsage();

    // Preconditions: OpenAI served it, on the first and only call (no fallback).
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("api.openai.com");
    expect(usage.provider).toBe("OpenAI");
    expect(usage.model).toBe("gpt-5.4-mini");
    expect(usage.inputTokens).toBeNull();
    expect(usage.outputTokens).toBeNull();

    expect(usage.costUsdEstimate).toBeNull();
  });

  it("post-stop usage drain THROWS → persisted cost is null", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("DC bus undervoltage [1]", "error")));
    await drain(await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params));
    const usage = await persistedUsage();

    // Preconditions: the drain-failure path ran, and it did not fall back.
    expect(warn.mock.calls.some((c) => String(c[0]).includes("stream.usage_drain_failed"))).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(usage.provider).toBe("OpenAI");
    expect(usage.model).toBe("gpt-5.4-mini");

    expect(usage.costUsdEstimate).toBeNull();
  });

  it("CONTROL: the usage frame arrives → persisted cost is the declared gpt-5.4-mini price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        providerStream("DC bus undervoltage [1]", "usage", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }),
      ),
    );
    await drain(await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params));
    const usage = await persistedUsage();

    expect(usage.provider).toBe("OpenAI");
    expect(usage.inputTokens).toBe(1_000_000);
    expect(usage.outputTokens).toBe(1_000_000);
    const p = declared["gpt-5.4-mini"];
    expect(Number(usage.costUsdEstimate)).toBeCloseTo(p.input + p.output, 6);
  });
});
