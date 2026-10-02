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
// switched to notebook B this way, must not seed B's follower, refresh B's
// scope, or render A's "Searching…"/"Confirmed." card on B's thread.
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

const { confirmIdentityProposal, getNotebookDetail, fetchManualSearchStatus } = vi.hoisted(() => ({
  confirmIdentityProposal: vi.fn(),
  getNotebookDetail: vi.fn(async () => ({ notebook: {}, sources: [], turns: [], threads: [], photos: [] })),
  fetchManualSearchStatus: vi.fn(async (_notebookId: string, _opts?: { threadId?: string }) => null as unknown),
}));
vi.mock("../../api/identity-confirm", () => ({ confirmIdentityProposal }));
vi.mock("../../api/manual-search-status", () => ({ fetchManualSearchStatus }));
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, getNotebookDetail };
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
 *  proposal. Exists so `withManualSearchOverride` has an assistant turn to
 *  (wrongly) append a leaked A status to, if the follow-reset were missing;
 *  an empty turn list gives a leak nowhere to render and the test would
 *  pass regardless of the fix. */
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
  fetchManualSearchStatus.mockReset();
  fetchManualSearchStatus.mockResolvedValue(null);
});

describe("UnifiedChat — a notebook switch mid-confirm must not corrupt the NEW notebook (#4195 round 5 F16)", () => {
  it("A's confirm resolving after switching to B seeds nothing on B, refreshes nothing for B, and B shows its own (empty) state", async () => {
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
    const aStatusCallsBeforeSwitch = fetchManualSearchStatus.mock.calls.filter((c) => c[0] === NB_A).length;

    // The technician switches to notebook B — in place, same component
    // instance (NotebooksTab's `onOpenNotebook`, no key-forced remount).
    view.rerender(<UnifiedChat {...props(NB_B, [])} />);
    await act(async () => { await Promise.resolve(); });

    // A's confirm NOW resolves: searching:true, its own generation.
    pendingConfirm.resolve({ manualReady: false, searching: true, startedAt: "gen-a", message: "Confirmed. I'll look for its manual." });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // B must show NOTHING from A: no "Searching…" card, no "Confirmed."
    // message, no leftover identity-proposal confirm button either.
    expect(screen.queryByText(/Searching SMC's documentation/)).toBeNull();
    expect(screen.queryByText(/Confirmed\. I'll look for its manual\./)).toBeNull();
    expect(screen.queryByRole("button", { name: "Use its manuals" })).toBeNull();

    // The discarded confirm must not have refreshed ANY scope (neither A's,
    // since it was abandoned, nor B's, since B never confirmed anything).
    expect(getNotebookDetail.mock.calls.length).toBe(detailCallsBeforeSwitch);
    // Nor made a SECOND (authoritative-re-check) call for A beyond the one
    // ordinary mount-time hydration check already made before the switch —
    // that would be the discarded confirm's own re-check firing anyway.
    expect(fetchManualSearchStatus.mock.calls.filter((c) => c[0] === NB_A).length).toBe(aStatusCallsBeforeSwitch);
  });

  it("returning to A afterward hydrates normally from A's own authoritative status — not the abandoned confirm", async () => {
    const pendingConfirm = deferred<{
      manualReady: boolean;
      searching: boolean;
      startedAt?: string;
      message: string;
    }>();
    confirmIdentityProposal.mockReturnValue(pendingConfirm.promise);

    const view = render(<UnifiedChat {...props(NB_A, [PROPOSAL_TURN_A])} />);
    const confirmButton = await screen.findByRole("button", { name: "Use its manuals" });
    fireEvent.click(confirmButton);
    await act(async () => { await Promise.resolve(); });

    view.rerender(<UnifiedChat {...props(NB_B, [])} />);
    await act(async () => { await Promise.resolve(); });
    pendingConfirm.resolve({ manualReady: false, searching: true, startedAt: "gen-a", message: "Confirmed. I'll look for its manual." });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Back to A — a fresh hydration check (NOT a leftover from the abandoned
    // confirm), reporting A's OWN authoritative, already-settled status.
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-a" });
    view.rerender(<UnifiedChat {...props(NB_A, [PROPOSAL_TURN_A])} />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Found it.")).toBeTruthy();
  });

  it("a search already FOLLOWING for A (no confirm in flight) does not survive a switch to B — B's hydration reports nothing and B shows nothing", async () => {
    // A hydrates with a search already running (e.g. a candidate search
    // started by an earlier turn, unrelated to any confirm click).
    fetchManualSearchStatus.mockResolvedValueOnce({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-a" });
    const view = render(<UnifiedChat {...props(NB_A, [PROPOSAL_TURN_A])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();

    // Switch to B — same instance, in place. B reports nothing running. B
    // has its OWN unrelated turn (so a leaked card would have somewhere to
    // render if the reset were missing — see PLAIN_TURN_B's own comment).
    fetchManualSearchStatus.mockResolvedValueOnce(null);
    view.rerender(<UnifiedChat {...props(NB_B, [PLAIN_TURN_B])} />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("24VDC.")).toBeTruthy();
    expect(screen.queryByText(/Searching SMC's documentation/)).toBeNull();
  });
});
