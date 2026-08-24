/**
 * Universal Technician slice 1 — "Ask MIRA without an asset".
 *
 * Run: npx vitest run src/app/api/equipment-notebooks
 *
 * Spec: docs/specs/mira-technician-app-dogfood-system.md §1.1–§1.4.
 *
 * The two failure modes this pins are opposites, and both are easy to ship:
 *   1. General mode never arrives — a technician with no manual still hits
 *      `no_sources_selected` and gets nothing (§1.1 violated).
 *   2. General mode arrives by quietly loosening the Notebook — source-free
 *      model reasoning rendered as if it were an OEM citation (§1.3/§1.4
 *      violated).
 *
 * So the grounded assertions here matter as much as the general ones.
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
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(providerStream("Check the DC bus first."), { status: 200 })),
  );
});

describe("general mode — §1.1 the technician with nothing configured", () => {
  beforeEach(() => nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" }));

  it("answers with no sources attached, instead of 422", async () => {
    const res = await POST(req({ message: "ABB drive trips on acceleration", mode: "general" }), params);
    expect(res.status).toBe(200);
    const f = await frames(res);
    expect(f.find((x) => x.kind === "status")).toMatchObject({ status: "answered" });
    expect(f.filter((x) => x.kind === "content").map((x) => x.content).join("")).toContain("DC bus");
  });

  it("labels the answer as general reasoning, never as documentation", async () => {
    const res = await POST(req({ message: "drive trips", mode: "general" }), params);
    const ev = (await frames(res)).find((x) => x.kind === "evidence");
    expect(ev).toMatchObject({ basis: "general_reasoning" });
    expect(String(ev?.label)).toMatch(/not grounded/i);
  });

  it("ships ZERO citations even when the model emits [n] anyway", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(providerStream("Check the DC bus [1] and the fan [2]."), { status: 200 })),
    );
    const res = await POST(req({ message: "drive trips", mode: "general" }), params);
    const f = await frames(res);
    expect(f.find((x) => x.kind === "sources")).toMatchObject({ citations: [] });
    // …and the markers are stripped, so no chip renders pointing at nothing.
    const answer = f.filter((x) => x.kind === "content").map((x) => x.content).join("");
    expect(answer).not.toMatch(/\[\d+\]/);
  });

  it("reads no sources at all — no retrieval SQL", async () => {
    await POST(req({ message: "drive trips", mode: "general" }), params);
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
  });

  it("still hard-stops on safety, before any provider call", async () => {
    const res = await POST(
      req({ message: "there is smoke from the drive panel, what do I check", mode: "general" }),
      params,
    );
    const f = await frames(res);
    expect(f.find((x) => x.kind === "safety")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("proves the notebook is the caller's before spending a provider call", async () => {
    // no_sources_selected is returned before any DB read, so it cannot stand in
    // for ownership — otherwise any notebook id spends this tenant's budget.
    nbMock.getNotebook.mockResolvedValue(null);
    const res = await POST(req({ message: "drive trips", mode: "general" }), params);
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("grounded mode — §1.4 unchanged by any of this", () => {
  it("still refuses a source-free notebook rather than answering generally", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    const res = await POST(req({ message: "drive trips" }), params); // no mode
    expect(res.status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still abstains with sources selected but nothing retrieved — no provider call", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: ["d1"], nodeId: "n1" });
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    const res = await POST(req({ message: "what is P042" }), params);
    const f = await frames(res);
    expect(f.find((x) => x.kind === "status")).toMatchObject({ status: "insufficient_evidence" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
