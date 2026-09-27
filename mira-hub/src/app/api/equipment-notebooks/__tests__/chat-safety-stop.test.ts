/**
 * Equipment Notebook chat — safety hard-stop (spec §10, §11).
 *
 * Run: npx vitest run src/app/api/equipment-notebooks
 *
 * This is the surface a technician uses while standing at a running machine,
 * and until this slice it was the one Hub chat route with no guardrail: the
 * asset- and node-chat routes both call `matchSafetyStop`, this one did not.
 *
 * The rules under test:
 *  - an active-hazard message stops BEFORE retrieval and BEFORE any provider
 *    call — no SQL, no fetch, no citations;
 *  - the stop is persisted, so the warning survives a device switch mid-incident;
 *  - it stops even when the notebook has no sources attached, because a hazard
 *    report must not be answered with "no sources selected";
 *  - an ordinary maintenance question is completely unaffected;
 *  - an educational question ("what is arc flash?") is NOT stopped — the carve-out
 *    that a second, hand-rolled keyword list would have silently lost.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  claimNotebookTurnRequest: vi.fn(
    async (): Promise<import("@/lib/equipment-notebooks").NotebookTurnRequestClaim> => ({
      status: "claimed",
      claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
  ),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  recordTurn: vi.fn(async () => undefined),
  // I3: the route resolves the notebook's bound asset; unbound keeps the
  // pre-081 behaviour these suites assert.
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  // 086: every zero-source turn proves tenant ownership first; this notebook
  // is the caller's.
  getNotebook: vi.fn(async () => ({ id: NB, displayName: "Conveyor 1" })),
  listSources: vi.fn(async () => []),
  listTurns: vi.fn(async () => []),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn(() => ""),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));

const poolMock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/db", () => ({ default: poolMock }));

import { POST } from "../[id]/chat/route";
import { SAFETY_STOP } from "@/lib/safety-classifier";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

function chatReq(body: unknown): NextRequest {
  return new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: NB }) };

async function readFrames(res: Response): Promise<string[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter(Boolean);
}

function answerText(frames: string[]): string {
  return frames
    .map((f) => {
      try {
        return JSON.parse(f);
      } catch {
        return null;
      }
    })
    .filter((o) => o && o.kind === "content")
    .map((o) => o.content)
    .join("");
}

function recordedTurn(): Record<string, unknown> {
  return (domainMock.recordTurn.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
}

/** A single retrieved chunk — needed so a turn clears the pre-existing,
 *  independent "zero retrieved evidence" abstain gate (line ~1874 of the
 *  route) and reaches the real flag-and-answer path this suite targets.
 *  Without it, `chunks.length === 0` short-circuits BEFORE the hazard banner
 *  is ever applied — see the BUG describe block below, which pins that gap
 *  deliberately rather than papering over it here. */
const CHUNK = { docId: DOC_A, filename: "conveyor.pdf", page: 3, content: "Reset procedure for the drive fault." };

function stubProvider(answer: string) {
  const body =
    answer
      .split("\n")
      .map((line) => `data: ${JSON.stringify({ choices: [{ delta: { content: line + "\n" }, finish_reason: null }] })}\n\n`)
      .join("") +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
    "data: [DONE]\n\n";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Any provider call during a safety stop is a failure of the whole slice.
  vi.stubGlobal("fetch", vi.fn());
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
  domainMock.claimNotebookTurnRequest.mockResolvedValue({
    status: "claimed",
    claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  process.env.GROQ_API_KEY = "test-key";
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
});

describe("notebook chat safety hard-stop", () => {
  it("rejects a malformed client request id before any turn can be written", async () => {
    const res = await POST(
      chatReq({ message: "there is smoke coming from the drive panel", sourceDocIds: [DOC_A], clientRequestId: "not-a-uuid" }),
      params,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_client_request_id" });
    expect(domainMock.recordTurn).not.toHaveBeenCalled();
  });

  it("flags an active hazard report but still retrieves and still calls the provider — the banner rides the answer, not a stop", async () => {
    // OWNER DECISION 2026-09-27 (Mike): "no answer blocking, just safety
    // flags". Detection is unchanged (same trigger the classifier always
    // matched on this phrase); the RESPONSE changed — retrieval and the
    // provider both run, the flag directive rides the system prompt, and the
    // hazard banner is prefixed to the model's real answer instead of
    // replacing it with SAFETY_STOP.
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    stubProvider("Get clear of the panel and call your supervisor before doing anything else.");
    const res = await POST(
      chatReq({ message: "there is smoke coming from the drive panel", sourceDocIds: [DOC_A] }),
      params,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Safety-Stop")).toBeNull();
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();

    const frames = await readFrames(res);
    expect(answerText(frames)).toContain("⚠️");
    expect(answerText(frames)).toContain("Get clear of the panel and call your supervisor before doing anything else.");
    // No terminal safety frame any more — the banner is ordinary content.
    expect(frames.some((f) => f.includes('"kind":"safety"'))).toBe(false);
    expect(frames.at(-1)).toBe("[DONE]");
  });

  describe("a flagged hazard is never swallowed by the zero-evidence abstain or the no-sources gate", () => {
    // Found by the 2026-09-27 test rewrite: with the terminal stop removed, a
    // hazard report that retrieved nothing fell into Gate G's abstain and lost
    // every trace of the flag. The route now sends a flagged turn past Gate G
    // to the general lane, so the tech gets the banner and an answer.
    it("a hazard report with zero retrieved chunks is answered under the banner", async () => {
      stubProvider("Back away and cut power at the disconnect.");
      const res = await POST(
        chatReq({ message: "there is smoke coming from the drive panel", sourceDocIds: [DOC_A] }),
        params,
      );
      const text = answerText(await readFrames(res));
      expect(text).toContain("Possible active incident");
      expect(text).toContain("Back away and cut power");
      expect(fetch).toHaveBeenCalled();
    });

    it("with no sources attached, a hazard report is still answered under the banner", async () => {
      domainMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
      stubProvider("Get medical attention first.");
      const res = await POST(chatReq({ message: "i just got shocked by the panel", sourceDocIds: [] }), params);
      const text = answerText(await readFrames(res));
      expect(text).toContain("Possible active incident");
      expect(text).toContain("Get medical attention first.");
    });
  });

  it("emits no citations — a stop is never dressed as a grounded answer", async () => {
    const res = await POST(chatReq({ message: "the wire is arcing", sourceDocIds: [DOC_A] }), params);
    const frames = await readFrames(res);
    const sources = frames
      .map((f) => {
        try {
          return JSON.parse(f);
        } catch {
          return null; // the [DONE] sentinel is not JSON
        }
      })
      .find((o) => o?.kind === "sources");
    expect(sources.citations).toEqual([]);
  });

  it("persists the flagged answer — the banner is baked into the stored text, so hydration renders the same warning on reload", async () => {
    // OWNER DECISION 2026-09-27: there is no more separate safety_stop/
    // safety_notice persistence for a generic (non-electrical) trigger — the
    // banner text IS the durable record, since it is part of `answerText`
    // itself and the replay path (`replayNotebookTurnResponse`) re-chunks
    // stored `answerText` verbatim.
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    stubProvider("Isolate the machine and confirm zero energy before touching anything.");
    const clientRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const res = await POST(chatReq({ message: "which cable to pull to stop it", sourceDocIds: [DOC_A], clientRequestId }), params);
    await res.text(); // the flagged path persists lazily, inside the SSE stream — consume it first
    const rec = recordedTurn();
    expect(rec.answerStatus).toBe("answered");
    expect(rec.answerText).not.toBe(SAFETY_STOP);
    expect(String(rec.answerText)).toMatch(/^⚠️/);
    expect(String(rec.answerText)).toContain("Isolate the machine and confirm zero energy before touching anything.");
    expect(rec.model).not.toBeNull();
    expect(rec.clientRequestId).toBe(clientRequestId);
  });

  it("replays the first persisted Safety STOP for the same client request without rerunning work", async () => {
    const clientRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    domainMock.claimNotebookTurnRequest.mockResolvedValue({
      status: "replay",
      turn: {
        id: "turn-1",
        question: "which cable to pull to stop it",
        answerStatus: "answered",
        answerText: SAFETY_STOP,
        enabledSourceDocIds: [DOC_A],
        evidence: [{ kind: "safety_notice", trigger: "exposed wire" }],
        model: null,
        basis: null,
      },
    });
    // Replay is terminal truth owned by the request id. A source can be
    // detached or lose approval after the first send; current source state
    // must not suppress the already-persisted Safety STOP.
    domainMock.validateChatSources.mockResolvedValue({ ok: false, error: "source_not_approved" });

    const res = await POST(
      chatReq({ message: "which cable to pull to stop it", sourceDocIds: [DOC_A], clientRequestId }),
      params,
    );
    const replayed = await readFrames(res);

    expect(res.headers.get("X-Idempotent-Replay")).toBe("true");
    expect(res.headers.get("X-Safety-Stop")).toBe("exposed wire");
    expect(answerText(replayed).trim()).toBe(SAFETY_STOP);
    expect(replayed.findIndex((f) => f.includes('"kind":"safety"'))).toBeLessThan(
      replayed.findIndex((f) => f.includes('"kind":"content"')),
    );
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(domainMock.recordTurn).not.toHaveBeenCalled();
    expect(domainMock.validateChatSources).not.toHaveBeenCalled();
  });

  it("uses the terminal notice from a legacy two-notice Safety STOP", async () => {
    const clientRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    domainMock.claimNotebookTurnRequest.mockResolvedValue({
      status: "replay",
      turn: {
        id: "turn-legacy-two-notice",
        question: "can I open this energized panel?",
        answerStatus: "answered",
        answerText: SAFETY_STOP,
        enabledSourceDocIds: [DOC_A],
        evidence: [
          { kind: "safety_notice", trigger: "energized-electrical-work" },
          { kind: "safety_notice", trigger: "exposed conductor" },
        ],
        model: null,
        basis: null,
      },
    });

    const res = await POST(
      chatReq({ message: "can I open this energized panel?", sourceDocIds: [DOC_A], clientRequestId }),
      params,
    );
    const replayed = await readFrames(res);

    expect(res.headers.get("X-Safety-Stop")).toBe("exposed conductor");
    expect(replayed.some((frame) => frame.includes('"kind":"safety","trigger":"exposed conductor"'))).toBe(true);
  });

  it("refuses a concurrent duplicate while the first request owns the key", async () => {
    domainMock.claimNotebookTurnRequest.mockResolvedValue({ status: "in_progress" });

    const res = await POST(
      chatReq({
        message: "which cable to pull to stop it",
        sourceDocIds: [DOC_A],
        clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      params,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "request_in_progress" });
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(domainMock.recordTurn).not.toHaveBeenCalled();
  });

  it("releases its lease token when pre-stream setup throws", async () => {
    const clientRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    domainMock.resolveBoundAsset.mockRejectedValueOnce(new Error("asset lookup unavailable"));

    await expect(
      POST(
        chatReq({ message: "how do I inspect this drive?", sourceDocIds: [DOC_A], clientRequestId }),
        params,
      ),
    ).rejects.toThrow("asset lookup unavailable");

    expect(domainMock.abandonNotebookTurnRequest).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      NB,
      "u1",
      clientRequestId,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
  });

  it("the flag directive rides the system prompt naming the SAME trigger the classifier matched (replaces the old header/notice pairing)", async () => {
    // There is no more X-Safety-Stop header and no more safety_notice entry
    // for a generic (non-electrical) trigger on the live path — the only
    // structured signal that detection fired is the directive injected into
    // the system prompt sent to the provider.
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    stubProvider("Answer text.");
    await POST(chatReq({ message: "which cable to pull to stop it", sourceDocIds: [DOC_A] }), params);
    expect(fetch).toHaveBeenCalled();
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
    const system = sentBody.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    expect(system).toContain("SAFETY FLAG: which cable to pull");
  });

  it("does not stop an ordinary maintenance question", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    const res = await POST(
      chatReq({ message: "what does parameter P042 set", sourceDocIds: [DOC_A] }),
      params,
    );

    expect(res.headers.get("X-Safety-Stop")).toBeNull();
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalled();
    const frames = await readFrames(res);
    expect(frames.some((f) => f.includes('"kind":"safety"'))).toBe(false);
  });

  it("does not stop an educational question about a safety concept", async () => {
    // The carve-out the shared classifier already encodes (2026-08-04): asking
    // WHAT arc flash is routes to normal handling; reporting one does not.
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    const res = await POST(chatReq({ message: "what is arc flash", sourceDocIds: [DOC_A] }), params);

    expect(res.headers.get("X-Safety-Stop")).toBeNull();
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalled();
  });

  it("keeps the notebook frame grammar — content (banner + answer), sources, evidence, status — so an unaware client still renders it", async () => {
    // There is no more terminal "safety" frame: the flagged turn streams
    // exactly like any other answered turn, banner baked into its content.
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    stubProvider("Do not touch it — call an electrician.");
    const res = await POST(chatReq({ message: "there is an exposed wire", sourceDocIds: [DOC_A] }), params);
    const kinds = (await readFrames(res))
      .map((f) => {
        try {
          return JSON.parse(f).kind;
        } catch {
          return f;
        }
      })
      .filter((k, i, a) => k !== "content" || a[i - 1] !== "content");

    expect(kinds).toEqual(["content", "sources", "evidence", "status", "[DONE]"]);
  });
});
