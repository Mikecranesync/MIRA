/**
 * A turn that rests only on a kept photo reading is labelled as an unconfirmed
 * reading, not as documentation -- through the REAL notebook-chat handler.
 *
 * Found on a branch build against staging data (2026-10-23): a fresh
 * conversation cited a kept print reading that carried a vision misread, and
 * the turn was labelled "Grounded in this notebook's sources" with no caveat,
 * because the document's own "not technician-verified" header had landed in a
 * different chunk from the one cited.
 *
 * After #4643 a reviewed Keep marks chunks verified and titles the document
 * Technician-confirmed photo reading. Verified photo-derived chunks already
 * take the documentation basis (this control).
 *
 * Harness copied from chat-answer-gate.test.ts (that file lives in the guarded
 * app tree).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_PHOTO = "33333333-3333-4333-8333-333333333333";
const PHOTO = "44444444-4444-4444-8444-444444444444";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  recordTurn: vi.fn(async () => undefined),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  getNotebook: vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", displayName: "Ride A", manufacturer: null, model: null })),
  listSources: vi.fn(async () => [{ filename: "Unconfirmed photo reading 2026-10-23.txt", docId: "33333333-3333-4333-8333-333333333333" }]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const filesMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async (): Promise<{ fileId: string; capturedAt: string } | null> => null),
}));
vi.mock("@/lib/workspace-files", () => filesMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
const poolMock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/db", () => ({ default: poolMock }));
vi.mock("@/lib/inference/persist-usage", () => ({
  persistTurnUsage: vi.fn(async () => ({ persisted: true, traceId: "trace-1" })),
}));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

const chatReq = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: Promise.resolve({ id: NB }) };

function parseFrames(text: string): Record<string, unknown>[] {
  return text
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;
function completingProvider(text: string): Response {
  const chunks = [
    ...text.split(" ").map((w) => delta(w + " ")),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return new Response(
    new ReadableStream<Uint8Array>({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }),
    { status: 200 },
  );
}

const photoChunk = (verified: boolean) => ({
  docId: DOC_PHOTO,
  filename: "Unconfirmed photo reading 2026-10-23.txt",
  title: "Unconfirmed photo reading 2026-10-23.txt",
  page: 1,
  content: 'Coach 3 is labeled "-F55.3". The arrows on the right include "-L24-3-Aux / 15.0".',
  verified,
});

function lastTurn() {
  const calls = domainMock.recordTurn.mock.calls as unknown as unknown[][];
  return calls[calls.length - 1]?.[2] as { basis: string | null };
}

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROQ_API_KEY = "k1";
  process.env.TOGETHERAI_API_KEY = "k3";
  delete process.env.MIRA_CANONICAL_SEAM;
  delete process.env.NOTEBOOK_ANSWER_GATE;
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_PHOTO], nodeId: "n1" } as never);
  domainMock.originFileIdsByDoc.mockResolvedValue(new Map([[DOC_PHOTO, PHOTO]]));
  vi.stubGlobal("fetch", vi.fn(async () => completingProvider("Coach 3 is protected by -F55.3 [1].")));
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

async function ask() {
  const res = await POST(chatReq({ message: "Which breaker protects coach 3?", sourceDocIds: [DOC_PHOTO] }), params);
  return parseFrames(await res.text());
}

describe("an answer resting only on a kept photo reading", () => {
  it("is labelled an unconfirmed reading, live and persisted", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([photoChunk(false)] as never);
    const frames = await ask();
    expect(frames.find((f) => f.kind === "sources")).toMatchObject({
      citations: [expect.objectContaining({ docId: DOC_PHOTO, originFileId: PHOTO })],
    });
    expect(frames.find((f) => f.kind === "evidence" && "basis" in f)).toMatchObject({
      basis: "workspace_evidence",
      label: "Grounded in a photo kept on this machine -- an unconfirmed reading.",
    });
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
    expect(lastTurn().basis).toBe("workspace_evidence");
  });

  it("control: a confirmed (verified) photo-derived source keeps the documentation label", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([photoChunk(true)] as never);
    const frames = await ask();
    expect(frames.find((f) => f.kind === "evidence" && "basis" in f)).toMatchObject({ basis: "oem_documentation" });
  });
});
