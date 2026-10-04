// @vitest-environment jsdom
// #4195 — Codex rounds 8–11 found the SAME defect class four times (F23, F23
// follow-up, F25, F26), always in the interaction between the THREE
// independent async readers of `fetchManualSearchStatus` that used to write
// into `UnifiedChat.tsx`'s one `follow` state: the mount-time hydration
// effect, the periodic poll-chain effect, and the confirm path's own
// "authoritative" read. `searchInputEpochRef` was patched once per round to
// fence a different interleaving, and each patch opened another one — a
// counter bumped on every concrete read cannot tell "five null polls on the
// SAME generation" (must never invalidate a slow, still-relevant read — F25)
// apart from "a live frame started a DIFFERENT generation" (must invalidate
// — F23), so every fix for one broke the other.
//
// The remediation collapses the three readers into ONE owned state machine
// (`createMobileManualSearchDriver` in `UnifiedChat.tsx`, modeled on the
// Hub's `manual-search-driver.ts`) with GENERATION-KEY fencing instead of a
// counter: a read is discarded only when tracking has moved on to a
// DIFFERENT generation than the one captured when the read was dispatched,
// AND the read itself isn't reporting on whatever is now current. This file
// is the interleaving matrix that proves it — write FIRST, per the request,
// before the implementation changed; see the task report for the exact
// pre-change / post-change result of every case below.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/unified-chat-search-follow-matrix
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

const { fetchManualSearchStatus, confirmIdentityProposal, getNotebookDetail } = vi.hoisted(() => ({
  fetchManualSearchStatus: vi.fn(),
  confirmIdentityProposal: vi.fn(),
  getNotebookDetail: vi.fn(async () => ({ notebook: {}, sources: [], turns: [], threads: [], photos: [] })),
}));
vi.mock("../../api/manual-search-status", () => ({ fetchManualSearchStatus }));
vi.mock("../../api/identity-confirm", () => ({ confirmIdentityProposal }));
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, getNotebookDetail };
});

import { UnifiedChat, type UnifiedChatProps } from "../UnifiedChat";
import type { NotebookServerTurn } from "../../api/resources";
import type { ChatTurn } from "../../lib/sse";

const NB = "nb-1";

/** A live SSE `manual_search_status` frame — a FRESH object literal every
 *  call, matching how an unrelated parent rerender rebuilds `liveTurns`. */
function liveFrame(manufacturer: string, model: string, running: boolean, startedAt: string): { q: string; a: ChatTurn } {
  return {
    q: `is this a ${manufacturer} ${model}?`,
    a: {
      answer: "Looking into it.",
      citations: [],
      status: "answered",
      unknownFrames: [{ kind: "manual_search_status", manufacturer, model, running, startedAt }],
    },
  };
}

const SMC_TURN: NotebookServerTurn = {
  id: "t1",
  question: "is this an SMC SS5Y3-DUW01302?",
  answerStatus: "insufficient_evidence",
  answerText: null,
  evidence: [{ kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" }],
  basis: null,
};

const ROCKWELL_TURN: NotebookServerTurn = {
  id: "t2",
  question: "is this a Rockwell 1756-L71?",
  answerStatus: "insufficient_evidence",
  answerText: null,
  evidence: [{ kind: "identity_proposal", manufacturer: "Rockwell", model: "1756-L71" }],
  basis: null,
};

function props(liveTurns: { q: string; a: ChatTurn }[] = [], turns: NotebookServerTurn[] = [SMC_TURN]): UnifiedChatProps {
  return {
    turns,
    liveTurns,
    pending: null,
    busy: false,
    canStop: false,
    canRetry: false,
    chatError: null,
    handlers: { onSend: vi.fn(), onStop: () => {}, onCitation: () => {} },
    meta: { notebookId: NB, threadId: "notebook-nb-1:thread-legacy", title: "CV-101", identityConfirmed: false },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  fetchManualSearchStatus.mockReset();
  confirmIdentityProposal.mockReset();
  getNotebookDetail.mockClear();
});

describe("Invariant 1 — the shown status reflects the most recently STARTED read, unless a newer-generation live frame arrived after it started", () => {
  it("F23: a delayed mount-time hydration read for G1 never replaces a newer live-frame generation G2", async () => {
    vi.useFakeTimers();
    let resolveMount!: (v: unknown) => void;
    fetchManualSearchStatus.mockImplementationOnce(() => new Promise((r) => { resolveMount = r; }));
    const view = render(<UnifiedChat {...props([], [SMC_TURN, ROCKWELL_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(fetchManualSearchStatus).toHaveBeenCalledTimes(1);

    // A newer search starts on the live stream while the mount-time read is still in flight.
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "Rockwell", model: "1756-L71", running: true, startedAt: "gen-2" });
    view.rerender(<UnifiedChat {...props([liveFrame("Rockwell", "1756-L71", true, "gen-2")], [SMC_TURN, ROCKWELL_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();

    // The stale mount-time read (an older, already-settled G1) lands now.
    await act(async () => {
      resolveMount({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Old result.", startedAt: "gen-1" });
      await Promise.resolve();
    });
    expect(screen.queryByText("Old result.")).toBeNull();
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();

    // G2 is still actively being followed — the next tick runs.
    const before = fetchManualSearchStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fetchManualSearchStatus.mock.calls.length).toBe(before + 1);
  });

  it("F23 follow-up: a delayed mount-time hydration read for G1 never replaces a newer generation G2 discovered by POLLING (not a live frame)", async () => {
    vi.useFakeTimers();
    let resolveMount!: (v: unknown) => void;
    fetchManualSearchStatus.mockImplementationOnce(() => new Promise((r) => { resolveMount = r; }));
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "Rockwell", model: "1756-L71", running: true, startedAt: "gen-2" });
    // A cached running G1 live frame is already present at mount — the screen
    // follows G1 (seeded by the live-frame input) while the mount-time read is
    // still in flight.
    render(<UnifiedChat {...props([liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1")], [SMC_TURN, ROCKWELL_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();

    // The periodic poll (G1's own next tick) discovers a DIFFERENT generation, G2.
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();

    // The stale mount-time read (G1, settled) arrives only now.
    await act(async () => {
      resolveMount({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Old result.", startedAt: "gen-1" });
      await Promise.resolve();
    });
    expect(screen.queryByText("Old result.")).toBeNull();
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();
    const before = fetchManualSearchStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fetchManualSearchStatus.mock.calls.length).toBe(before + 1);
  });
});

describe("Invariant 2 — a null response never discards information", () => {
  it("F25: five null polls on the SAME generation never discard a delayed, valid settled read for THAT generation", async () => {
    vi.useFakeTimers();
    let resolveMount!: (v: unknown) => void;
    fetchManualSearchStatus.mockImplementationOnce(() => new Promise((r) => { resolveMount = r; }));
    fetchManualSearchStatus.mockResolvedValue(null); // every poll in between is inconclusive
    render(<UnifiedChat {...props([liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1")], [SMC_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    for (let i = 0; i < 5; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    }
    expect(screen.getByText(/Still searching — check back in a minute\./)).toBeTruthy();

    // The slow mount-time read for the SAME generation (gen-1) finally lands
    // with the real, settled outcome — it must win over "gave up at budget".
    await act(async () => {
      resolveMount({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" });
      await Promise.resolve();
    });
    expect(screen.getByText("Found it.")).toBeTruthy();
  });

  it("a null poll keeps showing the last known running status, not a blank card", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValueOnce({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    render(<UnifiedChat {...props([], [SMC_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();

    fetchManualSearchStatus.mockResolvedValueOnce(null);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();
  });
});

describe("Invariant 3 — while following, a next tick is always scheduled until settle or budget exhaustion", () => {
  it("fetchManualSearchStatus call counts keep advancing with each timer tick", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    render(<UnifiedChat {...props([], [SMC_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    let calls = fetchManualSearchStatus.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
      const next = fetchManualSearchStatus.mock.calls.length;
      expect(next).toBeGreaterThan(calls);
      calls = next;
    }
  });

  it("stops scheduling once the budget is exhausted (unresolved)", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    render(<UnifiedChat {...props([], [SMC_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    for (let i = 0; i < 5; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    }
    expect(screen.getByText(/Still searching — check back in a minute\./)).toBeTruthy();
    const calls = fetchManualSearchStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(fetchManualSearchStatus.mock.calls.length).toBe(calls);
  });

  it("stops scheduling once settled", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValueOnce({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    render(<UnifiedChat {...props([], [SMC_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText("Found it.")).toBeTruthy();
    const calls = fetchManualSearchStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(fetchManualSearchStatus.mock.calls.length).toBe(calls);
  });
});

describe("Invariant 4 — the budget is never refilled by a replay", () => {
  it("an unrelated rerender re-delivering an identical, already-settled live frame does not reopen tracking or spend a request", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    const view = render(<UnifiedChat {...props([liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1")])} />);
    await act(async () => { await Promise.resolve(); });

    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText("Found it.")).toBeTruthy();
    const callsAtSettle = fetchManualSearchStatus.mock.calls.length;

    for (let i = 0; i < 3; i++) {
      view.rerender(<UnifiedChat {...props([liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1")])} />);
      await act(async () => { await Promise.resolve(); });
    }
    expect(screen.getByText("Found it.")).toBeTruthy();
    expect(fetchManualSearchStatus.mock.calls.length).toBe(callsAtSettle);
  });

  it("an exhausted (unresolved) generation stays unresolved across a replay of the same live frame", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    const view = render(<UnifiedChat {...props([liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1")])} />);
    await act(async () => { await Promise.resolve(); });
    for (let i = 0; i < 5; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    }
    expect(screen.getByText(/Still searching — check back in a minute\./)).toBeTruthy();
    const calls = fetchManualSearchStatus.mock.calls.length;

    view.rerender(<UnifiedChat {...props([liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1")])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Still searching — check back in a minute\./)).toBeTruthy();
    expect(fetchManualSearchStatus.mock.calls.length).toBe(calls);
  });
});

describe("Invariant 5 — a reload with no running search shows nothing and does not poll forever", () => {
  it("renders nothing and makes exactly one read when nothing is running", async () => {
    fetchManualSearchStatus.mockResolvedValue(null);
    render(<UnifiedChat {...props([], [SMC_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText(/Searching/)).toBeNull();
    expect(screen.queryByText(/Still searching/)).toBeNull();
    expect(fetchManualSearchStatus).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a retry on its own after a null probe", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue(null);
    render(<UnifiedChat {...props([], [SMC_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    const calls = fetchManualSearchStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetchManualSearchStatus.mock.calls.length).toBe(calls);
    expect(screen.queryByText(/Searching/)).toBeNull();
  });
});

describe("F26: a pre-confirmation poll in flight must not invalidate a fresher confirmation read for the SAME generation", () => {
  it("resolves to the confirmed READY status even though an older, in-flight poll for the same generation lands first", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    render(<UnifiedChat {...props([], [SMC_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    // Consume four attempts.
    for (let i = 0; i < 4; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    }
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();

    // The fifth poll is dispatched but its response is deferred.
    let resolveFifthPoll!: (v: unknown) => void;
    fetchManualSearchStatus.mockImplementationOnce(() => new Promise((r) => { resolveFifthPoll = r; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });

    // A confirm fires while that fifth poll is still pending, and reports
    // searching:false — the handler requests an authoritative probe instead
    // of fetching itself.
    confirmIdentityProposal.mockResolvedValue({ manualReady: true, searching: false, message: "Confirmed." });
    let resolveConfirmProbe!: (v: unknown) => void;
    fetchManualSearchStatus.mockImplementationOnce(() => new Promise((r) => { resolveConfirmProbe = r; }));
    const confirmButton = screen.getByRole("button", { name: "Use its manuals" });
    await act(async () => { fireEvent.click(confirmButton); await Promise.resolve(); });

    // The OLDER poll resolves first, still reporting running (its snapshot,
    // taken before confirm).
    await act(async () => {
      resolveFifthPoll({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
      await Promise.resolve();
    });
    // The NEWER confirmation probe resolves second, with the real outcome.
    await act(async () => {
      resolveConfirmProbe({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Ready — check Sources.", startedAt: "gen-1" });
      await Promise.resolve();
    });

    expect(screen.getByText("Ready — check Sources.")).toBeTruthy();
    expect(screen.queryByText(/Still searching — check back in a minute\./)).toBeNull();
  });
});

describe("Confirm-reconcile (#4195 round 4 F6): a settled candidate-review message is replaced by the authoritative status after a manualReady:true/searching:false confirm — no second send, no remount", () => {
  it("replaces a stale 'not turned on' decline with the real, ready outcome", async () => {
    fetchManualSearchStatus.mockResolvedValueOnce({
      manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false,
      message: "Candidate: not turned on.", startedAt: "gen-1",
    });
    confirmIdentityProposal.mockResolvedValue({ manualReady: true, searching: false, message: "Confirmed." });
    render(<UnifiedChat {...props([], [SMC_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Candidate: not turned on.")).toBeTruthy();

    fetchManualSearchStatus.mockResolvedValue({
      manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false,
      message: "Ready — check Sources.", startedAt: "gen-1",
    });
    const confirmButton = screen.getByRole("button", { name: "Use its manuals" });
    await act(async () => { fireEvent.click(confirmButton); await Promise.resolve(); });

    expect(screen.getByText("Ready — check Sources.")).toBeTruthy();
    expect(screen.queryByText("Candidate: not turned on.")).toBeNull();
    expect(confirmIdentityProposal).toHaveBeenCalledTimes(1);
  });
});
