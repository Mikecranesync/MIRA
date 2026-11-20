/** Run the actual host callback, using the repository's existing TypeScript
 * callback harness. This covers the pre-HTTP refusal that a server-only test
 * cannot reach. Browser tests cover the real non-2xx path separately. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { prepareChatSend, createBenchSendGate, SEND_BLOCKED_MESSAGE, isScopeRefusalCode, withoutScope } from "./bench-components-logic";
import { withLivingSheetRider, chatBodyFor, errorMessageFor, sendFailureMessage, retainedStreamInterruption } from "./hub-host-logic";
import { draftAfterSendFailed, readRecoveryPointer } from "./turn-recovery-client";
import { NotebookHttpError } from "@/components/equipment/notebook-chat-utils";

function realSend(draft: string, scopeRefusal = false) {
  const source = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("host.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "send") initializer = node.initializer!.getText(parsed);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const sel = { notebookId: "notebook", threadId: "thread" };
  const dispatch = vi.fn(), fetch = vi.fn(async () => ({ ok: false, status: 409, body: null, json: async () => ({ error: "selection_changed" }) }));
  const setFailedBody = vi.fn();
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const deps = {
    selection: sel, gateConversation: "notebook|thread", benchGate: scopeRefusal ? { known: true, changing: false, tryBeginSend: () => true, endSend: vi.fn() } : createBenchSendGate(), benchScopesRef: { current: new Map() },
    detailRef: { current: { notebook: { id: "notebook", asset: { entityId: "A" } } } },
    draftRef: { current: draft }, livingSheetJob: null, recoveryActor: "owner",
    prepareChatSend: scopeRefusal ? ({ body }: { body: object }) => ({ ok: true, body: { ...body, componentSelection: { threadId: "thread", componentId: null, selectionVersion: null } } }) : prepareChatSend,
    withLivingSheetRider, draftAfterSendFailed, SEND_BLOCKED_MESSAGE, readRecoveryPointer, isScopeRefusalCode, withoutScope,
    errorMessageFor, sendFailureMessage, retainedStreamInterruption, NotebookHttpError,
    recoveryPointerKey: () => "pointer", window: { localStorage: storage }, API_BASE: "", abortRef: { current: null },
    selectionRef: { current: sel }, setFailedBody, setSettledFollowups: vi.fn(), setLive: vi.fn(), setBusy: vi.fn(),
    setComponentFrame: vi.fn(), setRecovery: vi.fn(), setRecoveryEpoch: vi.fn(), setSignedOut: vi.fn(), setBenchView: vi.fn(),
    dropOutgoing: vi.fn(), outgoingOwner: { current: null }, dispatch, fetch,
    setBenchRefresh: vi.fn(), loadDetail: vi.fn(), loadNotebooks: vi.fn(),
  };
  const compiled = ts.transpileModule(`const send = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const send = new Function(...Object.keys(deps), "useCallback", `${compiled}\nreturn send;`)(...Object.values(deps), (fn: unknown) => fn);
  return { send, dispatch, fetch, sel, setFailedBody };
}

describe("F4 actual host send-gate refusal", () => {
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
