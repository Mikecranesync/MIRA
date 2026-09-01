/**
 * STRM-2 (server half) + PLAT-5 through the REAL notebook-chat handler.
 *
 * - PLAT-5: pins the ACTUAL wire order of an answered turn so the header
 *   comments in chat/route.ts and notebook-chat-types.ts cannot drift again.
 * - STRM-2: the client stops generation mid-stream → the provider read is
 *   cancelled, NO further provider is tried, and the turn is persisted as
 *   `answer_status='error'` with the partial text, no citations, no basis.
 *
 * Run: npx vitest run src/app/api/equipment-notebooks/__tests__/chat-stop-persist.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

import { POST } from "../[id]/chat/route";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

const chatReq = (body: unknown, init: { signal?: AbortSignal } = {}) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    ...(init.signal ? { signal: init.signal } : {}),
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

/** A provider stream that completes normally. */
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

/**
 * A provider stream that emits `head` deltas and then HANGS (never closes),
 * like a slow model mid-answer. Exposes whether the route cancelled it.
 */
function hangingProvider(head: string[]) {
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const w of head) c.enqueue(enc.encode(delta(w)));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { res: new Response(body, { status: 200 }), state };
}

const groundedChunks = [
  { docId: DOC_A, filename: "PF525.pdf", page: 87, content: "Fault F004 indicates DC bus undervoltage." },
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
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe("PLAT-5 — real wire order of an answered turn", () => {
  it("streams content* → sources → evidence → status → [followups] → [DONE] (legacy path, no usage)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completingProvider("DC bus undervoltage [1]")));
    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    const text = await res.text();
    const kinds = parseFrames(text).map((f) => f.kind as string);

    expect(kinds[0]).toBe("content");
    const nonContent = kinds.filter((k) => k !== "content");
    // Every content delta precedes the first non-content frame: sources is
    // NOT first (it is filtered to the [n] the answer actually used).
    expect(kinds.lastIndexOf("content")).toBeLessThan(kinds.indexOf("sources"));
    expect(nonContent.slice(0, 3)).toEqual(["sources", "evidence", "status"]);
    // followups is optional and, when present, is the tail.
    expect(nonContent.slice(3).every((k) => k === "followups")).toBe(true);
    expect(kinds).not.toContain("usage");
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("inserts usage between evidence and status when the seam is on", async () => {
    process.env.MIRA_CANONICAL_SEAM = "1";
    vi.stubGlobal("fetch", vi.fn(async () => completingProvider("DC bus undervoltage [1]")));
    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    const kinds = parseFrames(await res.text()).map((f) => f.kind as string);
    const nonContent = kinds.filter((k) => k !== "content");
    expect(nonContent.slice(0, 4)).toEqual(["sources", "evidence", "usage", "status"]);
  });
});

describe("STRM-2 — client stops generation mid-stream", () => {
  it("cancelling the response persists an error turn with the partial text, no citations, no basis", async () => {
    const provider = hangingProvider(["DC bus ", "undervoltage ", "[1] means "]);
    const fetchMock = vi.fn(async () => provider.res);
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let received = "";
    // Read until all three deltas have arrived, then stop.
    while (!received.includes("means")) {
      const { value, done } = await reader.read();
      if (done) break;
      received += dec.decode(value, { stream: true });
    }
    await reader.cancel();

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(turn).toMatchObject({
      question: "what is F004",
      answerStatus: "error",
      answerText: "DC bus undervoltage [1] means ",
      evidence: [],
      basis: null,
      enabledSourceDocIds: [DOC_A],
    });
    expect(turn.model).toMatch(/^Groq:/);

    // Provider read was stopped and NO fallback provider was tried.
    await vi.waitFor(() => expect(provider.state.cancelled).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Only content frames ever reached the client — no sources/evidence/status.
    const kinds = parseFrames(received).map((f) => f.kind);
    expect(kinds.every((k) => k === "content")).toBe(true);
    // Legacy path: no spend ledger write.
    expect(persistMock.persistTurnUsage).not.toHaveBeenCalled();
  });

  it("an aborted request signal stops the turn the same way and records spend when the seam is on", async () => {
    process.env.MIRA_CANONICAL_SEAM = "1";
    const provider = hangingProvider(["Check ", "the "]);
    vi.stubGlobal("fetch", vi.fn(async () => provider.res));

    const ac = new AbortController();
    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }, { signal: ac.signal }), params);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let received = "";
    while (!received.includes("the ")) {
      const { value, done } = await reader.read();
      if (done) break;
      received += dec.decode(value, { stream: true });
    }
    ac.abort();

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(turn).toMatchObject({ answerStatus: "error", answerText: "Check the ", evidence: [], basis: null });

    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const [scope, usage] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(scope).toMatchObject({ answerText: "Check the ", citationsPresent: false });
    expect(usage).toMatchObject({ provider: "Groq", status: "error", routeReason: "primary" });
    await vi.waitFor(() => expect(provider.state.cancelled).toBe(true));
  });

  it("a stop during the connect phase never falls through to the next provider (non-throwing continue path)", async () => {
    // Regression for the fix-pass finding: Groq is slow to answer, the
    // technician taps Stop, THEN Groq resolves 429/500. The non-OK branch
    // `continue`s without throwing, so the abort check in the catch block
    // never ran and Cerebras was opened for a turn that was already stopped.
    process.env.MIRA_CANONICAL_SEAM = "1";
    let resolveFirst: ((r: Response) => void) | null = null;
    const signals: (AbortSignal | undefined)[] = [];
    const second = hangingProvider(["x "]);
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      signals.push(init?.signal);
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((r) => {
          resolveFirst = r;
        });
      }
      return Promise.resolve(second.res);
    });
    vi.stubGlobal("fetch", fetchMock);

    const ac = new AbortController();
    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }, { signal: ac.signal }), params);
    // Let the route reach fetch #1 (still pending).
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    ac.abort();
    // The upstream request carries the client-stop signal: a stop during the
    // connect phase aborts the provider call rather than waiting on it.
    expect(signals[0]?.aborted).toBe(true);
    // Now the first provider answers non-OK — the path that used to `continue`.
    resolveFirst!(new Response(null, { status: 500 }));
    await res.text().catch(() => "");

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    // No provider ever streamed — nothing to attribute the stopped turn to.
    expect(turn).toMatchObject({ answerStatus: "error", answerText: null, model: null, evidence: [] });
    // The fallback provider was NEVER called.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.state.cancelled).toBe(false);
  });

  it("provider failure AFTER partial streaming persists answer_text NULL (contrast: a client stop keeps the partial)", async () => {
    // STOPPED-TURN CONTRACT: only a CLIENT stop may persist partial text. When
    // the provider dies mid-answer and the cascade is exhausted, the client has
    // already received content frames, but the row must say answer_text=NULL
    // so the client's `error && answer_text` rule cannot mistake it for a stop.
    // pull-driven so the two deltas are READ by the route before the stream
    // errors (an errored stream discards anything still queued).
    const dyingProvider = () => {
      const script = [delta("DC bus "), delta("undervoltage ")];
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            const next = script.shift();
            if (next) c.enqueue(enc.encode(next));
            // undici reports a dropped connection as TypeError("fetch failed").
            else c.error(new TypeError("fetch failed"));
          },
        }),
        { status: 200 },
      );
    };
    const fetchMock = vi.fn(async () => dyingProvider());
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    const text = await res.text();
    const frames = parseFrames(text);
    const kinds = frames.map((f) => f.kind as string);
    // The partial DID reach the client before the failure...
    expect(kinds.slice(0, 2)).toEqual(["content", "content"]);
    // ...and the turn still closed honestly as a provider failure.
    const status = frames.find((f) => f.kind === "status") as { status: string; message?: string };
    expect(status).toMatchObject({ status: "error", message: "No answer provider available." });
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
    // Every keyed provider was tried (legacy list here = Groq + Cerebras; a
    // provider failure DOES cascade — unlike a client stop, which breaks it).
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(turn).toMatchObject({
      question: "what is F004",
      answerStatus: "error",
      answerText: null,
      evidence: [],
      basis: null,
      model: null,
    });
  });

  it("stopping with nothing streamed yet persists answer_text null", async () => {
    const provider = hangingProvider([]);
    vi.stubGlobal("fetch", vi.fn(async () => provider.res));

    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    // Give the route a tick to open the provider stream before stopping.
    await new Promise((r) => setTimeout(r, 20));
    await res.body!.cancel();

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(turn).toMatchObject({ answerStatus: "error", answerText: null, evidence: [] });
  });
});

describe("STRM-2 — Stop vs normal completion (race) and stopped-turn spend", () => {
  it("a stop landing in the same tick as the provider's final chunk records EXACTLY ONE turn", async () => {
    // The interleaving the stop block is most exposed to: the provider stream
    // finished, and Stop arrives right at the boundary between the read loop
    // and the post-loop `if (clientAbort.signal.aborted)` check. Whichever
    // settles first (the abort race or the final read), exactly one recordTurn
    // must run — the stop block `return`s, so it and the answered tail are
    // mutually exclusive — and the turn must never ship citations.
    process.env.MIRA_CANONICAL_SEAM = "1";
    const ac = new AbortController();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls += 1;
        if (pulls === 1) {
          c.enqueue(enc.encode(delta("DC bus undervoltage [1] ")));
          return;
        }
        // Stop and the provider's clean finish, in the SAME tick.
        ac.abort();
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));

    const res = await POST(
      chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }, { signal: ac.signal }),
      params,
    );
    const text = await res.text().catch(() => "");

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    // Give an illegal SECOND write (answered tail running after the stop
    // block, or vice versa) time to land before asserting there wasn't one.
    await new Promise((r) => setTimeout(r, 50));
    expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
    expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1);

    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(turn).toMatchObject({ answerStatus: "error", evidence: [], basis: null });
    expect(String(turn.answerText)).toContain("DC bus");
    // A stopped turn never ships citations, however complete the answer was.
    expect(parseFrames(text).some((f) => f.kind === "sources")).toBe(false);
    expect(parseFrames(text).some((f) => f.kind === "status")).toBe(false);
  });

  it("a stopped turn whose provider never reported usage persists cost NULL, not a fabricated 0", async () => {
    // The provider `usage` block rides the FINAL chunk, which a stopped turn
    // never receives — so token counts are unknown. estimateCostUsd() turns
    // all-null counts into 0.000000, which is a positive claim that a turn
    // that really did burn tokens was FREE: it vanishes into SUM(cost) and is
    // NOT counted by tenantSpendSince's `unpriced_turns` filter
    // (cost_usd_estimate IS NULL). Unknown cost must stay NULL — the rule
    // persist-usage.ts states explicitly ("Never coalesce to 0").
    process.env.MIRA_CANONICAL_SEAM = "1";
    const provider = hangingProvider(["Check ", "terminal 07 "]);
    vi.stubGlobal("fetch", vi.fn(async () => provider.res));

    const ac = new AbortController();
    const res = await POST(
      chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }, { signal: ac.signal }),
      params,
    );
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let received = "";
    while (!received.includes("terminal 07")) {
      const { value, done } = await reader.read();
      if (done) break;
      received += dec.decode(value, { stream: true });
    }
    ac.abort();

    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const [, usage] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(usage).toMatchObject({ provider: "Groq", status: "error" });
    expect(usage.inputTokens).toBeNull();
    expect(usage.outputTokens).toBeNull();
    expect(usage.costUsdEstimate).toBeNull();
  });
});

/**
 * ADR-0038 rule 7 — the server's terminal classification COMMITS before the
 * `status` frame reaches the wire, and a later client disconnect must not
 * reclassify it.
 *
 * WHY THIS EXISTS. The compatibility spike observed the client holding a
 * complete, cited answer while the server still classified the connection as
 * cancelled (`framesSent 7/9, cancelled:true` — only `followups` and `[DONE]`
 * were lost). Rendering the answer is correct there; the client fabricated
 * nothing. But if the server ALSO treated that disconnect as a stop, the same
 * turn would persist as `answer_status='error'` and the technician would watch
 * a cited answer turn into "Stopped" on reload.
 *
 * WHAT ACTUALLY MAKES IT SAFE. There is exactly ONE client-abort check between
 * the provider cascade and the answered tail (route.ts, where `onClientGone` is
 * detached). Everything after it — evidence assembly, the `usage`/`status`/
 * `followups` frames, `[DONE]`, `controller.close()` and the `recordTurn` call
 * — runs with NO intervening `await`. That synchronous window is the commit:
 * once it is entered, no disconnect can interleave ahead of the write.
 *
 * SCOPE HONESTLY STATED. These tests pin the OUTCOME (a post-cascade disconnect
 * still persists what the server computed) and the wire/row AGREEMENT. Because
 * the tail is synchronous, they cannot force a disconnect to land *inside* it,
 * so they do not by themselves prove a future `if (aborted) return` added just
 * before `recordTurn` would be caught in every interleaving. What they do catch
 * is that refactor's observable consequences: a missing write, a second
 * contradicting write, or a row that disagrees with the `status` frame already
 * delivered. Keep the tail await-free and this rule holds structurally.
 */
describe("ADR-0038 rule 7 — a disconnect after the commit point cannot reclassify the turn", () => {
  /** Read the SSE body until `pred` is satisfied, then hand back the reader. */
  async function readUntil(res: Response, pred: (seen: string) => boolean) {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let seen = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += dec.decode(value, { stream: true });
      if (pred(seen)) break;
    }
    return { reader, seen };
  }

  it("the client disconnects right after `status` — the answered turn is persisted UNCHANGED", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completingProvider("DC bus undervoltage [1]")));

    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    const { reader, seen } = await readUntil(res, (s) => s.includes('"kind":"status"'));
    expect(seen).toContain('"status":"answered"');

    // The technician's phone drops the connection here: after the authoritative
    // frame, before the tail. Cancelling the response stream is what the route
    // sees as the client going away (its `cancel()` aborts `clientAbort`).
    await reader.cancel();
    // Let any illegal compensating write land before asserting there wasn't one.
    await new Promise((r) => setTimeout(r, 50));

    expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    // The whole point: `answered`, NOT the stopped-turn contract's `error`.
    expect(turn.answerStatus).toBe("answered");
    expect(String(turn.answerText)).toContain("DC bus undervoltage");
    // A stopped turn strips these. An answered turn that merely lost its reader
    // must keep them, or the reload silently downgrades a grounded answer.
    expect(turn.basis).not.toBeNull();
    expect(Array.isArray(turn.evidence) && (turn.evidence as unknown[]).length).toBeGreaterThan(0);
  });

  it("the row the technician reloads AGREES with the `status` frame they were sent", async () => {
    // Wire and database are two views of one decision. If a disconnect could
    // reclassify, these two would disagree and the answer would change on
    // reload — the exact §9.3/§10.8 reconciliation failure rule 7 forbids.
    vi.stubGlobal("fetch", vi.fn(async () => completingProvider("DC bus undervoltage [1]")));

    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    const { reader, seen } = await readUntil(res, (s) => s.includes('"kind":"status"'));
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 50));

    const wireStatus = parseFrames(seen).find((f) => f.kind === "status")?.status;
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(wireStatus).toBe("answered");
    expect(turn.answerStatus).toBe(wireStatus);
  });

  it("a disconnect DURING persistence produces no second, contradicting write", async () => {
    // `recordTurn` is awaited last. Holding it open puts the disconnect inside
    // the persistence window — the narrowest place a compensating "actually it
    // was stopped" write could be introduced by a later refactor.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    domainMock.recordTurn.mockImplementationOnce(async () => {
      await held;
      return undefined;
    });
    vi.stubGlobal("fetch", vi.fn(async () => completingProvider("DC bus undervoltage [1]")));

    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    const { reader } = await readUntil(res, (s) => s.includes('"kind":"status"'));
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));

    await reader.cancel(); // client gone while the write is still in flight
    release();
    await new Promise((r) => setTimeout(r, 50));

    expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(turn.answerStatus).toBe("answered");
  });

  it("CONTRAST: a disconnect BEFORE the commit point still yields the stopped-turn contract", async () => {
    // The other side of the boundary — proves the rule is a boundary and not a
    // blanket "never classify a disconnect as a stop". Without this, the tests
    // above would still pass if the stop path were broken outright.
    const provider = hangingProvider(["DC bus ", "undervoltage "]);
    vi.stubGlobal("fetch", vi.fn(async () => provider.res));

    const ac = new AbortController();
    const res = await POST(
      chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }, { signal: ac.signal }),
      params,
    );
    await readUntil(res, (s) => s.includes("undervoltage"));
    ac.abort(); // the cascade is still reading — this is BEFORE the commit point

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    const [, , turn] = domainMock.recordTurn.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(turn.answerStatus).toBe("error");
    expect(turn.evidence).toEqual([]);
    expect(turn.basis).toBeNull();
    expect(provider.state.cancelled).toBe(true);
  });
});

/**
 * ADR-0038 rule 7, STRUCTURAL guard — and the reason it has to be structural.
 *
 * The behavioural tests above pin the OUTCOME, but they cannot catch the
 * refactor the rule actually forbids, and it is worth saying exactly why:
 * between the commit point and the write there is no `await`, so the write is
 * already in flight before any disconnect a black-box test can trigger has a
 * chance to land. Adding `answerStatus: clientAbort.signal.aborted ? "error"
 * : answerStatus` to the `recordTurn` call leaves every behavioural assertion
 * above GREEN (verified by mutation, 2026-09-01) while silently reintroducing
 * the bug: a technician's cited answer becomes "Stopped" on reload whenever
 * their connection happens to drop in the tail.
 *
 * So the guard is on the SHAPE of the tail, not on its timing. Two properties
 * make rule 7 true, and both are asserted here:
 *
 *   1. The tail never re-reads the abort signal. One check decides
 *      stopped-vs-answered, and it is the commit point.
 *   2. The tail contains no `await` before the write. That is what makes the
 *      commit atomic — with an await, a disconnect COULD interleave, and
 *      property 1 would stop being sufficient.
 *
 * If this test fails, do not delete it and do not "fix" it by re-reading the
 * signal. Either the tail grew an await (rule 7 now needs a real mechanism,
 * not a structural accident — reopen ADR-0038) or someone reintroduced late
 * reclassification (that is the bug).
 *
 * VERIFIED BY MUTATION (2026-09-01). Three separate reintroductions of the bug
 * were applied to route.ts and each was caught by exactly one assertion here,
 * while every behavioural test in this file stayed green for all three:
 *   A. `answerStatus: clientAbort.signal.aborted ? "error" : answerStatus`
 *      inside the write   → "does not reclassify INSIDE the write call either"
 *   B. `if (clientAbort.signal.aborted) return;` before the write
 *                         → "never re-reads the client-abort signal…"
 *   C. an `await` inserted into the tail
 *                         → "contains no await between the commit point…"
 */
describe("ADR-0038 rule 7 — the commit-to-write tail stays atomic (source invariant)", () => {
  const ROUTE = fileURLToPath(new URL("../[id]/chat/route.ts", import.meta.url));
  const src = readFileSync(ROUTE, "utf8");

  /** Commit point → the answered write. `rfind` semantics: the LAST detach is
   *  the one on the answered path (the earlier one is inside the stop block),
   *  and the LAST `recordTurn` is the answered write. */
  const commit = src.lastIndexOf('req.signal?.removeEventListener("abort", onClientGone);');
  const write = src.lastIndexOf("await recordTurn(");
  /** Commit point up to (not including) the write: the atomic window. */
  const tail = src.slice(commit, write);
  /** The write's own argument list. The abort signal must not appear HERE
   *  either — reclassifying inside the call is the subtle form of the bug, and
   *  it sits just past the end of `tail`. */
  const writeCall = src.slice(write, src.indexOf("recordTurn failed:", write));

  it("finds both anchors (guards the guard — a rename must fail loudly, not silently pass)", () => {
    expect(commit).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(commit);
    // Sanity: the slices really are the terminal block + the write, not empty.
    expect(tail).toContain('kind: "status"');
    expect(tail).toContain("[DONE]");
    expect(writeCall.length).toBeGreaterThan(0);
  });

  it("never re-reads the client-abort signal after the commit point", () => {
    expect(tail).not.toContain("clientAbort.signal.aborted");
    expect(tail).not.toContain("req.signal?.aborted");
  });

  it("does not reclassify INSIDE the write call either", () => {
    // The mutation that survives every behavioural test:
    //   answerStatus: clientAbort.signal.aborted ? "error" : answerStatus
    expect(writeCall).toContain("answerStatus");
    expect(writeCall).not.toContain("aborted");
  });

  it("contains no await between the commit point and the write", () => {
    const awaits = tail.split("\n").filter((l) => /\bawait\b/.test(l));
    expect(awaits).toEqual([]);
  });
});
