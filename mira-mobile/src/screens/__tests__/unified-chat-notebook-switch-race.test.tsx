// @vitest-environment jsdom
// Codex round 5 F16 (#4195) — the mobile counterpart of the Hub's
// `hub-host.tsx` onConfirmIdentity race. `UnifiedChat` is normally remounted
// on a notebook switch (`UnifiedRoot.tsx` keys its `NotebookScreen` mount by
// `${notebookId}:${threadId}`), but `NotebooksTab.tsx` — the real Chat tab —
// has NO such key: its `onOpenNotebook` (a Sensor READ resolving a
// DIFFERENT machine) changes `NotebookScreen`'s `id` prop, and therefore
// `UnifiedChat`'s `meta.notebookId` prop, IN PLACE, on the SAME component
// instance. `UnifiedChat` renders under `NotebooksTab` whenever the
// technician's device-local "Chat style" preference is "unified"
// (`useChatUiChoice`) — a real, reachable configuration, not a hypothetical.
//
// A confirm started on notebook A, resolving AFTER the technician has
// switched to notebook B this way, must not refresh B's scope, or render
// A's "Confirmed." card on B's thread.
//
// Light-review remediation (#4195, notebook-switch class — PR comment
// https://github.com/Mikecranesync/MIRA/pull/4195#issuecomment-5968697358):
// every round found ANOTHER per-notebook field leaking the same way, so the
// fix moved from "patch the field" to "make carrying state across a switch
// structurally impossible" — `UnifiedChat` now remounts a fresh
// `UnifiedChatForNotebook` instance keyed on `notebookId` on every switch,
// plus an `aliveRef` guard for an old (now-unmounted) instance's own
// in-flight promises. The tests below cover what remounting alone does NOT
// already fix: `onSend`'s `confirmedScope` is captured BEFORE an
// `await attachments.compose(...)`, so a compose that resolves on the dead
// instance must be DROPPED, not delivered under anyone's handlers.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/unified-chat-notebook-switch-race
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
}

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));

const { confirmIdentityProposal, getNotebookDetail } = vi.hoisted(() => ({
  confirmIdentityProposal: vi.fn(),
  getNotebookDetail: vi.fn(async () => ({ notebook: {}, sources: [], turns: [], threads: [], photos: [] })),
}));
vi.mock("../../api/identity-confirm", () => ({ confirmIdentityProposal }));
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, getNotebookDetail };
});

// Controllable `useUnifiedAttachments` for the HIGH compose-race test below.
// Defaults mirror the real hook's "nothing held" state (`hasCarried`/
// `hasRetained` false, `compose` a pass-through) so the five existing tests
// above, which never attach anything, take the SAME synchronous fast path in
// `onSend` they always have and are unaffected by this mock.
const { composeMock, hasCarriedMock, hasRetainedMock, stashForHandoffMock } = vi.hoisted(() => ({
  composeMock: vi.fn(async (text: string) => ({ question: text }) as { question: string; rider?: unknown; scope?: readonly string[] }),
  hasCarriedMock: vi.fn(() => false),
  hasRetainedMock: vi.fn(() => false),
  stashForHandoffMock: vi.fn(),
}));
vi.mock("../../unified/attachments", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../unified/attachments")>();
  return {
    ...real,
    useUnifiedAttachments: () => ({
      attachPhoto: vi.fn(),
      attachCamera: vi.fn(),
      attachFile: vi.fn(),
      compose: composeMock,
      stashForHandoff: stashForHandoffMock,
      hasCarried: hasCarriedMock,
      hasRetained: hasRetainedMock,
    }),
  };
});

import { UnifiedChat, type UnifiedChatProps } from "../UnifiedChat";
import type { NotebookServerTurn } from "../../api/resources";

const NB_A = "nb-a";
const NB_B = "nb-b";

const PROPOSAL_TURN_A: NotebookServerTurn = {
  id: "t1",
  question: "is this an SMC SS5Y3-DUW01302?",
  answerStatus: "insufficient_evidence",
  answerText: null,
  evidence: [{ kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" }],
  basis: null,
};

/** B's own, unrelated turn — a plain answered question with NO identity
 *  proposal. Gives B a real assistant turn/answer to assert against, so a
 *  scope/send test can confirm B renders its own state and nothing bleeds
 *  over from A's (discarded) confirm. */
const PLAIN_TURN_B: NotebookServerTurn = {
  id: "b1",
  question: "what voltage does this run at?",
  answerStatus: "answered",
  answerText: "24VDC.",
  evidence: [],
  basis: "oem_documentation",
};

function props(notebookId: string, turns: NotebookServerTurn[]): UnifiedChatProps {
  return {
    turns,
    liveTurns: [],
    pending: null,
    busy: false,
    canStop: false,
    canRetry: false,
    chatError: null,
    handlers: { onSend: vi.fn(), onStop: () => {}, onCitation: () => {} },
    meta: { notebookId, threadId: `notebook-${notebookId}:thread-legacy`, title: notebookId, identityConfirmed: false },
  };
}

/** A controllable, externally-resolvable promise — for deferring the confirm
 *  POST past a notebook switch. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  confirmIdentityProposal.mockReset();
  getNotebookDetail.mockReset();
  getNotebookDetail.mockResolvedValue({ notebook: {}, sources: [], turns: [], threads: [], photos: [] });
  composeMock.mockReset();
  composeMock.mockImplementation(async (text: string) => ({ question: text }));
  hasCarriedMock.mockReset();
  hasCarriedMock.mockReturnValue(false);
  hasRetainedMock.mockReset();
  hasRetainedMock.mockReturnValue(false);
  stashForHandoffMock.mockReset();
});

describe("UnifiedChat — a notebook switch mid-confirm must not corrupt the NEW notebook (#4195 round 5 F16)", () => {
  it("A's confirm resolving after switching to B refreshes nothing for B, and B shows its own (empty) state", async () => {
    const pendingConfirm = deferred<{
      manualReady: boolean;
      searching: boolean;
      startedAt?: string;
      message: string;
    }>();
    confirmIdentityProposal.mockReturnValue(pendingConfirm.promise);

    const view = render(<UnifiedChat {...props(NB_A, [PROPOSAL_TURN_A])} />);
    const confirmButton = await screen.findByRole("button", { name: "Use its manuals" });

    // Start A's confirm — it will hang on `pendingConfirm.promise`.
    fireEvent.click(confirmButton);
    await act(async () => { await Promise.resolve(); });
    expect(confirmIdentityProposal).toHaveBeenCalledWith(NB_A, { manufacturer: "SMC", model: "SS5Y3-DUW01302" });

    const detailCallsBeforeSwitch = getNotebookDetail.mock.calls.length;

    // The technician switches to notebook B — in place, same component
    // instance (NotebooksTab's `onOpenNotebook`, no key-forced remount).
    view.rerender(<UnifiedChat {...props(NB_B, [])} />);
    await act(async () => { await Promise.resolve(); });

    // A's confirm NOW resolves: searching:true, its own generation.
    pendingConfirm.resolve({ manualReady: false, searching: true, startedAt: "gen-a", message: "Confirmed. I'll look for its manual." });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // B must show NOTHING from A: no "Confirmed." message, no leftover
    // identity-proposal confirm button either.
    expect(screen.queryByText(/Confirmed\. I'll look for its manual\./)).toBeNull();
    expect(screen.queryByRole("button", { name: "Use its manuals" })).toBeNull();

    // The discarded confirm must not have refreshed ANY scope (neither A's,
    // since it was abandoned, nor B's, since B never confirmed anything).
    expect(getNotebookDetail.mock.calls.length).toBe(detailCallsBeforeSwitch);
  });

  it("cheap-review r3 (#4195): A's scope refresh landing after the switch to B never rides B's next send", async () => {
    // A's confirm resolves while A is still showing, so it passes the
    // notebook check and starts its scope re-read. The technician switches
    // to B before that re-read returns. A's promoted doc must not become the
    // retrieval scope of B's next question.
    confirmIdentityProposal.mockResolvedValue({ manualReady: true, searching: false, message: "Confirmed." });
    const pendingDetail = deferred<unknown>();
    getNotebookDetail.mockImplementation(() => pendingDetail.promise as never);

    const view = render(<UnifiedChat {...props(NB_A, [PROPOSAL_TURN_A])} />);
    const confirmButton = await screen.findByRole("button", { name: "Use its manuals" });
    await act(async () => { fireEvent.click(confirmButton); });
    for (let i = 0; i < 10 && getNotebookDetail.mock.calls.length === 0; i++) {
      await act(async () => { await Promise.resolve(); });
    }
    expect(getNotebookDetail).toHaveBeenCalledWith(NB_A, expect.anything());

    const propsB = props(NB_B, [PLAIN_TURN_B]);
    view.rerender(<UnifiedChat {...propsB} />);
    await act(async () => {
      pendingDetail.resolve({
        notebook: { id: NB_A }, sources: [{ docId: "doc-a", enabledByDefault: true, matchState: "verified" }],
        turns: [], threads: [], photos: [],
      });
      await Promise.resolve();
    });

    const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what voltage?" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    const onSendB = propsB.handlers.onSend as ReturnType<typeof vi.fn>;
    expect(onSendB).toHaveBeenCalledTimes(1);
    expect(onSendB).toHaveBeenCalledWith("what voltage?");
  });

  it("cheap-review r3 (#4195): a scope stashed on A before the switch is dropped, not sent on B", async () => {
    confirmIdentityProposal.mockResolvedValue({ manualReady: true, searching: false, message: "Confirmed." });
    getNotebookDetail.mockResolvedValue({
      notebook: { id: NB_A }, sources: [{ docId: "doc-a", enabledByDefault: true, matchState: "verified" }],
      turns: [], threads: [], photos: [],
    } as never);
    const view = render(<UnifiedChat {...props(NB_A, [PROPOSAL_TURN_A])} />);
    const confirmButton = await screen.findByRole("button", { name: "Use its manuals" });
    await act(async () => { fireEvent.click(confirmButton); });
    await screen.findByText(/Confirmed\./);

    const propsB = props(NB_B, [PLAIN_TURN_B]);
    view.rerender(<UnifiedChat {...propsB} />);
    await act(async () => { await Promise.resolve(); });
    const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what voltage?" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    const onSendB = propsB.handlers.onSend as ReturnType<typeof vi.fn>;
    expect(onSendB).toHaveBeenCalledWith("what voltage?");
  });

  it("HIGH (light review #4195): a send's compose completing AFTER the switch to B is DROPPED — never reaches A's old handlers, B's new handlers, or A's stashed scope", async () => {
    // A confirms an identity, which stashes a scope A's NEXT send would ride
    // (the exact one-shot `confirmedScopeRef` `onSend` reads BEFORE the await
    // below — see the `onSend` comment in UnifiedChat.tsx).
    confirmIdentityProposal.mockResolvedValue({ manualReady: true, searching: false, message: "Confirmed." });
    getNotebookDetail.mockResolvedValue({
      notebook: { id: NB_A }, sources: [{ docId: "doc-a", enabledByDefault: true, matchState: "verified" }],
      turns: [], threads: [], photos: [],
    } as never);
    const propsA = props(NB_A, [PROPOSAL_TURN_A]);
    const view = render(<UnifiedChat {...propsA} />);
    const confirmButton = await screen.findByRole("button", { name: "Use its manuals" });
    await act(async () => { fireEvent.click(confirmButton); });
    await screen.findByText(/Confirmed\./);

    // Start a send on A whose attachment upload is DEFERRED. `hasCarried`
    // forces the async `attachments.compose(...)` path (the one `onSend`
    // takes for an upload or a HOME handoff) instead of the synchronous
    // text-only fast path, so there is a real `await` between capturing
    // `confirmedScopeRef.current` and calling `handlers.onSend`.
    const pendingCompose = deferred<{ question: string; rider?: unknown; scope?: readonly string[] }>();
    composeMock.mockReturnValue(pendingCompose.promise);
    hasCarriedMock.mockReturnValue(true);
    const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what fixed it?" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(composeMock).toHaveBeenCalled();

    // The technician switches to B before compose resolves — A's
    // `UnifiedChatForNotebook` instance (and its `handlers`, bound to A) is
    // unmounted; B gets a brand-new instance with B's own `handlers`.
    const propsB = props(NB_B, [PLAIN_TURN_B]);
    view.rerender(<UnifiedChat {...propsB} />);
    await act(async () => { await Promise.resolve(); });

    // A's compose NOW resolves with no scope of its own. Without the
    // aliveRef guard this would fall back to A's stashed scope
    // (`composed.scope ?? confirmedScope`) and fire `handlers.onSend` on
    // A's OWN stale closure (not B's — `handlers` is captured at A's LAST
    // render before it unmounted). The fix drops the send outright: NEITHER
    // A's old handlers NOR B's new ones ever see it.
    await act(async () => {
      pendingCompose.resolve({ question: "what fixed it?" });
      await Promise.resolve();
      await Promise.resolve();
    });

    const onSendA = propsA.handlers.onSend as ReturnType<typeof vi.fn>;
    const onSendB = propsB.handlers.onSend as ReturnType<typeof vi.fn>;
    expect(onSendA).not.toHaveBeenCalled();
    expect(onSendB).not.toHaveBeenCalled();
  });
});
