/**
 * #5864: on the notebook chat route, a message naming an unsafe practice (a live
 * touch screen while cleaning, an electrical cabinet left open) carries a fixed
 * warning card. With nothing retrieved, the card sits above the canned "add the
 * manual" reply and no provider is called. With evidence, the turn is answered
 * normally under the card. Same shape as the reported-bypass warning.
 *
 * Run: npx vitest run src/capabilities/__tests__/unsafe-practice-advisory-route.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({
    tenantId: "11111111-1111-4111-8111-111111111111",
    userId: "u1",
  })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  claimNotebookTurnRequest: vi.fn(async () => ({
    status: "claimed" as const,
    claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  })),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
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

const filesMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async (): Promise<{ fileId: string; capturedAt: string } | null> => null),
}));
vi.mock("@/lib/workspace-files", () => filesMock);
vi.mock("@/lib/visual-evidence-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/visual-evidence-context")>()),
  loadVisualEvidenceForPhoto: vi.fn(async () => null),
  loadRecentLookObservations: vi.fn(async () => []),
}));

// The semantic judge cannot decide against this stub provider, which would
// replace every flagged answer with the fail-closed fallback. These tests are
// about the banner, so the judge passes.
vi.mock("@/capabilities/answer-safety-check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/answer-safety-check")>()),
  semanticSafetyCheck: vi.fn(async () => ({ verdict: "safe" as const })),
}));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

const params = { params: Promise.resolve({ id: NB }) };

const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;

/** A provider stream that completes normally — what the route would spend on if the stop were lost. */
function completingProvider(text: string): Response {
  const chunks = [
    ...text.split(" ").map((w) => delta(w + " ")),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status: 200 },
  );
}

const groundedChunks = [
  { docId: DOC_A, filename: "PF525.pdf", page: 87, sourcePage: 87, content: "Fault F004 indicates DC bus undervoltage." },
];

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROQ_API_KEY = "k1";
  process.env.CEREBRAS_API_KEY = "k2";
  process.env.TOGETHERAI_API_KEY = "k3";
  delete process.env.MIRA_CANONICAL_SEAM;
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue(groundedChunks as never);
});
afterEach(async () => {
  // Usage persistence is deliberately scheduled after the response closes.
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

import { LIVE_SCREEN_CLEANING_CARD, OPEN_ENCLOSURE_CARD } from "@/capabilities/unsafe-practice-advisory";
import { BYPASS_BANNER, safetyBypassAsk, safetyBypassWarning } from "@/capabilities/safety-bypass-advisory";
import { semanticSafetyCheck } from "@/capabilities/answer-safety-check";

const ROSA_SCREEN =
  "ops wipe the touch screen while the line runs and it keeps hitting the conveyor start button lol. can they just tape the edge and leave it on while cleaning";
const ROSA_CABINET =
  "lost the key to the panel cabinet. gonna leave the door propped open so ops can reach the panel, thats fine right";
const CANNED = "I couldn't find support for that in this notebook's manuals.";
const REQ_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Recorded = { answerStatus: string; answerText: string | null; evidence: { kind: string; trigger?: string }[] };
function lastTurn(): Recorded | undefined {
  const calls = domainMock.recordTurn.mock.calls as unknown as unknown[][];
  return calls[calls.length - 1]?.[2] as Recorded | undefined;
}

async function post(message: string) {
  const req = new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify({ message, sourceDocIds: [DOC_A], clientRequestId: REQ_ID }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await POST(req, params);
  return { status: res.status, text: await res.text() };
}

const streamed = (raw: string) =>
  raw
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => {
      try {
        return JSON.parse(l) as { kind?: string; content?: string };
      } catch {
        return {};
      }
    })
    .filter((f) => f.kind === "content")
    .map((f) => f.content ?? "")
    .join("");

/** The live text of an abstained turn: the status frame's message (an abstain streams no content frames). */
const liveStatus = (raw: string) =>
  raw
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => {
      try {
        return JSON.parse(l) as { kind?: string; message?: string };
      } catch {
        return {};
      }
    })
    .find((f) => f.kind === "status")?.message;

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

/** The zero-hit notebook from the report: the search finds nothing, and a provider would say yes if it were asked. */
async function zeroHit(message: string) {
  ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
  const fetchMock = vi.fn(async () => completingProvider("Sure, that's fine, just tape the edge."));
  vi.stubGlobal("fetch", fetchMock);
  const out = await post(message);
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled(), { timeout: 2000 });
  expect(out.status).toBe(200);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(semanticSafetyCheck).not.toHaveBeenCalled();
  const turn = lastTurn()!;
  expect(turn.evidence.some((e) => e.kind === "safety_stop")).toBe(false);
  expect(turn.answerText).toContain(CANNED);
  expect(turn.answerText).not.toMatch(/that'?s fine|tape the edge/i);
  return { out, turn };
}

describe("#5864: a zero-hit notebook keeps the warning card above the canned reply", () => {
  it("live touch screen while cleaning: the card, then the canned reply, once, stored and live", async () => {
    const { out, turn } = await zeroHit(ROSA_SCREEN);
    expect(turn.answerText!.startsWith(`${LIVE_SCREEN_CLEANING_CARD}\n\n`)).toBe(true);
    expect(count(turn.answerText!, LIVE_SCREEN_CLEANING_CARD)).toBe(1);
    expect(turn.answerText).not.toContain(OPEN_ENCLOSURE_CARD);
    expect(liveStatus(out.text)).toBe(turn.answerText);
  });

  it("cabinet door propped open: the card, then the canned reply, once, stored and live", async () => {
    const { out, turn } = await zeroHit(ROSA_CABINET);
    expect(turn.answerText!.startsWith(`${OPEN_ENCLOSURE_CARD}\n\n`)).toBe(true);
    expect(count(turn.answerText!, OPEN_ENCLOSURE_CARD)).toBe(1);
    expect(turn.answerText).not.toContain(LIVE_SCREEN_CLEANING_CARD);
    expect(liveStatus(out.text)).toBe(turn.answerText);
  });

  it("a reported bypass and an open cabinet in one message: both cards, bypass first, each once", async () => {
    const msg = `The safety relay is bypassed. Also ${ROSA_CABINET}`;
    expect(safetyBypassWarning(msg)).not.toBeNull();
    expect(safetyBypassAsk(msg)).toBeNull();
    const { turn } = await zeroHit(msg);
    expect(count(turn.answerText!, BYPASS_BANNER)).toBe(1);
    expect(count(turn.answerText!, OPEN_ENCLOSURE_CARD)).toBe(1);
    expect(turn.answerText!.indexOf(BYPASS_BANNER)).toBeLessThan(turn.answerText!.indexOf(OPEN_ENCLOSURE_CARD));
  });

  it("control: an ordinary zero-hit question gets the canned reply and no card", async () => {
    const { turn } = await zeroHit("What is the auto-start delay on the Loader?");
    expect(turn.answerText).not.toContain(LIVE_SCREEN_CLEANING_CARD);
    expect(turn.answerText).not.toContain(OPEN_ENCLOSURE_CARD);
    expect(turn.answerText!.startsWith(CANNED)).toBe(true);
  });
});

describe("#5864: with evidence, the turn is answered normally under the card", () => {
  it("retrieval and the provider run, no stop, the card above the answer once", async () => {
    const fetchMock = vi.fn(async () => completingProvider("Switch the panel off before cleaning [1]."));
    vi.stubGlobal("fetch", fetchMock);
    const out = await post(ROSA_SCREEN);
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled(), { timeout: 2000 });
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    const turn = lastTurn()!;
    expect(turn.evidence.some((e) => e.kind === "safety_stop")).toBe(false);
    expect(turn.answerText!.startsWith(`${LIVE_SCREEN_CLEANING_CARD}\n\n`)).toBe(true);
    expect(count(turn.answerText!, LIVE_SCREEN_CLEANING_CARD)).toBe(1);
    expect(turn.answerText).toContain("Switch the panel off before cleaning");
    expect(count(streamed(out.text), LIVE_SCREEN_CLEANING_CARD)).toBe(1);
  });
});
