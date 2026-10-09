/** ASI-001: backend provider-request regression, not a legacy UI test. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  listTurns: vi.fn(async () => []),
  normalizeNotebookThreadId: (v: unknown) => typeof v === "string" ? v : null,
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
  buildManualUserContent: vi.fn((q: string, _chunks: unknown[], look?: string) => look ? `${look}\n\n${q}` : q),
  corpusManufacturers: vi.fn(async () => []),
  resolveModelFromObservationText: vi.fn(() => ({ model: null, ambiguous: false })),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "groq", url: "https://x/y", key: "k", model: "m" }]),
  buildRequestBody: vi.fn((..._args: unknown[]) => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage", provider: "groq" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

const visualMock = vi.hoisted(() => ({
 photoLinkedToTarget: vi.fn(async () => ({ fileId: "44444444-4444-4444-8444-444444444444", capturedAt: "2026-10-09T00:00:00Z" })),
 loadVisualEvidenceForPhoto: vi.fn(),
}));
vi.mock("@/lib/workspace-files", () => ({ photoLinkedToTarget: visualMock.photoLinkedToTarget }));
vi.mock("@/lib/visual-evidence-context", async (original) => ({
 ...(await original<typeof import("@/lib/visual-evidence-context")>()),
 loadVisualEvidenceForPhoto: visualMock.loadVisualEvidenceForPhoto,
 loadRecentLookObservations: vi.fn(async () => []),
}));
import { POST } from "../app/api/equipment-notebooks/[id]/chat/route";

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
const envBefore = { ...process.env };
afterEach(() => { process.env = { ...envBefore }; vi.unstubAllGlobals(); });

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
  // This suite pins its own seam (not the semantic judge, which is owned by
  // chat-answer-gate.test.ts). Iteration-9 judges EVERY served answer, so
  // disable the layer here rather than stub a judge in every test.
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(providerStream("Check the DC bus first."), { status: 200 })),
  );
});


describe("field indication through the real notebook route", () => {
 it.each(["A blue and yellow industrial module mounted on a DIN rail. Top-left has an RJ45-style port labeled 'chip card' and 'ethernet' with a green LED lit inside. A row of indicator LEDs below is labeled 'power', 'Profinet', 'config error', 'U ASi', 'ASi active', 'prg enable', 'prj mode'. The 'power' and 'Profinet' LEDs are lit green; the 'config error' LED is lit red; 'U ASi' and 'ASi active' are lit green; 'prg enable' and 'prj mode' appear unlit. A backlit LCD display shows the text 'List of Config. errors' with a row of pixelated characters and '2A- 1 3A- \u2193' below. The front face is labeled 'Bihler + Wiedemann', 'ASi 5', 'PROFINET', and a yellow sticker reads '=EQU+96 -A57'. Four round buttons are labeled 'ESC Service', 'Mode' (up arrow), 'Set' (down arrow), and 'OK'. A yellow side panel is labeled 'ASi Safety Integrated' with a grid of small round indicators labeled 'AUX', 'SI1' through 'SI6', and 'SO1' through 'SO6'; none of these indicators appear lit. Terminal markings on the yellow panel include 'T1', 'T2', 'SI1'\u2013'SI6', 'SO1'\u2013'SO6', '24V', '0V'. Bottom terminals are labeled '+ASi1-', '+ASi1-', '+ASi1-', 'ASi +PWR-', and a ground symbol. Black pluggable terminal blocks are seated at the top right and bottom right. Yellow and purple wires are inserted into the bottom terminal block. No visible damage, corrosion, burn marks, moisture, or loose hardware.", "Label appears to read Ni8U-S12-AP6; indicator is red"])("answers an indication report with its linked LOOK context", async (text) => {
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({ observationId: "obs", sessionId: "session", text, obsKind: "look", trust: "candidate", fileId: "44444444-4444-4444-8444-444444444444", hazards: [] });
  const res = await POST(req({ message: "I think this means I just need to use a handheld on that seat. It's white on the tablet instead of being green", mode: "general", visualEvidence: { fileId: "44444444-4444-4444-8444-444444444444" } }), params);
  const output = await frames(res);
  expect(res.status).toBe(200);
  expect(output.some((f) => f.kind === "content")).toBe(true);
  expect(output.some((f) => f.kind === "status" && f.status === "insufficient_evidence")).toBe(false);
  expect(seamMock.buildRequestBody).toHaveBeenCalled();
  const messages = seamMock.buildRequestBody.mock.calls.at(-1)?.[1] as { content: string }[];
  expect(messages.some((m) => m.content.includes(text))).toBe(true);
 });
 it.each(["Can I use my M12 instead of this S12? It is white instead of green.", "Is white wire OK instead of green wire?", "Can I use a sensor that is rated for 24 V instead of 12 V?", "Can I install an LED that is white instead of green?"])("still refuses unsupported substitution: %s", async (message) => {
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({ observationId: "obs", sessionId: "session", text: "Label appears to read Ni8U-S12-AP6", obsKind: "look", trust: "candidate", fileId: "44444444-4444-4444-8444-444444444444", hazards: [] });
  const res = await POST(req({ message, mode: "general", visualEvidence: { fileId: "44444444-4444-4444-8444-444444444444" } }), params);
  const output = await frames(res);
  expect(output.some((f) => f.kind === "status" && f.status === "insufficient_evidence")).toBe(true);
  expect(seamMock.buildRequestBody).not.toHaveBeenCalled();
 });
});
