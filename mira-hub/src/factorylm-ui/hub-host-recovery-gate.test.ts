/** Run the actual host callback, using the repository's existing TypeScript
 * callback harness. This covers the pre-HTTP refusal that a server-only test
 * cannot reach. Browser tests cover the real non-2xx path separately. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { prepareChatSend, createBenchSendGate, SEND_BLOCKED_MESSAGE, isScopeRefusalCode, withoutScope, parseComponentFrames, expectsComponentFrame } from "./bench-components-logic";
import { LEGACY_THREAD_ID } from "./notebook-tree";
import { withLivingSheetRider, chatBodyFor, errorMessageFor, sendFailureMessage, retainedStreamInterruption, stoppedStreamResult, shellThreadId, metaFor, sendRecoveryId, EMPTY_FIXTURE } from "./hub-host-logic";
import { readRecoveryPointer, recoveryPointerKey } from "./turn-recovery-client";
import { notebookIdentitySnapshot } from "@/capabilities/turn-recovery/accepted-context";
import { NotebookHttpError, readNotebookStream } from "@/components/equipment/notebook-chat-utils";
import { NOTEBOOK_ATTEMPT_HEADER } from "@/lib/notebook-chat-types";
import { trackSafetyStop } from "./safety-stop-marker";
import { answerTurnId, contextFor, partsFromStream } from "./to-interaction";
import { projectIdForNotebook } from "./notebook-tree";
import { PHOTO_CHANGED_RETRY_NOTE } from "@/capabilities/turn-recovery/contract";

/** Compile one host callback from the REAL source and run it with only the dependencies named here.
 *  A name the host reads that is not supplied is a ReferenceError, never a silent undefined. */
function hostCallback(name: string, deps: Record<string, unknown>) {
  const source = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("host.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) initializer = node.initializer!.getText(parsed);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  expect(initializer, `host declares ${name}`).not.toBe("");
  const compiled = ts.transpileModule(`const ${name} = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const scope = new Proxy(deps, { has: (target, key) => typeof key === "string" && key in target, get: (target, key) => (target as Record<string | symbol, unknown>)[key] });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- test-only harness over the real host source
  return new Function("scope", "useCallback", `with (scope) { ${compiled}\nreturn ${name}; }`)(scope, (fn: unknown) => fn);
}

function realSend(draft: string, scopeRefusal = false, succeed = false, refusalCode = "selection_changed") {
  const sel = { notebookId: "notebook", threadId: "thread" };
  const dispatch = vi.fn(), fetch = vi.fn(async () => succeed
    ? new Response('data: {"kind":"content","content":"Question B answer"}\n\ndata: {"kind":"status","status":"answered"}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })
    : ({ ok: false, status: 409, headers: new Headers(), body: null, json: async () => ({ error: refusalCode }) }));
  let liveState: Record<string, unknown> | null = null;
  const setLive = vi.fn((next: Record<string, unknown> | null | ((previous: Record<string, unknown> | null) => Record<string, unknown> | null)) => { liveState = typeof next === "function" ? next(liveState) : next; });
  const data = new Map<string, string>();
  const storage = { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const retainedByThreadRef = { current: new Map<string, unknown[]>() };
  const detail = { notebook: { id: "notebook", displayName: "Line 1 pump", asset: { entityId: "A", displayName: "Pump A" } }, sources: [], turns: [] };
  const deps = {
    selection: sel, gateConversation: "notebook|thread", benchGate: scopeRefusal ? { known: true, changing: false, tryBeginSend: () => true, endSend: vi.fn() } : createBenchSendGate(), benchScopesRef: { current: new Map() },
    detailRef: { current: detail }, livingSheetJob: null, recoveryActor: "owner",
    prepareChatSend: scopeRefusal ? ({ body }: { body: object }) => ({ ok: true, body: { ...body, componentSelection: { threadId: "thread", componentId: null, selectionVersion: null } } }) : prepareChatSend,
    withLivingSheetRider, notebookIdentitySnapshot, readRecoveryPointer, isScopeRefusalCode, errorMessageFor, sendFailureMessage, retainedStreamInterruption, stoppedStreamResult,
    NotebookHttpError, readNotebookStream, partsFromStream, parseComponentFrames, LEGACY_THREAD_ID, expectsComponentFrame, shellThreadId, metaFor, contextFor, sendRecoveryId,
    EMPTY_FIXTURE, projectIdForNotebook, answerTurnId, NOTEBOOK_ATTEMPT_HEADER, trackSafetyStop, recoveryPointerKey, window: { localStorage: storage }, API_BASE: "",
    abortRef: { current: null as AbortController | null }, sendAttempts: { current: new Map() }, explicitStops: { current: new WeakSet() },
    retainedByThreadRef, setRetainedByThread: vi.fn(), hostMountedRef: { current: true }, manualSearchDriverRef: { current: null },
    selectionRef: { current: sel }, setSettledFollowups: vi.fn(), setLive, setBusy: vi.fn(), setSheetReceipt: vi.fn(), parseSheetReceipts: vi.fn(),
    setComponentFrame: vi.fn(), setRecoveries: vi.fn(), setRecoveryEpoch: vi.fn(), setSignedOut: vi.fn(), setBenchView: vi.fn(),
    dropOutgoing: vi.fn(), outgoingOwner: { current: null }, dispatch, fetch, setPinnedTurns: vi.fn(),
    setBenchRefresh: vi.fn(), loadDetail: vi.fn(async () => true), loadNotebooks: vi.fn(async () => undefined),
  };
  const send = hostCallback("send", deps);
  return { send, dispatch, fetch, sel, data, retained: retainedByThreadRef, liveState: () => liveState, draft };
}

type Dispatched = { type: string; restoreDraft?: boolean; recovery?: { body?: Record<string, unknown>; question?: string } };
const dispatched = (h: { dispatch: ReturnType<typeof vi.fn> }) => h.dispatch.mock.calls.map(([action]) => action as Dispatched);

describe("F4 actual host send-gate refusal", () => {
  it("native round2 F4 keeps question A's unresolved pointer after a newer question B succeeds", async () => {
    const h = realSend("Question B", true, true);
    const a = { notebookId: "notebook", threadId: "thread", requestId: "pending-A", question: "Question A" };
    h.data.set(recoveryPointerKey("owner", a.notebookId, a.threadId, a.requestId), JSON.stringify(a));
    await h.send(chatBodyFor("Question B", [], [], h.sel), "Question B");
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect([...h.data.values()].some(value => JSON.parse(value).requestId === a.requestId)).toBe(true);
  });
  it("leaves an unrelated draft intact when a transcript Retry is refused before HTTP", async () => {
    const h = realSend("Unrelated draft");
    const retry = { body: chatBodyFor("Old question", [], [], h.sel), question: "Old question", recoveryId: "old", error: "x" };
    await h.send(chatBodyFor("Old question", [], [], h.sel), "Old question", h.sel, retry);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(dispatched(h).some(action => action.type === "set-draft" || action.type === "recover-send")).toBe(false);
  });
  it("keeps the original machine expectation after a component-selection HTTP refusal", async () => {
    const h = realSend("Unrelated draft", true);
    await h.send(chatBodyFor("Old question", [], [], h.sel), "Old question");
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const recovered = dispatched(h).find(action => action.type === "recover-send");
    expect(recovered?.recovery?.body).toEqual(expect.objectContaining({ expectedEquipmentEntityId: "A" }));
    expect(dispatched(h).some(action => action.type === "set-draft")).toBe(false);
  });
  it("hands a consumed composer question back to the draft owner (the reducer keeps newer typing)", async () => {
    const h = realSend("");
    await h.send(chatBodyFor("Old question", [], [], h.sel), "Old question");
    const recovered = dispatched(h).find(action => action.type === "recover-send");
    expect(recovered).toEqual(expect.objectContaining({ restoreDraft: true, recovery: expect.objectContaining({ question: "Old question" }) }));
    expect(dispatched(h).some(action => action.type === "set-draft")).toBe(false);
  });
});

function retryCallback(recoveries: unknown[], recoveryRetries: unknown[], inline: Map<string, unknown> = new Map()) {
  const send = vi.fn(), retryRecovery = vi.fn();
  const deps = { recoveries, recoveryRetries, send, retryRecovery, inlineRecoveries: inline, selection: { notebookId: "notebook", threadId: "thread" },
    selectionRef: { current: null as unknown }, uploadAbortRef: { current: null }, abortRef: { current: null }, benchSendRefusal: () => null, benchGate: {},
    persistedRetry: null, detail: null, visibleTurns: [], dispatch: vi.fn(), chatBodyFor, answerTurnId: (id: string) => `${id}-a` };
  deps.selectionRef.current = deps.selection;
  const retry = hostCallback("onRetry", deps);
  return { retry, send, retryRecovery };
}

describe("actual host Retry chooses its own request", () => {
  it("retries recovered A rather than a newer live failure B", () => {
    const h = retryCallback([], [{ answerId: "A-a", question: "Question A", requestId: "A" }]);
    h.retry("A-a");
    expect(h.send).toHaveBeenCalledWith(expect.anything(), "Question A", expect.anything(), undefined, undefined, "A");
  });
  it("does not turn a held/pending A action into Retry of B", () => {
    const h = retryCallback([{ pointer: { requestId: "A" }, value: { turnId: "A", state: "pending" } }], []);
    h.retry("A-a");
    expect(h.send).not.toHaveBeenCalled();
    expect(h.retryRecovery).not.toHaveBeenCalled();
  });
  it("preserves the current live failure Retry with its turn ID", () => {
    const recovery = { body: { message: "Question B" }, question: "Question B" };
    const h = retryCallback([], [], new Map([["live-B-a", recovery]]));
    h.retry("live-B-a");
    expect(h.retryRecovery).toHaveBeenCalledWith(recovery);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("native round3 live recovery regressions", () => {
  it("F6 retains an existing recovered photo/target pointer after a direct409", async () => {
    const h = realSend("Unrelated draft", true, false, "equipment_binding_changed");
    const a = { notebookId: "notebook", threadId: "thread", requestId: "original-A", question: "Question A" };
    const key = recoveryPointerKey("owner", a.notebookId, a.threadId, a.requestId);
    h.data.set(key, JSON.stringify(a));
    await h.send(chatBodyFor(a.question, [], [], h.sel), a.question, h.sel, undefined, undefined, a.requestId);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.data.has(key)).toBe(true);
    // The refusal of a RECOVERED request keeps no second copy of the question to resend.
    expect(dispatched(h).some(action => action.type === "recover-send" || action.type === "set-draft")).toBe(false);
    expect(dispatched(h).some(action => action.type === "set-send-error")).toBe(true);
    // And the POST names the original request id, never a new one.
    const [, init] = h.fetch.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(JSON.parse(init.body)).toEqual({ retryRequestId: "original-A", threadId: "thread" });
    expect(init.headers["x-client-request-id"]).toBe("original-A");
  });
  it("changed photo: Retry says so in plain words, keeps the pointer and the stored row, sends exactly one POST and never retries by itself", async () => {
    const h = realSend("", true, false, "retry_photo_changed");
    const a = { notebookId: "notebook", threadId: "thread", requestId: "original-A", question: "Question A" };
    const key = recoveryPointerKey("owner", a.notebookId, a.threadId, a.requestId);
    h.data.set(key, JSON.stringify(a));
    await h.send(chatBodyFor(a.question, [], [], h.sel), a.question, h.sel, undefined, undefined, a.requestId);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(dispatched(h).filter(action => action.type === "set-send-error").at(-1)).toEqual(expect.objectContaining({ error: PHOTO_CHANGED_RETRY_NOTE }));
    expect(dispatched(h).some(action => action.type === "recover-send" || action.type === "set-draft")).toBe(false);
    expect(h.data.has(key)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it("F5 keeps a successfully streamed answer until its exact persisted row can take over", async () => {
    const h = realSend("", true, true);
    await h.send(chatBodyFor("Question outside recent history", [], [], h.sel), "Question outside recent history", h.sel, undefined, undefined, "old-request");
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const kept = [...h.retained.current.values()][0] as { clientRequestId: string; content: string }[] | undefined;
    expect(kept?.[0]).toEqual(expect.objectContaining({ clientRequestId: "old-request", content: "Question B answer" }));
  });
});

function terminalCallback(liveRequestId: string, liveResult: { status: string } | null = null, hydrate?: (...a: unknown[]) => Promise<unknown>, retained: Map<string, unknown[]> = new Map()) {
  const source = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("host.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer = "";
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "followTurnRecoveries") {
      const options = node.arguments[1] as ts.ObjectLiteralExpression;
      initializer = (options.properties.find(p => p.name?.getText(parsed) === "terminal") as ts.PropertyAssignment).initializer.getText(parsed);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  let live: { clientRequestId: string } | null = { clientRequestId: liveRequestId };
  const selection = { notebookId: "notebook", threadId: "thread" }, requestId = "original-A";
  const pointer = { ...selection, requestId, question: "Question A" };
  const drop = vi.fn();
  const deps = { isCurrent: () => true, selection, shellThreadId, retainedByThreadRef: { current: retained }, loadDetail: async () => true,
    detailRef: { current: { turns: [{ id: "saved-A", clientRequestId: requestId }] } }, liveRef: { current: { clientRequestId: liveRequestId, result: liveResult } },
    hydrateRecovery: hydrate ?? (async () => ({ id: "saved-A", clientRequestId: requestId })),
    removeRecoveryPointer: vi.fn(), window: { localStorage: {} }, recoveryActor: "owner", setRecoveries: vi.fn(),
    setLive: (fn: (previous: typeof live) => typeof live) => { live = fn(live); },
    outgoingOwner: { current: { id: "outgoing-A", requestId }, drop }, dropOutgoing: drop };
  const compiled = ts.transpileModule(`const terminal = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const terminal = new Function(...Object.keys(deps), `${compiled}\nreturn terminal;`)(...Object.values(deps));
  return { terminal, pointer, live: () => live, drop };
}

describe("native round3 late persistence", () => {
  it("F4 retires the matching stopped live exchange after its authoritative row arrives", async () => {
    const h = terminalCallback("original-A");
    await h.terminal(h.pointer, { state: "complete", answerStatus: "error" });
    expect(h.live()).toBeNull();
    expect(h.drop).toHaveBeenCalledWith("outgoing-A");
  });
  it("round4 F9: the follower tells hydration how the live stream ended, and an old row of the other outcome cannot retire it", async () => {
    const seen: unknown[][] = [];
    const h = terminalCallback("original-A", { status: "answered" }, async (...a) => { seen.push(a); return null; }); // read returned the OLD failure -> not confirmed
    expect(await h.terminal(h.pointer, { state: "complete", answerStatus: "error" })).toBe(false);
    expect(seen[0]![2]).toEqual({ error: false });
    expect(h.live()).toEqual({ clientRequestId: "original-A" }); // live success kept
    const failed = terminalCallback("original-A", { status: "error" }, async (...a) => { seen.push(a); return { id: "saved-A", clientRequestId: "original-A" }; });
    await failed.terminal(failed.pointer, { state: "complete", answerStatus: "error" });
    expect(seen[1]![2]).toEqual({ error: true });
    expect(failed.live()).toBeNull();
  });
  it("a RETAINED (already-confirmed) success also tells hydration the outcome, so the old failed row cannot retire it", async () => {
    const seen: unknown[][] = [];
    const retained = new Map<string, unknown[]>([[shellThreadId({ notebookId: "notebook", threadId: "thread" } as never), [{ clientRequestId: "original-A", result: { status: "answered" } }]]]);
    const h = terminalCallback("another-live", null, async (...a) => { seen.push(a); return null; }, retained);
    expect(await h.terminal(h.pointer, { state: "complete", answerStatus: "error" })).toBe(false);
    expect(seen[0]![2]).toEqual({ error: false });
  });
  it("does not retire another request's live exchange", async () => {
    const h = terminalCallback("newer-B");
    await h.terminal(h.pointer, { state: "complete", answerStatus: "answered" });
    expect(h.live()).toEqual({ clientRequestId: "newer-B" });
  });
});
