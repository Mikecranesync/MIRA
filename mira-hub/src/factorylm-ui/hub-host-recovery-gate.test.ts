/** Run the actual host callback, using the repository's existing TypeScript
 * callback harness. This covers the pre-HTTP refusal that a server-only test
 * cannot reach. Browser tests cover the real non-2xx path separately. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { prepareChatSend, createBenchSendGate, SEND_BLOCKED_MESSAGE, isScopeRefusalCode, withoutScope, parseComponentFrames } from "./bench-components-logic";
import { withLivingSheetRider, chatBodyFor, errorMessageFor, sendFailureMessage, retainedStreamInterruption } from "./hub-host-logic";
import { draftAfterSendFailed, readRecoveryPointer, recoveryPointerKey } from "./turn-recovery-client";
import { notebookIdentitySnapshot } from "@/capabilities/turn-recovery/accepted-context";
import { draftAfterSendSucceeded } from "./hub-host-logic";
import { NotebookHttpError, readNotebookStream } from "@/components/equipment/notebook-chat-utils";
import { partsFromStream } from "./to-interaction";

function realSend(draft: string, scopeRefusal = false, succeed = false) {
  const source = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("host.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "send") initializer = node.initializer!.getText(parsed);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const sel = { notebookId: "notebook", threadId: "thread" };
  const dispatch = vi.fn(), fetch = vi.fn(async () => succeed
    ? new Response('data: {"kind":"content","content":"Question B answer"}\n\ndata: {"kind":"status","status":"answered"}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })
    : ({ ok: false, status: 409, body: null, json: async () => ({ error: "selection_changed" }) }));
  const setFailedBody = vi.fn();
  const data = new Map<string, string>();
  const storage = { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const deps = {
    selection: sel, gateConversation: "notebook|thread", benchGate: scopeRefusal ? { known: true, changing: false, tryBeginSend: () => true, endSend: vi.fn() } : createBenchSendGate(), benchScopesRef: { current: new Map() },
    detailRef: { current: { notebook: { id: "notebook", asset: { entityId: "A" } }, turns: [] } },
    draftRef: { current: draft }, livingSheetJob: null, recoveryActor: "owner",
    prepareChatSend: scopeRefusal ? ({ body }: { body: object }) => ({ ok: true, body: { ...body, componentSelection: { threadId: "thread", componentId: null, selectionVersion: null } } }) : prepareChatSend,
    withLivingSheetRider, draftAfterSendFailed, draftAfterSendSucceeded, notebookIdentitySnapshot, SEND_BLOCKED_MESSAGE, readRecoveryPointer, isScopeRefusalCode, withoutScope,
    errorMessageFor, sendFailureMessage, retainedStreamInterruption, NotebookHttpError, readNotebookStream, partsFromStream, parseComponentFrames,
    recoveryPointerKey, window: { localStorage: storage }, API_BASE: "", abortRef: { current: null },
    selectionRef: { current: sel }, setFailedBody, setSettledFollowups: vi.fn(), setLive: vi.fn(), setBusy: vi.fn(),
    setComponentFrame: vi.fn(), setRecoveries: vi.fn(), setRecoveryEpoch: vi.fn(), setSignedOut: vi.fn(), setBenchView: vi.fn(),
    dropOutgoing: vi.fn(), outgoingOwner: { current: null }, dispatch, fetch,
    setBenchRefresh: vi.fn(), loadDetail: vi.fn(), loadNotebooks: vi.fn(),
  };
  const compiled = ts.transpileModule(`const send = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const send = new Function(...Object.keys(deps), "useCallback", `${compiled}\nreturn send;`)(...Object.values(deps), (fn: unknown) => fn);
  return { send, dispatch, fetch, sel, setFailedBody, data };
}

describe("F4 actual host send-gate refusal", () => {
  it("native round2 F4 keeps question A's unresolved pointer after a newer question B succeeds", async () => {
    const h = realSend("Question B", true, true);
    const a = { notebookId: "notebook", threadId: "thread", requestId: "pending-A", question: "Question A" };
    h.data.set(recoveryPointerKey("owner", a.notebookId, a.threadId), JSON.stringify(a));
    await h.send(chatBodyFor("Question B", [], [], h.sel), "Question B");
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect([...h.data.values()].some(value => JSON.parse(value).requestId === a.requestId)).toBe(true);
  });
  it("leaves an unrelated draft intact when transcript Retry is refused before HTTP", async () => {
    const h = realSend("Unrelated draft");
    await h.send(chatBodyFor("Old question", [], [], h.sel), "Old question", h.sel, "retry");
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "set-send-error" }));
    expect(h.dispatch.mock.calls.some(([action]) => action.type === "set-draft")).toBe(false);
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("keeps the original machine expectation after a component-selection HTTP refusal", async () => {
    const h = realSend("Unrelated draft", true);
    await h.send(chatBodyFor("Old question", [], [], h.sel), "Old question", h.sel, "retry");
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.setFailedBody).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ expectedEquipmentEntityId: "A" }) }));
    expect(h.dispatch.mock.calls.some(([action]) => action.type === "set-draft")).toBe(false);
  });
  it("restores a consumed composer question but preserves newer typing", async () => {
    const empty = realSend("");
    await empty.send(chatBodyFor("Old question", [], [], empty.sel), "Old question");
    expect(empty.dispatch).toHaveBeenCalledWith({ type: "set-draft", draft: "Old question" });
    const newer = realSend("Newer typing");
    await newer.send(chatBodyFor("Old question", [], [], newer.sel), "Old question");
    expect(newer.dispatch.mock.calls.some(([action]) => action.type === "set-draft")).toBe(false);
  });
});

function retryCallback(recoveries: unknown[], recoveryRetries: unknown[]) {
  const source = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("host.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer = "";
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "onRetry") initializer = node.initializer!.getText(parsed); ts.forEachChild(node, visit); };
  visit(parsed);
  const send = vi.fn();
  const deps = { recoveries, recoveryRetries, send, selection: { notebookId: "notebook", threadId: "thread" },
    failedBody: { body: { message: "Question B" }, question: "Question B" }, machineRetryMatches: true,
    retryCheck: { kind: "retry" }, persistedRetry: null, detail: null, dispatch: vi.fn(), chatBodyFor,
    answerTurnId: (id: string) => `${id}-a` };
  const compiled = ts.transpileModule(`const onRetry = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const retry = new Function(...Object.keys(deps), "useCallback", `${compiled}\nreturn onRetry;`)(...Object.values(deps), (fn: unknown) => fn);
  return { retry, send };
}

describe("actual host Retry chooses its own request", () => {
  it("retries recovered A rather than a newer live failure B", () => {
    const h = retryCallback([], [{ answerId: "A-a", question: "Question A", requestId: "A" }]);
    h.retry("A-a");
    expect(h.send).toHaveBeenCalledWith(expect.anything(), "Question A", expect.anything(), "retry", "A");
  });
  it("does not turn a held/pending A action into Retry of B", () => {
    const h = retryCallback([{ pointer: { requestId: "A" }, value: { turnId: "A", state: "pending" } }], []);
    h.retry("A-a");
    expect(h.send).not.toHaveBeenCalled();
  });
  it("preserves the current live failure Retry with its turn ID", () => {
    const h = retryCallback([], []);
    h.retry("live-B-a");
    expect(h.send).toHaveBeenCalledWith({ message: "Question B" }, "Question B", expect.anything(), "retry", undefined);
  });
});
