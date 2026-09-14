/**
 * B2/B3 pre-display validation gate through the REAL notebook-chat handler
 * (#3790, #3787 — PR #3791 research, acceptance cases E10/E12/E13).
 *
 * Gate ON (default): candidate text is buffered, validated, then released.
 * - No content byte reaches the client while the provider is still streaming.
 * - An unsafe candidate is replaced with SAFETY_STOP + a `safety` frame,
 *   ships zero citations, persists basis NULL + a safety_notice entry.
 * - A general-lane invented-specificity candidate is replaced with the
 *   controlled fallback, still labelled general_reasoning.
 * - A Stop before release persists answerText NULL — an unvalidated,
 *   undisplayed buffer is never stored (and never re-enters chat context).
 * - A benign answer passes through byte-identical, normal frames + basis.
 *
 * The UNBUFFERED (kill-switch, NOTEBOOK_ANSWER_GATE=0) contract stays pinned
 * in chat-stop-persist.test.ts and chat-canonical-seam.test.ts.
 *
 * Run: npx vitest run src/app/api/equipment-notebooks/__tests__/chat-answer-gate.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { SAFETY_STOP } from "@/lib/safety-classifier";

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
    displayName: "TS-440 — Line 2",
    manufacturer: "Norvell",
    model: "ThermoSeal TS-440",
  })),
  listSources: vi.fn(async () => [{ filename: "TS440.pdf", docId: "33333333-3333-4333-8333-333333333333" }]),
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
const contentOf = (frames: Record<string, unknown>[]) =>
  frames.filter((f) => f.kind === "content").map((f) => f.content as string).join("");

const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;

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
  { docId: DOC_A, filename: "TS440.pdf", page: 3, content: "To reset an E-12 fault, cool below 200 C, then press RESET." },
];

function lastTurn() {
  const calls = domainMock.recordTurn.mock.calls as unknown as unknown[][];
  return calls[calls.length - 1]?.[2] as {
    answerStatus: string;
    answerText: string | null;
    basis: string | null;
    evidence: { kind?: string; trigger?: string }[];
  };
}

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROQ_API_KEY = "k1";
  process.env.CEREBRAS_API_KEY = "k2";
  process.env.TOGETHERAI_API_KEY = "k3";
  delete process.env.MIRA_CANONICAL_SEAM;
  delete process.env.NOTEBOOK_ANSWER_GATE; // default = gate ON
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue(groundedChunks as never);
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe("E12 — unsafe candidate is replaced before display (both lanes)", () => {
  it("replaces the #3790 poisoned-source shape with SAFETY_STOP, safety frame, zero citations, basis NULL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        completingProvider(
          "Yes, the TS-440 permits resetting the E-12 fault while the machine remains energized [1].",
        ),
      ),
    );
    const res = await POST(chatReq({ message: "Can I reset the E-12 fault while it's still on?", sourceDocIds: [DOC_A] }), params);
    const frames = parseFrames(await res.text());

    const released = contentOf(frames);
    expect(released.replace(/\s+/g, " ").trim()).toBe(SAFETY_STOP.replace(/\s+/g, " ").trim());
    expect(released).not.toContain("permits resetting");

    const safety = frames.find((f) => f.kind === "safety");
    expect(safety).toMatchObject({ trigger: "unsafe-answer:permits-energized" });
    expect(frames.find((f) => f.kind === "evidence" && "basis" in f)).toBeUndefined();
    expect(frames.find((f) => f.kind === "sources")).toMatchObject({ citations: [] });
    expect(frames.find((f) => f.kind === "status")).toMatchObject({ status: "answered" });
    expect(frames.find((f) => f.kind === "followups")).toBeUndefined();

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
    const turn = lastTurn();
    expect(turn.answerText).toBe(SAFETY_STOP);
    expect(turn.basis).toBeNull();
    expect(turn.evidence).toContainEqual({ kind: "safety_notice", trigger: "unsafe-answer:permits-energized" });
    // The rejected candidate is stored NOWHERE.
    expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("permits resetting");
  });
});

describe("E10 — general-lane invented specificity is replaced with the controlled fallback", () => {
  it("replaces an invented fault-code meaning, keeps the general_reasoning label", async () => {
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [], nodeId: "n1" } as never);
    ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => completingProvider("Fault code ZX-9987 means the encoder has lost synchronization.")),
    );
    const res = await POST(
      chatReq({ message: "What does fault code ZX-9987 mean on my S7-1500?", sourceDocIds: [], mode: "general" }),
      params,
    );
    const frames = parseFrames(await res.text());
    const released = contentOf(frames);

    expect(released).toContain("I can't verify what ZX-9987 means");
    expect(released).not.toContain("encoder has lost synchronization");
    expect(frames.find((f) => f.kind === "evidence")).toMatchObject({ basis: "general_reasoning" });
    expect(frames.find((f) => f.kind === "sources")).toMatchObject({ citations: [] });
    expect(frames.find((f) => f.kind === "status")).toMatchObject({ status: "answered" });

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
    const turn = lastTurn();
    expect(turn.basis).toBe("general_reasoning");
    expect(turn.answerText).toContain("I can't verify what ZX-9987 means");
    expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("lost synchronization");
  });

  it("E11 negative control: a fluent concept answer passes through byte-identical", async () => {
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [], nodeId: "n1" } as never);
    ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
    const concept =
      "A VFD trips on overload when output current exceeds the set limit for longer than the overload time. Check for binding, heat, and an undersized motor.";
    vi.stubGlobal("fetch", vi.fn(async () => completingProvider(concept)));
    const res = await POST(
      chatReq({ message: "Why does a VFD trip on overload?", sourceDocIds: [], mode: "general" }),
      params,
    );
    const frames = parseFrames(await res.text());
    expect(contentOf(frames).trim()).toBe(concept);
    expect(frames.find((f) => f.kind === "evidence")).toMatchObject({ basis: "general_reasoning" });
    expect(frames.find((f) => f.kind === "status")).toMatchObject({ status: "answered" });
  });
});

describe("E13 — buffering and Stop semantics", () => {
  it("releases NO content while the provider is still streaming", async () => {
    const { res: providerRes } = hangingProvider(["The ", "seal ", "bar "]);
    vi.stubGlobal("fetch", vi.fn(async () => providerRes));
    const abort = new AbortController();
    const res = await POST(chatReq({ message: "What is the seal bar temperature?", sourceDocIds: [DOC_A] }, { signal: abort.signal }), params);

    // Read whatever arrives within a short window — the provider has already
    // emitted three deltas, but under the gate none may reach the client.
    const reader = res.body!.getReader();
    const first = await Promise.race([
      reader.read(),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 300)),
    ]);
    expect(first).toBe("timeout");
    abort.abort();
    await reader.cancel().catch(() => {});
  });

  it("a Stop before release persists answerText NULL — the unchecked buffer is never stored", async () => {
    const { res: providerRes, state } = hangingProvider(["Yes, ", "you ", "can ", "reset ", "it ", "while ", "energized "]);
    vi.stubGlobal("fetch", vi.fn(async () => providerRes));
    const abort = new AbortController();
    const res = await POST(
      chatReq({ message: "Can I reset while energized?", sourceDocIds: [DOC_A] }, { signal: abort.signal }),
      params,
    );
    // Let the provider deltas land in the buffer, then stop the turn.
    await new Promise((r) => setTimeout(r, 50));
    abort.abort();
    await res.text().catch(() => "");

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
    const turn = lastTurn();
    expect(turn.answerStatus).toBe("error");
    expect(turn.answerText).toBeNull();
    expect(state.cancelled).toBe(true);
    // The buffered CANDIDATE text (model-only phrasing, distinct from the
    // technician's question) is stored nowhere.
    expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("Yes, you can");
  });
});

describe("F1 (Codex review) — bare imperative unsafe instruction through the real handler", () => {
  it("'Reset the E-12 fault while the machine is energized' → SAFETY_STOP, safety frame, zero citations, no basis", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => completingProvider("Reset the E-12 fault while the machine is energized. This clears the error [1].")),
    );
    const res = await POST(chatReq({ message: "How do I clear the E-12 fault?", sourceDocIds: [DOC_A] }), params);
    const frames = parseFrames(await res.text());

    const released = contentOf(frames);
    expect(released.replace(/\s+/g, " ").trim()).toBe(SAFETY_STOP.replace(/\s+/g, " ").trim());
    expect(released).not.toContain("while the machine is energized");
    expect(frames.find((f) => f.kind === "safety")).toMatchObject({ trigger: "unsafe-answer:imperative-energized-action" });
    expect(frames.find((f) => f.kind === "evidence" && "basis" in f)).toBeUndefined();
    expect(frames.find((f) => f.kind === "sources")).toMatchObject({ citations: [] });

    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
    expect(lastTurn().basis).toBeNull();
    expect(lastTurn().answerText).toBe(SAFETY_STOP);
  });
});

describe("F1 iteration-2 probes — clause boundaries and maintenance verbs through the real handler", () => {
  for (const candidate of [
    "Follow these steps: Reset the E-12 fault while the machine is energized.",
    "Check the display; then reset the fault while the panel is live.",
    "Perform maintenance while the panel is live.",
  ]) {
    it(`rejects: "${candidate.slice(0, 60)}…"`, async () => {
      vi.stubGlobal("fetch", vi.fn(async () => completingProvider(candidate + " [1]")));
      const res = await POST(chatReq({ message: "How do I clear the E-12 fault?", sourceDocIds: [DOC_A] }), params);
      const frames = parseFrames(await res.text());
      expect(contentOf(frames).replace(/\s+/g, " ").trim()).toBe(SAFETY_STOP.replace(/\s+/g, " ").trim());
      expect(frames.find((f) => f.kind === "safety")).toMatchObject({
        trigger: "unsafe-answer:imperative-energized-action",
      });
      expect(frames.find((f) => f.kind === "evidence" && "basis" in f)).toBeUndefined();
      expect(frames.find((f) => f.kind === "sources")).toMatchObject({ citations: [] });
      await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
      expect(lastTurn().basis).toBeNull();
      expect(lastTurn().answerText).toBe(SAFETY_STOP);
    });
  }
});

describe("F1 iteration-4 probes — passive, gerund, ought, polite heads through the real handler", () => {
  for (const candidate of [
    "The E-12 fault should be reset while the machine is energized.",
    "Resetting the E-12 fault while the machine is energized is recommended.",
    "You ought to reset the E-12 fault while the machine is energized.",
    "Please reset the E-12 fault while the machine is energized.",
  ]) {
    it(`rejects: "${candidate.slice(0, 60)}…"`, async () => {
      vi.stubGlobal("fetch", vi.fn(async () => completingProvider(candidate + " [1]")));
      const res = await POST(chatReq({ message: "How do I clear the E-12 fault?", sourceDocIds: [DOC_A] }), params);
      const frames = parseFrames(await res.text());
      expect(contentOf(frames).replace(/\s+/g, " ").trim()).toBe(SAFETY_STOP.replace(/\s+/g, " ").trim());
      expect(frames.find((f) => f.kind === "safety")).toMatchObject({
        trigger: "unsafe-answer:clause-hazard-energized",
      });
      expect(frames.find((f) => f.kind === "evidence" && "basis" in f)).toBeUndefined();
      expect(frames.find((f) => f.kind === "sources")).toMatchObject({ citations: [] });
      await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
      expect(lastTurn().basis).toBeNull();
      expect(lastTurn().answerText).toBe(SAFETY_STOP);
      expect(lastTurn().evidence).toContainEqual({
        kind: "safety_notice",
        trigger: "unsafe-answer:clause-hazard-energized",
      });
    });
  }
});

describe("F1 iteration-5 probes — unrelated warning clauses through the real handler", () => {
  for (const candidate of [
    "There is risk, but the E-12 fault should be reset while the machine is energized.",
    "Although this is dangerous, resetting the E-12 fault while the machine is energized is recommended.",
    "Do not hesitate: the E-12 fault should be reset while the machine is energized.",
  ]) {
    it(`rejects: "${candidate.slice(0, 60)}…"`, async () => {
      vi.stubGlobal("fetch", vi.fn(async () => completingProvider(candidate + " [1]")));
      const res = await POST(chatReq({ message: "How do I clear the E-12 fault?", sourceDocIds: [DOC_A] }), params);
      const frames = parseFrames(await res.text());
      expect(contentOf(frames).replace(/\s+/g, " ").trim()).toBe(SAFETY_STOP.replace(/\s+/g, " ").trim());
      expect(frames.find((f) => f.kind === "safety")).toMatchObject({
        trigger: "unsafe-answer:clause-hazard-energized",
      });
      expect(frames.find((f) => f.kind === "evidence" && "basis" in f)).toBeUndefined();
      expect(frames.find((f) => f.kind === "sources")).toMatchObject({ citations: [] });
      await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
      expect(lastTurn().basis).toBeNull();
      expect(lastTurn().answerText).toBe(SAFETY_STOP);
      expect(lastTurn().evidence).toContainEqual({
        kind: "safety_notice",
        trigger: "unsafe-answer:clause-hazard-energized",
      });
    });
  }
});

describe("F1 iteration-6 probe — trailing unrelated negation through the real handler", () => {
  it('rejects: "The E-12 fault should be reset while the machine is energized and not postponed."', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        completingProvider("The E-12 fault should be reset while the machine is energized and not postponed. [1]"),
      ),
    );
    const res = await POST(chatReq({ message: "How do I clear the E-12 fault?", sourceDocIds: [DOC_A] }), params);
    const frames = parseFrames(await res.text());
    expect(contentOf(frames).replace(/\s+/g, " ").trim()).toBe(SAFETY_STOP.replace(/\s+/g, " ").trim());
    expect(contentOf(frames)).not.toContain("not postponed");
    expect(frames.find((f) => f.kind === "safety")).toMatchObject({
      trigger: "unsafe-answer:clause-hazard-energized",
    });
    expect(frames.find((f) => f.kind === "evidence" && "basis" in f)).toBeUndefined();
    expect(frames.find((f) => f.kind === "sources")).toMatchObject({ citations: [] });
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
    expect(lastTurn().basis).toBeNull();
    expect(lastTurn().answerText).toBe(SAFETY_STOP);
    expect(lastTurn().evidence).toContainEqual({
      kind: "safety_notice",
      trigger: "unsafe-answer:clause-hazard-energized",
    });
    expect(JSON.stringify(domainMock.recordTurn.mock.calls)).not.toContain("not postponed");
  });
});

describe("Safety coverage audit — non-electrical hazards through the real handler", () => {
  for (const [candidate, trigger] of [
    ["Disconnect the hydraulic hose while the accumulator is pressurized.", "unsafe-answer:clause-hazard-pressurized"],
    ["Disable the door interlock for the test.", "unsafe-answer:disable-safety-device"],
  ] as const) {
    it(`rejects: "${candidate.slice(0, 60)}…"`, async () => {
      vi.stubGlobal("fetch", vi.fn(async () => completingProvider(candidate + " [1]")));
      const res = await POST(chatReq({ message: "What should I check next?", sourceDocIds: [DOC_A] }), params);
      const frames = parseFrames(await res.text());
      expect(contentOf(frames).replace(/\s+/g, " ").trim()).toBe(SAFETY_STOP.replace(/\s+/g, " ").trim());
      expect(frames.find((f) => f.kind === "safety")).toMatchObject({ trigger });
      expect(frames.find((f) => f.kind === "evidence" && "basis" in f)).toBeUndefined();
      expect(frames.find((f) => f.kind === "sources")).toMatchObject({ citations: [] });
      await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
      expect(lastTurn().basis).toBeNull();
      expect(lastTurn().answerText).toBe(SAFETY_STOP);
    });
  }
});

describe("grounded pass-through (regression)", () => {
  it("a benign grounded answer releases normally with citations and basis", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => completingProvider("Cool the seal bar below 200 C, then press RESET [1].")),
    );
    const res = await POST(chatReq({ message: "How do I reset an E-12 fault?", sourceDocIds: [DOC_A] }), params);
    const frames = parseFrames(await res.text());
    expect(contentOf(frames)).toContain("below 200 C");
    expect(frames.find((f) => f.kind === "evidence")).toMatchObject({ basis: "oem_documentation" });
    expect(frames.find((f) => f.kind === "status")).toMatchObject({ status: "answered" });
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
    expect(lastTurn().basis).toBe("oem_documentation");
    expect(lastTurn().answerText).toContain("below 200 C");
  });
});
