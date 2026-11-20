/** Run the actual host callback, using the repository's existing TypeScript
 * callback harness. This covers the pre-HTTP refusal that a server-only test
 * cannot reach. Browser tests cover the real non-2xx path separately. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { prepareChatSend, createBenchSendGate, SEND_BLOCKED_MESSAGE } from "./bench-components-logic";
import { withLivingSheetRider, chatBodyFor } from "./hub-host-logic";
import { draftAfterSendFailed } from "./turn-recovery-client";

function realSend(draft: string) {
  const source = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("host.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "send") initializer = node.initializer!.getText(parsed);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const sel = { notebookId: "notebook", threadId: "thread" };
  const dispatch = vi.fn(), fetch = vi.fn();
  const deps = {
    selection: sel, gateConversation: "notebook|thread", benchGate: createBenchSendGate(), benchScopesRef: { current: new Map() },
    detailRef: { current: { notebook: { id: "notebook", asset: { entityId: "A" } } } },
    draftRef: { current: draft }, livingSheetJob: null, recoveryActor: "owner",
    prepareChatSend, withLivingSheetRider, draftAfterSendFailed, SEND_BLOCKED_MESSAGE,
    dropOutgoing: vi.fn(), outgoingOwner: { current: null }, dispatch, fetch,
    setBenchRefresh: vi.fn(), loadDetail: vi.fn(), loadNotebooks: vi.fn(),
  };
  const compiled = ts.transpileModule(`const send = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const send = new Function(...Object.keys(deps), "useCallback", `${compiled}\nreturn send;`)(...Object.values(deps), (fn: unknown) => fn);
  return { send, dispatch, fetch, sel };
}

describe("F4 actual host send-gate refusal", () => {
  it("leaves an unrelated draft intact when transcript Retry is refused before HTTP", async () => {
    const h = realSend("Unrelated draft");
    await h.send(chatBodyFor("Old question", [], [], h.sel), "Old question", h.sel, "retry");
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "set-send-error" }));
    expect(h.dispatch.mock.calls.some(([action]) => action.type === "set-draft")).toBe(false);
    expect(h.fetch).not.toHaveBeenCalled();
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
