/**
 * Bench components (Mike 2026-11-14): a question asked under a selected
 * component is answered from that component's confirmed identity, never the
 * notebook's; an unconfirmed component, or a question naming another component
 * of the bench, gets a fixed reply that reads no manual and calls no provider;
 * a selection the client no longer shows is a 409; and a refusal offers
 * "Return to …" as an action, not as text for the next question.
 *
 * Run: npx vitest run src/capabilities/bench-components/__tests__/chat-route.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const VFD = "44444444-4444-4444-8444-444444444444";
const K1 = "55555555-5555-4555-8555-555555555555";
const B1 = "66666666-6666-4666-8666-666666666666";
const REQ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  LEGACY_THREAD_ID: "legacy",
  normalizeNotebookThreadId: vi.fn((v: unknown) => (typeof v === "string" ? v : null)),
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  claimNotebookTurnRequest: vi.fn(async (): Promise<unknown> => ({ status: "claimed", claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  recordTurn: vi.fn(async () => "turn-row-1"),
  listTurns: vi.fn(async () => [] as unknown[]),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
  neutralizeReferenceText: vi.fn((t: string) => t),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

type Rev = Record<string, unknown>;
const rev = (componentId: string, revision: number, over: Rev): Rev => ({
  componentId, revision, rawLabel: null, inputKind: "typed", manufacturer: null, family: null, catalogNumber: null,
  serialNumber: null, hardwareRevision: null, localTag: null, identityStatus: "user_confirmed", unresolved: [],
  confirmedAt: "2026-11-14T03:00:00.000Z", createdAt: "2026-11-14T03:00:00.000Z", evidenceFileId: null, evidenceNote: null,
  ...over,
});
const component = (id: string, position: number, kind: string, current: Rev) => ({
  id, notebookId: NB, position, kind, origin: "device_schedule", createdAt: "2026-11-14T02:00:00.000Z", retiredAt: null, current,
});
const VFD_ROW = component(VFD, 1, "VFD", rev(VFD, 2, { manufacturer: "AutomationDirect", family: "GS10", catalogNumber: "GS11N-20P2", localTag: "VFD1" }));
const K1_ROW = component(K1, 9, "contactor", rev(K1, 1, { manufacturer: "Schneider Electric", catalogNumber: "CA3KN22BD", localTag: "Q1" }));
const B1_ROW = component(B1, 6, "pushbutton", rev(B1, 1, { manufacturer: "IDEC", catalogNumber: "YW1B", localTag: "B1", identityStatus: "candidate", confirmedAt: null }));
const SELECTED_AT = "2026-11-14T04:00:00.000Z";
const selection = (componentId: string, revision: number, version: number) => ({ componentId, revision, selectedAt: SELECTED_AT, selectedVia: "picker", version });

const storeMock = vi.hoisted(() => ({
  listComponents: vi.fn(async (): Promise<unknown[]> => []),
  getSelection: vi.fn(async (): Promise<unknown> => null),
  getSelectionState: vi.fn(async (): Promise<unknown> => ({ selection: null, version: null })),
  advanceSelectionRevision: vi.fn(async (): Promise<unknown> => null),
  setSelection: vi.fn(),
  stampTurnComponent: vi.fn(async () => true),
  listSelectionTurns: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock("@/capabilities/bench-components/store", () => storeMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));
vi.mock("@/lib/workspace-files", () => ({ photoLinkedToTarget: vi.fn(async () => null) }));

// #5504 Codex r3 F7/F8: the photo ledger and the search translator, observed but otherwise real.
const lookMock = vi.hoisted(() => ({
  loadRecentLookObservations: vi.fn(async (): Promise<unknown[]> => []),
  loadVisualEvidenceForPhoto: vi.fn(async (): Promise<unknown> => null),
  loadVisualEvidenceForAsset: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock("@/lib/visual-evidence-context", async (orig) => ({ ...(await orig<Record<string, unknown>>()), ...lookMock }));
const translateMock = vi.hoisted(() => ({ translateForSearch: vi.fn(async (q: string) => q) }));
vi.mock("@/capabilities/translate-for-search", () => translateMock);

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

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";
import { noDocumentsForComponentText, selectionMovedText } from "@/capabilities/bench-components/chat-turn";
import { ENERGIZED_ELECTRICAL_HAZARD, notebookSafetyTrigger, withSafetyFlag } from "@/lib/safety-classifier";
import { photoLinkedToTarget } from "@/lib/workspace-files";

function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };
const ask = (message: string, extra: Record<string, unknown> = {}) =>
  POST(req({ message, sourceDocIds: [DOC_A], clientRequestId: REQ, ...extra }), params);
const under = (componentId: string, selectionVersion: number) => ({ componentSelection: { threadId: null, componentId, selectionVersion } });
/** #5504 post-cap F9/F10: the whole machine, said explicitly, with the version the screen read. */
const wholeMachine = (selectionVersion: number | null) => ({ componentSelection: { threadId: null, componentId: null, selectionVersion } });

const CHUNK = { docId: DOC_A, filename: "gs10usermanual.pdf", page: 26, content: "oC: overcurrent during acceleration." };

/** The system prompt of the provider request this turn sent. */
function systemPrompt(): string {
  const call = seamMock.buildRequestBody.mock.calls.at(-1) as unknown as [unknown, { role: string; content: string }[]] | undefined;
  if (!call) throw new Error("no provider request was built");
  return call[1][0].content;
}

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && !l.startsWith("data: [DONE]"))
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
}
const statusOf = (out: Record<string, unknown>[]) => out.find((f) => f.kind === "status") as { status: string; message?: string };
const componentFrame = (out: Record<string, unknown>[]) => out.find((f) => f.kind === "component") as
  | { componentId: string; revision: number; selectionVersion: number; label: string; actions: { action: string; componentId: string; label: string }[] }
  | undefined;
const retrievalOpts = () => ragMock.retrieveNodeChunks.mock.calls[0]?.[3] as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  delete process.env.NOTEBOOK_ENERGIZED_HARD_STOP;
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  // The notebook's own machine is the bench's PLC: a component turn must never be scoped by it.
  nbMock.getNotebook.mockResolvedValue({
    id: NB, displayName: "ZZ-BENCH CV-101 MACHINE", manufacturer: "Rockwell Automation", model: "Micro820",
    catalogNumber: "2080-LC20-20QWB", identityStatus: "user_confirmed",
  });
  nbMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
  storeMock.listComponents.mockResolvedValue([VFD_ROW, K1_ROW, B1_ROW]);
  storeMock.getSelection.mockResolvedValue(selection(VFD, 2, 3));
  storeMock.stampTurnComponent.mockResolvedValue(true);
  storeMock.listSelectionTurns.mockResolvedValue([]);
  ragMock.retrieveNodeChunks.mockImplementation(async () => []);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } })));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("no component selected — today's behaviour", () => {
  it("control: with nothing saved, the notebook's identity scopes retrieval and no component is read", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    await frames(await ask("what does fault oC mean"));
    // The saved choice is always read (#5504 post-cap F9/F10); nothing saved = today's path.
    expect(storeMock.getSelectionState).toHaveBeenCalledTimes(1);
    expect(storeMock.getSelection).not.toHaveBeenCalled();
    expect(storeMock.listComponents).not.toHaveBeenCalled();
    expect(storeMock.stampTurnComponent).not.toHaveBeenCalled();
    expect(retrievalOpts()?.catalogNumber).toBe("2080-LC20-20QWB");
    expect(storeMock.listSelectionTurns).not.toHaveBeenCalled();
    expect(systemPrompt()).toContain("- Catalog number on record: 2080-LC20-20QWB.");
  });
});

describe("a confirmed component is the record for the turn", () => {
  it("retrieval is scoped by the component's catalog number, not the notebook's, and the turn is stamped", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    await frames(await ask("what does fault oC mean", under(VFD, 3)));
    expect(retrievalOpts()).toMatchObject({
      catalogNumber: "GS11N-20P2",
      identityStatus: "user_confirmed",
      identity: { manufacturer: "AutomationDirect", model: "GS10" },
    });
    expect(storeMock.stampTurnComponent).toHaveBeenCalledWith(TENANT, NB, "u1", REQ, VFD, 2);
    // The header the model reads names the component, never the project's own machine.
    const prompt = systemPrompt();
    expect(prompt).toContain("- Equipment: AutomationDirect GS10");
    expect(prompt).toContain("- Catalog number on record: GS11N-20P2.");
    expect(prompt).not.toContain("2080-LC20-20QWB");
  });

  it("an answered turn under a component names the component before any answer content", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    const out = await frames(await ask("what does fault oC mean", under(VFD, 3)));
    const at = out.findIndex((f) => f.kind === "component");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(out[at]).toMatchObject({ componentId: VFD, revision: 2, actions: [] });
    const firstOther = out.findIndex((f) => f.kind !== "component" && f.kind !== "trace");
    expect(at).toBeLessThan(firstOther);
  });

  const HISTORY = [
    { role: "user", content: "what is the P042 deceleration time on the PLC" },
    { role: "assistant", content: "P042 sets the deceleration time." },
    { role: "user", content: "what is the GS13N-20P2 input current" },
    { role: "assistant", content: "That number is not in this manual." },
  ];
  const providerText = () => {
    const call = seamMock.buildRequestBody.mock.calls.at(-1) as unknown as [unknown, { role: string; content: string }[]] | undefined;
    if (!call) throw new Error("no provider request was built");
    return call[1].slice(1).map((m) => m.content).join("\n");
  };

  it("the model sees only the conversation asked under this selection, not another component's topic", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    storeMock.listSelectionTurns.mockResolvedValue([
      { id: "t1", question: HISTORY[0].content, answerStatus: "answered", basis: "documents", createdAt: "2026-11-14T03:50:00.000Z", componentId: null, componentRevision: null, clientRequestId: null, answerText: null, evidence: [] },
      { id: "t2", question: HISTORY[2].content, answerStatus: "insufficient_evidence", basis: null, createdAt: "2026-11-14T04:05:00.000Z", componentId: VFD, componentRevision: 2, clientRequestId: null, answerText: null, evidence: [] },
    ]);
    await frames(await ask("and its fuse size?", { ...under(VFD, 3), history: HISTORY }));
    const text = providerText();
    expect(text).not.toContain("P042");
    expect(text).toContain("GS13N-20P2 input current");
    expect(String(ragMock.retrieveNodeChunks.mock.calls[0]?.[2] ?? "")).not.toContain("P042");
  });

  it("the first question under a selection carries no earlier conversation at all", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    storeMock.listSelectionTurns.mockResolvedValue([
      { id: "t1", question: HISTORY[0].content, answerStatus: "answered", basis: "documents", createdAt: "2026-11-14T03:50:00.000Z", componentId: null, componentRevision: null, clientRequestId: null, answerText: null, evidence: [] },
    ]);
    await frames(await ask("and its fuse size?", { ...under(VFD, 3), history: HISTORY }));
    const text = providerText();
    expect(text).not.toContain("P042");
    expect(text).not.toContain("GS13N-20P2");
  });

  // #5504 Codex r2 F2: the client's history is text with no turn ids, so under a component the
  // conversation comes from the saved turns only. A marker the system prompt never contains.
  const STALE_A = [
    { role: "user", content: "what is the ZQX-A-ONLY-7731 setting on the drive" },
    { role: "assistant", content: "ZQX-A-ONLY-7731 answer about the drive." },
  ];
  const savedUnder = (componentId: string, revision: number, id: string, question: string, answerText: string | null, extra: Record<string, unknown> = {}) => ({
    id, question, answerStatus: "answered", basis: "documents", createdAt: "2026-11-14T04:05:00.000Z",
    componentId, componentRevision: revision, clientRequestId: null, answerText, evidence: [], ...extra,
  });
  const allProviderText = () => `${systemPrompt()}\n${providerText()}`;

  it("stale client history from another component never reaches retrieval, the topic hint or the model; the saved turn does", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    storeMock.getSelection.mockResolvedValue(selection(K1, 1, 4));
    storeMock.listSelectionTurns.mockResolvedValue([savedUnder(K1, 1, "tb", "what is the Q1 coil voltage", "The Q1 coil is 24 V DC.")]);
    await frames(await ask("and its auxiliary contacts?", { ...under(K1, 4), history: STALE_A }));
    expect(allProviderText()).not.toContain("ZQX-A-ONLY-7731");
    expect(String(ragMock.retrieveNodeChunks.mock.calls[0]?.[2] ?? "")).not.toContain("ZQX-A-ONLY-7731");
    expect(providerText()).toContain("what is the Q1 coil voltage");
    expect(providerText()).toContain("The Q1 coil is 24 V DC.");
  });

  it("two screens: the stale selection gets 409, and the retry under the new selection carries only its saved turns", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    // Screen 2 moved this conversation to Q1 (version 4) and asked one question there.
    storeMock.getSelection.mockResolvedValue(selection(K1, 1, 4));
    storeMock.listSelectionTurns.mockResolvedValue([savedUnder(K1, 1, "tb", "what is the Q1 coil voltage", "The Q1 coil is 24 V DC.")]);
    // Screen 1 still shows VFD1 (version 3) and A's conversation.
    const stale = await ask("and its fuse size?", { ...under(VFD, 3), history: STALE_A });
    expect(stale.status).toBe(409);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    // After the 409 it re-reads the checklist (now Q1) but still holds A's conversation text.
    const retry = await ask("and its auxiliary contacts?", { ...under(K1, 4), history: STALE_A, clientRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    await frames(retry);
    expect(allProviderText()).not.toContain("ZQX-A-ONLY-7731");
    expect(String(ragMock.retrieveNodeChunks.mock.calls.at(-1)?.[2] ?? "")).not.toContain("ZQX-A-ONLY-7731");
    expect(providerText()).toContain("The Q1 coil is 24 V DC.");
  });

  it("no saved turn under the selection: nothing carries, whatever the client sends", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    storeMock.listSelectionTurns.mockResolvedValue([
      // Before the pick, under another revision, and the request being answered now: none count.
      savedUnder(VFD, 2, "t0", "asked before the pick ZQX-BEFORE", "x", { createdAt: "2026-11-14T03:59:00.000Z" }),
      savedUnder(VFD, 1, "t1", "asked under the old revision ZQX-OLDREV", "x"),
      savedUnder(VFD, 2, "t2", "this very request ZQX-SELF", "x", { clientRequestId: REQ }),
    ]);
    await frames(await ask("and its fuse size?", { ...under(VFD, 3), history: STALE_A }));
    const call = seamMock.buildRequestBody.mock.calls.at(-1) as unknown as [unknown, { role: string; content: string }[]];
    expect(call[1].map((m) => m.role)).toEqual(["system", "user"]);
    expect(allProviderText()).not.toMatch(/ZQX-(A-ONLY|BEFORE|OLDREV|SELF)/);
  });

  it("saved turns follow the same rule as the screen: a failed answer and anything after a safety stop never carry", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    storeMock.listSelectionTurns.mockResolvedValue([
      savedUnder(VFD, 2, "t1", "first drive question", "ZQX-ERRORED answer", { answerStatus: "error" }),
      savedUnder(VFD, 2, "t2", "second drive question", "ZQX-GOOD answer", { createdAt: "2026-11-14T04:06:00.000Z" }),
    ]);
    await frames(await ask("and its fuse size?", under(VFD, 3)));
    const text = providerText();
    expect(text).toContain("first drive question");
    expect(text).not.toContain("ZQX-ERRORED");
    expect(text).toContain("ZQX-GOOD answer");
  });

  it("control: without a component the conversation history reaches the model as before", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    await frames(await ask("and its fuse size?", { history: HISTORY }));
    expect(providerText()).toContain("P042");
  });

  it("the saved technician reports given to the model are only the ones asked under this selection", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    const THREAD = "77777777-aaaa-4aaa-8aaa-777777777777";
    const turns = [
      { id: "t1", question: "the PLC1 analog card reads zarquon volts", answerStatus: "answered", basis: "documents", createdAt: "2026-11-14T03:50:00.000Z", componentId: null, componentRevision: null, clientRequestId: null, answerText: null, evidence: [] },
      { id: "t2", question: HISTORY[2].content, answerStatus: "insufficient_evidence", basis: null, createdAt: "2026-11-14T04:05:00.000Z", componentId: VFD, componentRevision: 2, clientRequestId: null, answerText: null, evidence: [] },
    ];
    storeMock.listSelectionTurns.mockResolvedValue(turns);
    nbMock.listTurns.mockResolvedValue(turns.map((t) => ({ ...t, ownerUserId: "u1" })));
    await frames(await ask("and its fuse size?", { componentSelection: { threadId: THREAD, componentId: VFD, selectionVersion: 3 }, threadId: THREAD }));
    const all = `${systemPrompt()}\n${providerText()}`;
    expect(all).toContain("PERSISTED TECHNICIAN REPORTS");
    expect(all).toContain("GS13N-20P2 input current");
    expect(all).not.toContain("zarquon");
  });

  it("only questions asked under this selection carry; an earlier question in the same chat does not", async () => {
    storeMock.listSelectionTurns.mockResolvedValue([
      // Before this pick (selected 04:00): asked about the PLC.
      { id: "t1", question: "what is the 2080-LC50-48QWB input rating", answerStatus: "insufficient_evidence", basis: null, createdAt: "2026-11-14T03:50:00.000Z", componentId: null, componentRevision: null, clientRequestId: null, answerText: null, evidence: [] },
      // Under it: a sibling ask, unanswered.
      { id: "t2", question: "what is the GS13N-20P2 input current", answerStatus: "insufficient_evidence", basis: null, createdAt: "2026-11-14T04:05:00.000Z", componentId: VFD, componentRevision: 2, clientRequestId: null, answerText: null, evidence: [] },
    ]);
    await frames(await ask("and its fuse size?", under(VFD, 3)));
    const opts = retrievalOpts()!;
    expect(opts.subjectQueries).toEqual(["what is the GS13N-20P2 input current"]);
    expect(opts.subjectOutOfReach).toBe(false);
    expect(storeMock.listSelectionTurns).toHaveBeenCalledWith(TENANT, NB, "u1", null, 6);
  });

  it("a refusal under the component offers Return to it as an action, and names both numbers", async () => {
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, _q: unknown, opts: unknown) => {
      const d = (opts as { diagnostics?: Record<string, unknown> }).diagnostics;
      if (d) d.siblingOfRecordAsk = { asked: ["GS13N-20P2"], record: "GS11N-20P2" };
      return [];
    });
    const out = await frames(await ask("what is the GS13N-20P2 input current", under(VFD, 3)));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const status = statusOf(out);
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toContain("GS11N-20P2");
    expect(status.message).toContain("GS13N-20P2");
    const frame = componentFrame(out)!;
    expect(frame).toMatchObject({ componentId: VFD, revision: 2, selectionVersion: 3, label: "VFD1 · AutomationDirect GS11N-20P2" });
    expect(frame.actions).toEqual([{ action: "return", componentId: VFD, label: "VFD1 · AutomationDirect GS11N-20P2" }]);
  });

  it("a project with nothing it can search answers nothing about the component, says so, and offers Return", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: null });
    const out = await frames(await ask("what does fault oC mean", under(VFD, 3)));
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(statusOf(out)).toMatchObject({ status: "insufficient_evidence", message: noDocumentsForComponentText("VFD1 · AutomationDirect GS11N-20P2") });
    expect(componentFrame(out)!.actions).toEqual([{ action: "return", componentId: VFD, label: "VFD1 · AutomationDirect GS11N-20P2" }]);
  });

  it("an identity corrected on another screen is re-checked: the selection advances and the frame carries the new version", async () => {
    storeMock.getSelection.mockResolvedValue(selection(VFD, 1, 3));
    storeMock.advanceSelectionRevision.mockResolvedValue({ ...selection(VFD, 2, 4), selectedVia: "correction", selectedAt: "2026-11-14T04:30:00.000Z" });
    ragMock.retrieveNodeChunks.mockImplementation(async () => []);
    const out = await frames(await ask("what does fault oC mean", under(VFD, 3)));
    expect(storeMock.advanceSelectionRevision).toHaveBeenCalledWith(TENANT, NB, "u1", "legacy", 3, 2, REQ);
    expect(retrievalOpts()?.catalogNumber).toBe("GS11N-20P2");
    expect(componentFrame(out)?.selectionVersion).toBe(4);
  });
});

describe("a held turn reads no manual and calls no provider", () => {
  it("an unconfirmed component gets the confirm reply and a Confirm action", async () => {
    storeMock.getSelection.mockResolvedValue(selection(B1, 1, 1));
    const out = await frames(await ask("what voltage is this button rated for", under(B1, 1)));
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const status = statusOf(out);
    expect(status.status).toBe("insufficient_evidence");
    expect(status.message).toBe("B1 · IDEC YW1B isn't confirmed yet, so I won't answer from the manuals for it. Check what its label says and tap Confirm, then ask again.");
    expect(componentFrame(out)?.actions).toEqual([{ action: "confirm", componentId: B1, label: "B1 · IDEC YW1B" }]);
    expect(nbMock.recordTurn).toHaveBeenCalledWith(TENANT, NB, expect.objectContaining({ answerStatus: "insufficient_evidence", clientRequestId: REQ }));
    expect(storeMock.stampTurnComponent).toHaveBeenCalledWith(TENANT, NB, "u1", REQ, B1, 1);
  });

  it("a question naming another component's exact catalog number asks to switch, and never switches by itself", async () => {
    const out = await frames(await ask("what coil voltage does the CA3KN22BD need", under(VFD, 3)));
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(storeMock.setSelection).not.toHaveBeenCalled();
    const status = statusOf(out);
    expect(status.message).toContain("asking about VFD1 · AutomationDirect GS11N-20P2");
    expect(status.message).toContain("CA3KN22BD, which is Q1 · Schneider Electric CA3KN22BD");
    expect(componentFrame(out)?.actions).toEqual([
      { action: "switch", componentId: K1, label: "Q1 · Schneider Electric CA3KN22BD" },
      { action: "stay", componentId: VFD, label: "VFD1 · AutomationDirect GS11N-20P2" },
    ]);
  });

  it("control: a look-alike of another component's number is not that component — the turn stays scoped", async () => {
    await frames(await ask("what coil voltage does the CA3KN22B7 need", under(VFD, 3)));
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalled();
    expect(retrievalOpts()?.catalogNumber).toBe("GS11N-20P2");
  });

  it("safety wins: an energized-work ask under an unconfirmed component gets the stop, not the hold text", async () => {
    storeMock.getSelection.mockResolvedValue(selection(B1, 1, 1));
    const out = await frames(await ask("How do I pull the RFI jumper with it powered?", under(B1, 1)));
    expect(out.find((f) => f.kind === "safety")).toBeDefined();
    const content = out.filter((f) => f.kind === "content").map((f) => String(f.content)).join("");
    expect(content).not.toContain("isn't confirmed yet");
    expect(statusOf(out).message ?? "").not.toContain("isn't confirmed yet");
  });

  it("a safety flag does not lift the hold: the hold text is served under the banner, with no manual and no provider", async () => {
    storeMock.getSelection.mockResolvedValue(selection(B1, 1, 1));
    const out = await frames(await ask("I smell burning from the panel, what voltage is this button rated for", under(B1, 1)));
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(statusOf(out)).toMatchObject({
      status: "insufficient_evidence",
      message: withSafetyFlag("B1 · IDEC YW1B isn't confirmed yet, so I won't answer from the manuals for it. Check what its label says and tap Confirm, then ask again.", "smell burning"),
    });
    expect(componentFrame(out)?.actions).toEqual([{ action: "confirm", componentId: B1, label: "B1 · IDEC YW1B" }]);
  });

  it("the energized-electrical notice on a held turn is saved with it, so a reload shows the same flag", async () => {
    const question = "how do I measure the 480V input with a meter while it is live";
    expect(notebookSafetyTrigger(question)).toBe(ENERGIZED_ELECTRICAL_HAZARD);
    storeMock.getSelection.mockResolvedValue(selection(B1, 1, 1));
    const out = await frames(await ask(question, under(B1, 1)));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(statusOf(out).message).toContain("isn't confirmed yet");
    expect(nbMock.recordTurn).toHaveBeenCalledWith(TENANT, NB, expect.objectContaining({
      answerStatus: "insufficient_evidence",
      evidence: expect.arrayContaining([{ kind: "safety_notice", trigger: ENERGIZED_ELECTRICAL_HAZARD }]),
    }));
  });
});

describe("the selection the client showed is checked, not trusted", () => {
  it("a stale selection version is a 409 that answers nothing and releases the claim", async () => {
    const res = await ask("what does fault oC mean", under(VFD, 2));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; selection: { version: number } };
    expect(body.error).toBe("selection_changed");
    expect(body.selection.version).toBe(3);
    expect(nbMock.abandonNotebookTurnRequest).toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(storeMock.stampTurnComponent).not.toHaveBeenCalled();
  });

  it("a hazard report under a stale selection is not turned away: the banner is served and nothing is answered for any component", async () => {
    const res = await ask("I smell burning from the panel, what voltage is this button rated for", under(VFD, 2));
    expect(res.status).toBe(200);
    const out = await frames(res);
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(statusOf(out)).toMatchObject({ status: "insufficient_evidence", message: withSafetyFlag(selectionMovedText, "smell burning") });
    expect(componentFrame(out)).toBeUndefined();
    expect(storeMock.stampTurnComponent).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).toHaveBeenCalledWith(TENANT, NB, expect.objectContaining({ answerStatus: "insufficient_evidence", clientRequestId: REQ }));
  });

  it("an energized-work ask under a stale selection gets the stop, not the 409", async () => {
    const res = await ask("How do I pull the RFI jumper with it powered?", under(VFD, 2));
    expect(res.status).toBe(200);
    const out = await frames(res);
    expect(out.find((f) => f.kind === "safety")).toBeDefined();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("an exact retry replays its stored answer before the selection is consulted", async () => {
    nbMock.claimNotebookTurnRequest.mockResolvedValue({
      status: "replay",
      turn: { id: "turn-row-1", question: "q", answerStatus: "answered", answerText: "stored", citations: [], evidence: [], createdAt: SELECTED_AT },
    });
    const res = await ask("what does fault oC mean", under(VFD, 2));
    expect(res.status).toBe(200);
    expect(storeMock.getSelection).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed selection", { componentSelection: { threadId: null, componentId: "VFD1", selectionVersion: 3 } }, "invalid_component_selection"],
    ["scope read for another conversation", { componentSelection: { threadId: "77777777-7777-4777-8777-777777777777", componentId: VFD, selectionVersion: 3 } }, "component_selection_thread_mismatch"],
    ["whole machine with no conversation named", { componentSelection: { componentId: null, selectionVersion: null } }, "component_selection_thread_mismatch"],
    ["whole machine with a malformed version", wholeMachine(0), "invalid_component_selection"],
    ["general mode", { ...under(VFD, 3), mode: "general" }, "component_selection_not_general"],
    ["no request id", { ...under(VFD, 3), clientRequestId: undefined }, "client_request_id_required"],
  ])("%s is a 400 before anything is claimed", async (_name, extra, error) => {
    const res = await ask("what does fault oC mean", extra);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(error);
    expect(nbMock.claimNotebookTurnRequest).not.toHaveBeenCalled();
  });
});

// #5504 Codex r2 F1: an answer keeps the component it was asked under. The label is saved WITH
// the turn from the frame the stream sent, so a reload, a retry or a later header change cannot
// relabel it.
describe("each answer saves the component it was asked under", () => {
  const savedEvidence = () => {
    const call = nbMock.recordTurn.mock.calls.at(-1) as unknown as [string, string, { evidence: unknown[] }] | undefined;
    if (!call) throw new Error("no turn was saved");
    return call[2].evidence;
  };
  const attribution = (evidence: unknown[]) => evidence.filter((e) => (e as { kind?: string }).kind === "component_attribution");

  it("an answered turn saves exactly the component the stream named", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    const out = await frames(await ask("what does fault oC mean", under(VFD, 3)));
    const frame = componentFrame(out)!;
    expect(attribution(savedEvidence())).toEqual([
      { kind: "component_attribution", componentId: VFD, revision: 2, selectionVersion: frame.selectionVersion, label: frame.label },
    ]);
    expect(frame.label).toContain("VFD1");
  });

  it("a held turn saves the held component too", async () => {
    storeMock.getSelection.mockResolvedValue(selection(B1, 1, 1));
    await frames(await ask("what voltage is this button rated for", under(B1, 1)));
    expect(attribution(savedEvidence())).toEqual([
      { kind: "component_attribution", componentId: B1, revision: 1, selectionVersion: 1, label: "B1 · IDEC YW1B" },
    ]);
  });

  it("control: a turn with no component saves no attribution", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    await frames(await ask("what does fault oC mean"));
    expect(attribution(savedEvidence())).toEqual([]);
  });

  it("a retried request replays the saved component frame, without the buttons", async () => {
    nbMock.claimNotebookTurnRequest.mockResolvedValue({
      status: "replay",
      turn: {
        id: "turn-row-1", question: "what does fault oC mean", answerStatus: "answered", answerText: "oC is overcurrent.",
        enabledSourceDocIds: [DOC_A], model: "m", basis: "documents",
        evidence: [{ kind: "component_attribution", componentId: VFD, revision: 2, selectionVersion: 3, label: "VFD1 · AutomationDirect GS11N-20P2" }],
      },
    });
    const out = await frames(await ask("what does fault oC mean", under(VFD, 3)));
    expect(componentFrame(out)).toEqual({ kind: "component", componentId: VFD, revision: 2, selectionVersion: 3, label: "VFD1 · AutomationDirect GS11N-20P2", actions: [] });
    const at = out.findIndex((f) => f.kind === "component");
    expect(at).toBeLessThan(out.findIndex((f) => f.kind === "content"));
  });
});

// #5504 Codex r3 F7: a photo read under one component never feeds an answer about another.
describe("earlier photos carry only within the selection they were asked under", () => {
  const A_MARK = "ZQX-PHOTO-A-ONLY-4417 rated 480 V";
  const B_MARK = "ZQX-PHOTO-B-OWN-5528 rated 230 V";
  const PHOTO_A = "77777777-7777-4777-8777-777777777771";
  const PHOTO_B = "77777777-7777-4777-8777-777777777772";
  const look = (fileId: string, text: string) => ({
    observationId: `obs-${fileId}`, sessionId: "s1", text, obsKind: "nameplate", trust: "candidate", confidence: 0.9,
    fileId, photoHash: null, observedAt: "2026-11-14T04:10:00.000Z", hazards: [],
  });
  const photoTurn = (id: string, fileId: string, extra: Record<string, unknown> = {}) => ({
    id, question: "read this nameplate", answerStatus: "answered", answerText: "That nameplate reads 480 V.", basis: "documents",
    createdAt: "2026-11-14T04:10:00.000Z", ownerUserId: "u1",
    evidence: [{ kind: "visual_observation", fileId, capturedAt: "2026-11-14T04:09:00.000Z", provenance: "phone_photo" }], ...extra,
  });
  const modelInput = () => JSON.stringify(ragMock.buildManualUserContent.mock.calls);
  const savedRun = (id: string, componentId: string, revision: number) => ({
    id, question: "read this nameplate", answerStatus: "answered", basis: "documents", createdAt: "2026-11-14T04:10:00.000Z",
    componentId, componentRevision: revision, clientRequestId: null, answerText: "That nameplate reads 230 V.", evidence: [],
  });

  beforeEach(() => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    vi.mocked(photoLinkedToTarget).mockImplementation(async (_t: string, fileId: string) => ({ fileId, capturedAt: "2026-11-14T04:09:00.000Z" }) as never);
  });

  it("a standalone photo reading (no record of which component it was about) is not recalled under a component", async () => {
    lookMock.loadRecentLookObservations.mockResolvedValue([look(PHOTO_A, A_MARK)]);
    await frames(await ask("and its rated current?", under(VFD, 3)));
    expect(modelInput()).toContain("and its rated current?");
    expect(modelInput()).not.toContain("ZQX-PHOTO-A-ONLY-4417");
  });

  it("a photo answered under another component (or before this selection) is not recalled", async () => {
    nbMock.listTurns.mockResolvedValue([photoTurn("t-a", PHOTO_A)]);
    lookMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) => (args[2] === PHOTO_A ? look(PHOTO_A, A_MARK) : null));
    storeMock.listSelectionTurns.mockResolvedValue([]);
    await frames(await ask("and its rated current?", under(VFD, 3)));
    expect(modelInput()).not.toContain("ZQX-PHOTO-A-ONLY-4417");
  });

  it("after an identity correction the old revision's photo is not recalled", async () => {
    nbMock.listTurns.mockResolvedValue([photoTurn("t-old", PHOTO_A)]);
    lookMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) => (args[2] === PHOTO_A ? look(PHOTO_A, A_MARK) : null));
    storeMock.listSelectionTurns.mockResolvedValue([savedRun("t-old", VFD, 1)]); // asked under revision 1; the selection is revision 2
    await frames(await ask("and its rated current?", under(VFD, 3)));
    expect(modelInput()).not.toContain("ZQX-PHOTO-A-ONLY-4417");
  });

  it("control: a photo answered under this same selection is still recalled for a follow-up", async () => {
    nbMock.listTurns.mockResolvedValue([photoTurn("t-b", PHOTO_B)]);
    lookMock.loadVisualEvidenceForPhoto.mockImplementation(async (...args: unknown[]) => (args[2] === PHOTO_B ? look(PHOTO_B, B_MARK) : null));
    storeMock.listSelectionTurns.mockResolvedValue([savedRun("t-b", VFD, 2)]);
    await frames(await ask("and its rated current?", under(VFD, 3)));
    expect(modelInput()).toContain("ZQX-PHOTO-B-OWN-5528");
  });

  it("control: with no component selected, earlier photos are recalled as before", async () => {
    lookMock.loadRecentLookObservations.mockResolvedValue([look(PHOTO_A, A_MARK)]);
    await frames(await ask("and its rated current?"));
    expect(modelInput()).toContain("ZQX-PHOTO-A-ONLY-4417");
  });
});

// #5504 post-cap F7: the bound machine's stored nameplate readings are about the machine (often
// another component on it), so they never reach an answer about a selected component.
describe("the bound machine's nameplate readings stay out of component answers", () => {
  const PLC_MARK = "ZQX-PLC-NAMEPLATE-9931 Micro820 supply 24 VDC";
  const ASSET = "66666666-6666-4666-8666-666666666666";
  const reading = {
    observationId: "obs-plc", sessionId: "s1", text: PLC_MARK, obsKind: "nameplate", trust: "verified", confidence: 0.95,
    fileId: null, photoHash: null, observedAt: "2026-11-14T04:10:00.000Z", hazards: [],
  };

  beforeEach(() => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    nbMock.resolveBoundAsset.mockResolvedValue({
      state: "resolved", entityId: ASSET, name: "CV-101", unsPath: "enterprise.garage.demo_cell.cv_101", selectedVia: "picker",
      confirmedAt: "2026-11-14T01:00:00.000Z", manufacturer: null, model: null, catalogNumber: null,
    } as never);
    lookMock.loadVisualEvidenceForAsset.mockResolvedValue([reading]);
  });
  afterEach(() => {
    nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" } as never);
  });

  it("under a confirmed component the machine's nameplate reading is not in the prompt", async () => {
    await frames(await ask("what supply voltage does it take?", under(VFD, 3)));
    expect(systemPrompt()).toContain("CV-101"); // the bound machine was resolved for this turn
    expect(systemPrompt()).not.toContain("ZQX-PLC-NAMEPLATE-9931");
    expect(systemPrompt()).not.toContain("nameplate photographed on THIS machine");
  });

  it("after an identity correction (selection on a newer revision) it is still not in the prompt", async () => {
    storeMock.listComponents.mockResolvedValue([
      component(VFD, 1, "VFD", rev(VFD, 3, { manufacturer: "AutomationDirect", family: "GS10", catalogNumber: "GS11N-20P5", localTag: "VFD1" })),
      K1_ROW, B1_ROW,
    ]);
    storeMock.getSelection.mockResolvedValue(selection(VFD, 3, 4));
    await frames(await ask("what supply voltage does it take?", under(VFD, 4)));
    expect(systemPrompt()).toContain("CV-101");
    expect(systemPrompt()).not.toContain("ZQX-PLC-NAMEPLATE-9931");
  });

  it("control: on a whole-machine turn (no component, or after Return) the reading is used as before", async () => {
    storeMock.getSelection.mockResolvedValue(null);
    await frames(await ask("what supply voltage does it take?"));
    expect(systemPrompt()).toContain("ZQX-PLC-NAMEPLATE-9931");
  });
});

// #5504 Codex r3 F8: a held turn needs no inference, so a non-English question is not translated first.
describe("a held non-English question calls no translation", () => {
  it("unconfirmed component", async () => {
    storeMock.getSelection.mockResolvedValue(selection(B1, 1, 1));
    const out = await frames(await ask("¿Cuál es el voltaje de este botón?", under(B1, 1)));
    expect(statusOf(out).status).toBe("insufficient_evidence");
    expect(translateMock.translateForSearch).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("the question names another component", async () => {
    const out = await frames(await ask("¿Qué voltaje de bobina necesita el CA3KN22BD?", under(VFD, 3)));
    expect(componentFrame(out)?.actions.map((a) => a.action)).toEqual(["switch", "stay"]);
    expect(translateMock.translateForSearch).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("control: a scoped non-English question is still translated for the search", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    await frames(await ask("¿Qué significa la falla oC?", under(VFD, 3)));
    expect(translateMock.translateForSearch).toHaveBeenCalled();
  });
});

// #5504 cheap review r7: a UUID is the same id in either letter case.
describe("the component id is compared case-insensitively", () => {
  it("an upper-case spelling of the selected component's id is the same selection, not a 409", async () => {
    const LETTERED = "4444abcd-4444-4444-8444-44444444abcd";
    expect(LETTERED.toUpperCase()).not.toBe(LETTERED); // precondition: the case actually differs
    storeMock.listComponents.mockResolvedValue([{ ...VFD_ROW, id: LETTERED, current: { ...VFD_ROW.current, componentId: LETTERED } }, K1_ROW, B1_ROW]);
    storeMock.getSelection.mockResolvedValue(selection(LETTERED, 2, 3));
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    const res = await ask("what does fault oC mean", under(LETTERED.toUpperCase(), 3));
    expect(res.status).toBe(200);
    await frames(res);
    expect(retrievalOpts()?.catalogNumber).toBe("GS11N-20P2");
  });
});

// #5504 post-cap F9/F10: the server, not the screen, decides whether a question has a component.
// A question with no scope, or an explicit whole-machine scope, is checked against the saved
// choice; a saved component is never answered as the whole machine, whatever the screen missed.
describe("every question's scope is checked against the saved choice", () => {
  const WM_A = [
    { role: "user", content: "what is the ZQX-COMPONENT-ONLY-5504 setting" },
    { role: "assistant", content: "ZQX-COMPONENT-ONLY-5504 answer about the drive." },
  ];
  const saved = (id: string, componentId: string | null, question: string, answerText: string) => ({
    id, question, answerStatus: "answered", basis: "documents", createdAt: "2026-11-14T04:05:00.000Z",
    componentId, componentRevision: componentId ? 2 : null, clientRequestId: null, answerText, evidence: [],
  });
  const providerMessages = () => {
    const call = seamMock.buildRequestBody.mock.calls.at(-1) as unknown as [unknown, { role: string; content: string }[]] | undefined;
    if (!call) throw new Error("no provider request was built");
    return call[1].map((m) => m.content).join("\n");
  };
  const noProviderNoRetrieval = () => {
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(seamMock.buildRequestBody).not.toHaveBeenCalled();
  };

  it("a saved component and a question sent with no scope (a lost or late read) is a 409, never answered", async () => {
    storeMock.getSelectionState.mockResolvedValue({ selection: selection(VFD, 2, 3), version: 3 });
    const res = await ask("what is the rated current");
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; selection: { componentId: string; version: number } };
    expect(body.error).toBe("selection_changed");
    expect(body.selection).toMatchObject({ componentId: VFD, version: 3 });
    noProviderNoRetrieval();
    expect(nbMock.abandonNotebookTurnRequest).toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });

  it("F9: the screen read the old empty selection, the lost pick committed afterwards — the whole-machine send is a 409", async () => {
    // The screen's recovery read saw nothing selected (version null); the pick of VFD1 then committed.
    storeMock.getSelectionState.mockResolvedValue({ selection: selection(VFD, 2, 1), version: 1 });
    const res = await ask("what is the rated current", wholeMachine(null));
    expect(res.status).toBe(409);
    noProviderNoRetrieval();
  });

  it("F9: Send before the delayed commit — still nothing saved — is answered for the whole machine it was labelled", async () => {
    storeMock.getSelectionState.mockResolvedValue({ selection: null, version: null });
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    const res = await ask("what is the rated current", wholeMachine(null));
    expect(res.status).toBe(200);
    const out = await frames(res);
    expect(componentFrame(out)).toBeUndefined();
    expect(retrievalOpts()?.catalogNumber).toBe("2080-LC20-20QWB");
    expect(storeMock.stampTurnComponent).not.toHaveBeenCalled();
  });

  it("F10: a question for B carrying the scope read for conversation A is refused before anything is claimed", async () => {
    const res = await ask("what is the rated current", {
      threadId: "88888888-8888-4888-8888-888888888888",
      componentSelection: { threadId: "77777777-7777-4777-8777-777777777777", componentId: null, selectionVersion: null },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("component_selection_thread_mismatch");
    expect(nbMock.claimNotebookTurnRequest).not.toHaveBeenCalled();
    noProviderNoRetrieval();
  });

  it("F10: a saved component on B and an explicit whole-machine scope (A's late read) is a 409", async () => {
    storeMock.getSelectionState.mockResolvedValue({ selection: selection(K1, 1, 2), version: 2 });
    const res = await ask("what is the rated current", wholeMachine(2));
    expect(res.status).toBe(409);
    noProviderNoRetrieval();
  });

  it("a whole-machine question with no version, against a saved clear that has one, is a 409", async () => {
    storeMock.getSelectionState.mockResolvedValue({ selection: null, version: 5 });
    const res = await ask("what is the rated current", wholeMachine(null));
    expect(res.status).toBe(409);
    noProviderNoRetrieval();
  });

  it("cleared on another screen: the version the screen read must be the saved one", async () => {
    storeMock.getSelectionState.mockResolvedValue({ selection: null, version: 5 });
    const stale = await ask("what is the rated current", wholeMachine(4));
    expect(stale.status).toBe(409);
    noProviderNoRetrieval();
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    const fresh = await ask("what is the rated current", { ...wholeMachine(5), clientRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    expect(fresh.status).toBe(200);
    await frames(fresh);
    expect(retrievalOpts()?.catalogNumber).toBe("2080-LC20-20QWB");
  });

  it("a hazard report with a missing scope under a saved component gets the banner and answers nothing", async () => {
    storeMock.getSelectionState.mockResolvedValue({ selection: selection(VFD, 2, 3), version: 3 });
    const res = await ask("I smell burning from the panel, what voltage is this rated for");
    expect(res.status).toBe(200);
    const out = await frames(res);
    noProviderNoRetrieval();
    expect(statusOf(out)).toMatchObject({ status: "insufficient_evidence", message: withSafetyFlag(selectionMovedText, "smell burning") });
  });

  it("an energized-work ask with a missing scope under a saved component still gets the stop", async () => {
    storeMock.getSelectionState.mockResolvedValue({ selection: selection(VFD, 2, 3), version: 3 });
    const res = await ask("How do I pull the RFI jumper with it powered?");
    expect(res.status).toBe(200);
    const out = await frames(res);
    expect(out.find((f) => f.kind === "safety")).toBeDefined();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("an explicit whole-machine question sees only the saved whole-machine turns, never a component's", async () => {
    storeMock.getSelectionState.mockResolvedValue({ selection: null, version: 4 });
    storeMock.listSelectionTurns.mockResolvedValue([
      saved("t1", VFD, "what is the ZQX-COMPONENT-ONLY-5504 setting", "ZQX-COMPONENT-ONLY-5504 answer about the drive."),
      saved("t2", null, "what does the ZQX-MACHINE-TURN conveyor do", "It moves ZQX-MACHINE-TURN boxes."),
    ]);
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    await frames(await ask("and how fast does it run?", { ...wholeMachine(4), history: WM_A }));
    expect(providerMessages()).not.toContain("ZQX-COMPONENT-ONLY-5504");
    expect(String(ragMock.retrieveNodeChunks.mock.calls[0]?.[2] ?? "")).not.toContain("ZQX-COMPONENT-ONLY-5504");
    expect(providerMessages()).toContain("It moves ZQX-MACHINE-TURN boxes.");
  });

  it("control: a client that sends no scope on a conversation with nothing saved keeps today's history", async () => {
    storeMock.getSelectionState.mockResolvedValue({ selection: null, version: null });
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    await frames(await ask("and how fast does it run?", { history: WM_A }));
    expect(providerMessages()).toContain("ZQX-COMPONENT-ONLY-5504");
    expect(storeMock.listSelectionTurns).not.toHaveBeenCalled();
  });

  it("an explicit whole-machine scope rides a general-mode turn", async () => {
    storeMock.getSelectionState.mockResolvedValue({ selection: null, version: 2 });
    const res = await ask("what is a contactor", { ...wholeMachine(2), mode: "general", sourceDocIds: [] });
    expect(res.status).not.toBe(400);
  });

  it("a general-mode turn with no scope under a saved component is a 409 too", async () => {
    storeMock.getSelectionState.mockResolvedValue({ selection: selection(VFD, 2, 3), version: 3 });
    const res = await ask("what is a contactor", { mode: "general", sourceDocIds: [] });
    expect(res.status).toBe(409);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it.each([
    ["no scope", {}],
    ["explicit whole machine", { componentSelection: { threadId: null, componentId: null, selectionVersion: null } }],
  ])("control: where migration 115 is not applied (%s), the turn takes today's path", async (_name, extra) => {
    storeMock.getSelectionState.mockRejectedValue(Object.assign(new Error('relation "notebook_thread_selections" does not exist'), { code: "42P01" }));
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    const res = await ask("what does fault oC mean", extra);
    expect(res.status).toBe(200);
    await frames(res);
    expect(retrievalOpts()?.catalogNumber).toBe("2080-LC20-20QWB");
  });

  it("a selection read that fails for any other reason answers nothing", async () => {
    storeMock.getSelectionState.mockRejectedValue(new Error("connection reset"));
    await expect(ask("what does fault oC mean")).rejects.toThrow("connection reset");
    expect(nbMock.abandonNotebookTurnRequest).toHaveBeenCalled();
    noProviderNoRetrieval();
  });
});

// #5504 post-cap F9/F10, on the actual request path: the tablet's own send and change functions
// (prepareChatSend / changeSelection / readBench — what hub-host.send and BenchComponents run)
// build the request, and the real chat route answers it. A small in-memory server holds the saved
// selection; its write can commit after the tablet has given up on the reply. The assertion is
// always the same: a provider call happens only under the scope the header showed, otherwise the
// question is refused and nothing is answered.
describe("the tablet's request path against the route: intended scope or refusal", () => {
  type Saved = { componentId: string | null; version: number | null };
  let saved: Saved;
  const server = {
    get state() {
      return saved.componentId
        ? { selection: selection(saved.componentId, saved.componentId === VFD ? 2 : 1, saved.version!), version: saved.version }
        : { selection: null, version: saved.version };
    },
  };
  const TH = null; // the default conversation ("legacy")
  const SELA = { notebookId: NB, threadId: "legacy" };
  const benchJson = () =>
    new Response(JSON.stringify({
      components: [], lastTurn: null, turnComponents: {}, tallies: {}, documentNumbers: [],
      selection: server.state.selection ? { ...server.state.selection, current: true } : null,
      selectionVersion: saved.version,
    }), { status: 200 });
  /** Apply a selection write exactly once (by request id), as setSelection does. */
  const applied = new Set<string>();
  function commit(body: { componentId: string | null; expectedVersion: number | null; clientRequestId: string }) {
    if (applied.has(body.clientRequestId)) return new Response("{}", { status: 200 });
    if (saved.version !== body.expectedVersion) return new Response(JSON.stringify({ error: "selection_changed" }), { status: 409 });
    applied.add(body.clientRequestId);
    saved = { componentId: body.componentId, version: (saved.version ?? 0) + 1 };
    return new Response("{}", { status: 200 });
  }

  let logic: typeof import("@/factorylm-ui/bench-components-logic");
  beforeEach(async () => {
    logic = await import("@/factorylm-ui/bench-components-logic");
    saved = { componentId: null, version: null };
    applied.clear();
    storeMock.getSelectionState.mockImplementation(async () => server.state);
    storeMock.getSelection.mockImplementation(async () => server.state.selection);
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
  });

  /** One tablet screen: its gate, what its panel read, and its Send. */
  function screen() {
    const gate = logic.createBenchSendGate();
    const scopes: import("@/factorylm-ui/bench-components-logic").BenchScopes = new Map();
    const load = () => logic.readBench({ gate, url: "/components", fetch: async () => benchJson(), apply: (st) => logic.recordBenchScope(scopes, SELA, st) });
    let n = 0;
    async function send(message: string, retryOf?: Record<string, unknown>) {
      const body = retryOf ?? { message, sourceDocIds: [DOC_A], history: [], threadId: TH, clientRequestId: `dddddddd-dddd-4ddd-8ddd-${String(++n).padStart(12, "0")}` };
      const prepared = logic.prepareChatSend({ gate, forThisGate: true, sel: SELA, scopes, body });
      if (!prepared.ok) return { refused: prepared.message as string, body: null };
      vi.mocked(fetch).mockClear();
      ragMock.retrieveNodeChunks.mockClear();
      const res = await POST(req(prepared.body), params);
      if (res.status === 200) await frames(res);
      return { status: res.status, body: prepared.body, providerCalled: vi.mocked(fetch).mock.calls.length > 0, catalog: retrievalOpts()?.catalogNumber };
    }
    return { gate, scopes, load, send };
  }
  const change = (s: ReturnType<typeof screen>, componentId: string | null, put: (init: RequestInit) => Promise<Response>) =>
    logic.changeSelection({
      gate: s.gate, url: "/sel", load: s.load, fetch: (_u, init) => put(init),
      body: { threadId: "legacy", componentId, via: "picker", expectedVersion: saved.version, clientRequestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
    });

  it("F9: lost PUT reply, recovery GET sees the old empty selection, the PUT commits later — Send before and after the commit", async () => {
    const tab = screen();
    await tab.load();
    let pendingBody: { componentId: string | null; expectedVersion: number | null; clientRequestId: string } | null = null;
    let online = false;
    // The server takes the write but its transaction has not committed; the reply never arrives.
    const out = await change(tab, VFD, async (init) => {
      pendingBody ??= JSON.parse(String(init.body));
      if (!online) throw new TypeError("reply lost");
      return commit(pendingBody!);
    });
    expect(out.ok).toBe(false);
    // The panel's refresh reads the OLD empty selection (the write still hasn't committed).
    await tab.load();
    expect(saved.componentId).toBeNull();
    const before = await tab.send("what is the rated current");
    expect(before.refused).toBe(logic.SEND_UNRESOLVED_MESSAGE);

    commit(pendingBody!); // the delayed commit lands
    const stillUnresolved = await tab.send("what is the rated current");
    expect(stillUnresolved.refused).toBe(logic.SEND_UNRESOLVED_MESSAGE);

    // Even a body built by hand from the stale empty read is refused by the route, never answered.
    const handBuilt = await POST(req({ message: "what is the rated current", sourceDocIds: [DOC_A], clientRequestId: REQ, componentSelection: { threadId: null, componentId: null, selectionVersion: null } }), params);
    expect(handBuilt.status).toBe(409);

    online = true;
    await tab.load(); // re-sends the same request: the server replays its outcome
    const after = await tab.send("what is the rated current");
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ componentSelection: { threadId: null, componentId: VFD, selectionVersion: 1 } });
    expect(after.providerCalled).toBe(true);
    expect(after.catalog).toBe("GS11N-20P2");
  });

  it("an explicit whole-machine pick (clear) is sent as the whole machine with its version and answered for it", async () => {
    saved = { componentId: VFD, version: 3 };
    const tab = screen();
    await tab.load();
    await expect(change(tab, null, async (init) => commit(JSON.parse(String(init.body))))).resolves.toEqual({ ok: true });
    const r = await tab.send("what does the conveyor do");
    expect(r.body).toMatchObject({ componentSelection: { threadId: null, componentId: null, selectionVersion: 4 } });
    expect(r.status).toBe(200);
    expect(r.catalog).toBe("2080-LC20-20QWB");
  });

  it("two screens: the one that missed a change is refused, never answered under the old component", async () => {
    saved = { componentId: VFD, version: 3 };
    const one = screen();
    const two = screen();
    await one.load();
    await two.load();
    await expect(change(two, K1, async (init) => commit(JSON.parse(String(init.body))))).resolves.toEqual({ ok: true });
    const stale = await one.send("what is the coil voltage");
    expect(stale.status).toBe(409);
    expect(stale.providerCalled).toBe(false);
    await one.load(); // the host re-reads after a 409
    const fresh = await one.send("what is the coil voltage");
    expect(fresh.status).toBe(200);
    expect(fresh.catalog).toBe("CA3KN22BD");
  });

  it("a retry keeps the scope it was asked under: moved on another screen meanwhile, it is refused, not answered for the new one", async () => {
    saved = { componentId: VFD, version: 3 };
    const tab = screen();
    const other = screen();
    await tab.load();
    await other.load();
    const asked: { message: string; sourceDocIds: string[]; history: unknown[]; threadId: null; clientRequestId: string } = { message: "rated current?", sourceDocIds: [DOC_A], history: [], threadId: TH, clientRequestId: REQ };
    const prepared = logic.prepareChatSend({ gate: tab.gate, forThisGate: true, sel: SELA, scopes: tab.scopes, body: asked });
    if (!prepared.ok) throw new Error("precondition: the first send is scoped");
    // That send never reached the server; meanwhile the other screen switched to Q1.
    await change(other, K1, async (init) => commit(JSON.parse(String(init.body))));
    const retry = await tab.send("", prepared.body as Record<string, unknown>);
    expect(retry.status).toBe(409);
    expect(retry.providerCalled).toBe(false);
  });

  it("a change while an answer is streaming is refused without a request; a reload starts unread", async () => {
    saved = { componentId: VFD, version: 3 };
    const tab = screen();
    await tab.load();
    expect(tab.gate.tryBeginSend()).toBe(true); // an answer is streaming
    const put = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(change(tab, K1, put)).resolves.toEqual({ ok: false, message: logic.CHANGE_BLOCKED_MESSAGE });
    expect(put).not.toHaveBeenCalled();
    tab.gate.endSend();
    const reloaded = screen(); // a reload: new gate, nothing read yet
    expect((await reloaded.send("rated current?")).refused).toBe(logic.SEND_LOADING_MESSAGE);
    await reloaded.load();
    expect((await reloaded.send("rated current?")).catalog).toBe("GS11N-20P2");
  });
});
