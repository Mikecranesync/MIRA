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
const under = (componentId: string, selectionVersion: number) => ({ componentSelection: { componentId, selectionVersion } });

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
  it("control: the notebook's identity scopes retrieval and the component store is never read", async () => {
    await frames(await ask("what does fault oC mean"));
    expect(storeMock.getSelection).not.toHaveBeenCalled();
    expect(storeMock.listComponents).not.toHaveBeenCalled();
    expect(storeMock.stampTurnComponent).not.toHaveBeenCalled();
    expect(retrievalOpts()?.catalogNumber).toBe("2080-LC20-20QWB");
    expect(storeMock.listSelectionTurns).not.toHaveBeenCalled();
  });
});

describe("a confirmed component is the record for the turn", () => {
  it("retrieval is scoped by the component's catalog number, not the notebook's, and the turn is stamped", async () => {
    await frames(await ask("what does fault oC mean", under(VFD, 3)));
    expect(retrievalOpts()).toMatchObject({
      catalogNumber: "GS11N-20P2",
      identityStatus: "user_confirmed",
      identity: { manufacturer: "AutomationDirect", model: "GS10" },
    });
    expect(storeMock.stampTurnComponent).toHaveBeenCalledWith(TENANT, NB, "u1", REQ, VFD, 2);
  });

  it("only questions asked under this selection carry; an earlier question in the same chat does not", async () => {
    storeMock.listSelectionTurns.mockResolvedValue([
      // Before this pick (selected 04:00): asked about the PLC.
      { id: "t1", question: "what is the 2080-LC50-48QWB input rating", answerStatus: "insufficient_evidence", basis: null, createdAt: "2026-11-14T03:50:00.000Z", componentId: null, componentRevision: null, clientRequestId: null },
      // Under it: a sibling ask, unanswered.
      { id: "t2", question: "what is the GS13N-20P2 input current", answerStatus: "insufficient_evidence", basis: null, createdAt: "2026-11-14T04:05:00.000Z", componentId: VFD, componentRevision: 2, clientRequestId: null },
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

  it("an identity corrected on another screen is re-checked: the selection advances and the frame carries the new version", async () => {
    storeMock.getSelection.mockResolvedValue(selection(VFD, 1, 3));
    storeMock.advanceSelectionRevision.mockResolvedValue({ ...selection(VFD, 2, 4), selectedVia: "correction", selectedAt: "2026-11-14T04:30:00.000Z" });
    ragMock.retrieveNodeChunks.mockImplementation(async () => []);
    const out = await frames(await ask("what does fault oC mean", under(VFD, 3)));
    expect(storeMock.advanceSelectionRevision).toHaveBeenCalledWith(TENANT, NB, "u1", "legacy", 3, 2);
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
    ["malformed selection", { componentSelection: { componentId: "VFD1", selectionVersion: 3 } }, "invalid_component_selection"],
    ["general mode", { ...under(VFD, 3), mode: "general" }, "component_selection_not_general"],
    ["no request id", { ...under(VFD, 3), clientRequestId: undefined }, "client_request_id_required"],
  ])("%s is a 400 before anything is claimed", async (_name, extra, error) => {
    const res = await ask("what does fault oC mean", extra);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(error);
    expect(nbMock.claimNotebookTurnRequest).not.toHaveBeenCalled();
  });
});
