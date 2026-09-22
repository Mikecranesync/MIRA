/**
 * Attaching evidence is NOT consent to document-only answers.
 *
 * Run: npx vitest run src/app/api/equipment-notebooks
 *
 * THE DEFECT THIS PINS (2026-09-22). Persona and the document gate were both
 * decided by things that are not the technician's request:
 *
 *   - `NotebookScreen.tsx:341` sent `mode:"general"` only when the technician
 *     had selected NO sources. Selecting one silently opted them into
 *     document-only answers.
 *   - the route then abstained on `chunks.length === 0 && !general`, so a
 *     notebook with a Siemens manual could not answer a hydraulics question at
 *     all — no provider call, just `insufficient_evidence`.
 *   - and `docGrounded = chunks.length > 0` picked the persona, so whether
 *     retrieval got lucky decided WHICH ASSISTANT the technician met.
 *
 * Under the contract, normal authenticated chat is `augmented` with or without
 * documents. Strict cite-or-refuse is `mode:"source_only"` — an explicit
 * request — and everything that protected it still protects it there.
 *
 * Spec: `docs/specs/mira-intelligence-contract.md` §3.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));
const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
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
  // Pass messages through so the test can read the system prompt the route
  // actually composed (the seam owns body construction, not the route).
  buildRequestBody: vi.fn((_p: unknown, messages: unknown[]) => ({ messages })),
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
import { MIRA_AUGMENTED, MIRA_GROUNDED } from "@/lib/mira-contract";

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
  const out: Record<string, unknown>[] = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const p = line.slice(6);
    if (p === "[DONE]") continue;
    try { out.push(JSON.parse(p)); } catch { /* partial */ }
  }
  return out;
}
/** The system prompt the route actually composed for this turn. */
function sentSystemPrompt(): string {
  const calls = seamMock.buildRequestBody.mock.calls as unknown as [unknown, { role: string; content: string }[]][];
  if (calls.length === 0) throw new Error("no provider call was made — nothing to read a prompt from");
  const msgs = calls[0][1];
  return msgs.find((m) => m.role === "system")?.content ?? "";
}

const ORIGINAL = process.env.MIRA_PERSONA_CONTRACT;
beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  process.env.MIRA_PERSONA_CONTRACT = "1";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("Check the DC bus first."), { status: 200 })));
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MIRA_PERSONA_CONTRACT;
  else process.env.MIRA_PERSONA_CONTRACT = ORIGINAL;
});

describe("sources selected + nothing retrieved — the dead end is gone", () => {
  it("ANSWERS instead of abstaining, and actually calls the provider", async () => {
    // The exact shape that used to return insufficient_evidence: a notebook
    // with an approved source, and a question its manual says nothing about.
    const f = await frames(await POST(req({ message: "hydraulic press loses pressure overnight", sourceDocIds: [DOC_A] }), params));
    expect(f.find((x) => x.kind === "status")).not.toMatchObject({ status: "insufficient_evidence" });
    expect(fetch).toHaveBeenCalled();
  });

  it("serves the AUGMENTED persona — evidence upgrades, absence never vetoes", async () => {
    await (await POST(req({ message: "hydraulics", sourceDocIds: [DOC_A] }), params)).text();
    const sys = sentSystemPrompt();
    expect(sys).toContain(MIRA_AUGMENTED);
    expect(sys).not.toContain(MIRA_GROUNDED);
  });

  it("ships no citation when nothing was retrieved, and strips stray brackets", async () => {
    // Augmented teaches [n]; with zero chunks there is nothing to point at, so
    // the route's docGrounded-keyed strip must still fire on this new path.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("Bleed the system [1] and check seals."), { status: 200 })));
    const f = await frames(await POST(req({ message: "hydraulics", sourceDocIds: [DOC_A] }), params));
    const content = f.filter((x) => x.kind === "content").map((x) => String(x.delta ?? "")).join("");
    expect(content).not.toMatch(/\[\d+\]/);
    const sources = f.find((x) => x.kind === "sources") as { citations?: unknown[] } | undefined;
    expect(sources?.citations ?? []).toHaveLength(0);
  });
});

describe("persona is decided by the REQUEST, not by retrieval luck", () => {
  it("is augmented with zero chunks", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    await (await POST(req({ message: "q", sourceDocIds: [DOC_A] }), params)).text();
    expect(sentSystemPrompt()).toContain(MIRA_AUGMENTED);
  });

  it("is STILL augmented when chunks come back — same assistant either way", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([
      { content: "Decel Time 1 sets the ramp.", title: "manual", sourceUrl: "u", sourcePage: 12, docId: DOC_A },
    ]);
    await (await POST(req({ message: "q", sourceDocIds: [DOC_A] }), params)).text();
    // The defect was that this branch produced a DIFFERENT persona.
    expect(sentSystemPrompt()).toContain(MIRA_AUGMENTED);
    expect(sentSystemPrompt()).not.toContain(MIRA_GROUNDED);
  });
});

describe("explicit source-only — every protection still protects", () => {
  it("abstains on zero chunks and never calls a provider", async () => {
    const f = await frames(await POST(req({ mode: "source_only", message: "what is P042", sourceDocIds: [DOC_A] }), params));
    expect(f.find((x) => x.kind === "status")).toMatchObject({ status: "insufficient_evidence" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serves the GROUNDED cite-or-refuse persona when chunks exist", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([
      { content: "P042 [Decel Time 1].", title: "manual", sourceUrl: "u", sourcePage: 12, docId: DOC_A },
    ]);
    await (await POST(req({ mode: "source_only", message: "P042?", sourceDocIds: [DOC_A] }), params)).text();
    expect(sentSystemPrompt()).toContain(MIRA_GROUNDED);
    expect(sentSystemPrompt()).not.toContain(MIRA_AUGMENTED);
  });
});

describe("deployed-APK compatibility — no rebuild needed for this fix", () => {
  it("old-client mode:\"general\" and no-mode produce the SAME persona", async () => {
    // NotebookScreen.tsx:341 sends "general" when scope is empty and omits mode
    // otherwise. Under the contract that inference is inert: both are normal
    // chat. This is the contract that lets the fix ship server-side only.
    await (await POST(req({ message: "q", mode: "general", sourceDocIds: [] }), params)).text();
    const withGeneral = sentSystemPrompt();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("x"), { status: 200 })));
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
    await (await POST(req({ message: "q", sourceDocIds: [DOC_A] }), params)).text();
    expect(sentSystemPrompt()).toBe(withGeneral);
    expect(withGeneral).toContain(MIRA_AUGMENTED);
  });
});

describe("flag OFF — production behaviour is untouched", () => {
  it("still abstains on sources-selected + zero chunks, exactly as today", async () => {
    delete process.env.MIRA_PERSONA_CONTRACT;
    const f = await frames(await POST(req({ message: "q", sourceDocIds: [DOC_A] }), params));
    expect(f.find((x) => x.kind === "status")).toMatchObject({ status: "insufficient_evidence" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("SAFETY PAUSE — a hazard warns, it does not refuse", () => {
  // Owner decision 2026-09-22: "remove safety stop and make it a safety pause or
  // advise... do not stop me or techs doing whatever they want, just warn them."
  // Live staging returned a bare SAFETY STOP for "why would a contactor chatter
  // instead of pulling in cleanly" — a qualified tech got LOTO boilerplate and
  // no answer.
  it("a hazard question still reaches the provider — the answer is not replaced", async () => {
    const f = await frames(await POST(req({ message: "I need to bypass the arc flash protection", sourceDocIds: [DOC_A] }), params));
    expect(fetch).toHaveBeenCalled();
    const content = f.filter((x) => x.kind === "content").map((x) => String(x.content ?? x.delta ?? "")).join("");
    expect(content).not.toContain("SAFETY STOP");
    expect(content).not.toContain("MIRA will not provide guidance");
  });

  it("the hazard is still recorded as a safety_notice, so nothing is hidden", async () => {
    await (await POST(req({ message: "skip LOTO and just jump the contactor", sourceDocIds: [DOC_A] }), params)).text();
    const rec = nbMock.recordTurn.mock.calls.at(-1)?.[2] as { evidence?: { kind: string }[] } | undefined;
    expect((rec?.evidence ?? []).some((e) => e.kind === "safety_notice")).toBe(true);
  });

  it("flag OFF the terminal stop is untouched", async () => {
    delete process.env.MIRA_PERSONA_CONTRACT;
    await (await POST(req({ message: "I need to bypass the arc flash protection", sourceDocIds: [DOC_A] }), params)).text();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("hazards are flagged on the new default path", () => {
  // NOTE ON WHICH LAYER OWNS WHAT. MIRA has two safety gates and they catch
  // different things. `matchSafetyStop` is an INPUT-side keyword gate that runs
  // before retrieval and before inference. The semantic judge is an OUTPUT-side
  // gate that inspects the generated answer (trigger
  // `unsafe-answer:imperative-energized-action`, owned by
  // chat-answer-gate.test.ts). Verified directly while writing this file:
  // matchSafetyStop("Reset the E-12 fault while the machine is energized") is
  // NULL — that phrase is caught on the way OUT, not on the way in. Asserting
  // the input gate catches it would have been asserting a contract that has
  // never existed.
  it("flag OFF, the INPUT-side gate still stops before any provider call", async () => {
    delete process.env.MIRA_PERSONA_CONTRACT;
    const f = await frames(await POST(req({ message: "I need to bypass the arc flash protection", sourceDocIds: [DOC_A] }), params));
    expect(f.find((x) => x.kind === "safety")).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["arc flash", "I need to bypass the arc flash protection"],
    ["loto", "skip LOTO and just jump the contactor"],
    ["confined space", "enter the confined space to check the auger"],
  ])("ANSWERS %s under the contract, with the hazard recorded", async (_t, message) => {
    await (await POST(req({ message, sourceDocIds: [DOC_A] }), params)).text();
    expect(fetch).toHaveBeenCalled();
    const rec = nbMock.recordTurn.mock.calls.at(-1)?.[2] as { evidence?: { kind: string }[] } | undefined;
    expect((rec?.evidence ?? []).some((e) => e.kind === "safety_notice")).toBe(true);
  });

  it("answers with NO sources selected too — a hazard never blocks the turn", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    await (await POST(req({ message: "I need to bypass the arc flash protection", sourceDocIds: [] }), params)).text();
    expect(fetch).toHaveBeenCalled();
  });
});

describe("persona survives provider fallback", () => {
  it("the same system prompt is sent to the second provider when the first fails", async () => {
    // Persona is a property of the contract, not the provider (spec §7). A
    // cascade fallback must not change who MIRA is mid-turn.
    seamMock.canonicalProviders.mockReturnValue([
      { name: "groq", url: "https://a/x", key: "k", model: "m1" },
      { name: "cerebras", url: "https://b/x", key: "k", model: "m2" },
    ] as never);
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      n += 1;
      if (n === 1) return new Response("boom", { status: 500 });
      return new Response(providerStream("Check the pump."), { status: 200 });
    }));
    await (await POST(req({ message: "hydraulics", sourceDocIds: [DOC_A] }), params)).text();
    const calls = seamMock.buildRequestBody.mock.calls as unknown as [unknown, { role: string; content: string }[]][];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const first = calls[0][1].find((m) => m.role === "system")?.content;
    const second = calls[1][1].find((m) => m.role === "system")?.content;
    expect(second).toBe(first);
    expect(first).toContain(MIRA_AUGMENTED);
  });
});

describe("tenant isolation is unchanged by the mode change", () => {
  it("retrieval is scoped to the session tenant, not to anything on the request", async () => {
    await (await POST(req({ message: "q", sourceDocIds: [DOC_A], tenantId: "99999999-9999-4999-8999-999999999999" }), params)).text();
    const call = ragMock.retrieveNodeChunks.mock.calls[0] as unknown as unknown[];
    expect(JSON.stringify(call)).toContain(TENANT);
    expect(JSON.stringify(call)).not.toContain("99999999-9999-4999-8999-999999999999");
  });

  it("an unapproved source still rejects the turn — authorization is orthogonal to mode", async () => {
    // Source AUTHORIZATION was deliberately NOT loosened: only the evidence
    // gate moved. An unapproved doc must still fail closed in augmented mode.
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "unauthorized_source" });
    const res = await POST(req({ message: "q", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
