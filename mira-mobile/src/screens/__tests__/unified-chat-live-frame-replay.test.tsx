// @vitest-environment jsdom
// Codex round 4 F14 (#4195): a live SSE `manual_search_status` frame NEVER
// carries `startedAt` — chat/route.ts's own frame builder omits it (see the
// Codex F14 doc comment on `reseedManualSearchFollow` in
// `packages/factorylm-interaction/src/manual-search-follow.ts`), and the
// mobile adapter's `unknownInteractionPart` (`../../unified/to-interaction.ts`)
// does not carry one through even if it existed. An UNRELATED parent
// rerender that rebuilds `meta`/`liveTurns` with equivalent-but-new object
// identity re-feeds that SAME historical, generation-less frame into the
// live-status effect (`UnifiedChat.tsx` ~L230) on every render. Before the
// fix this read as "a different generation" (the empty-generation key never
// matches a known one) and (a)-reset: reopening a settled search or
// replenishing an exhausted budget on every unrelated rerender. This file
// proves the HOST WIRING stays settled across that replay, while a
// genuinely new search (which always arrives with its OWN `startedAt`, via
// the authoritative confirm/GET paths — never via this live-frame path)
// still starts following.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/unified-chat-live-frame-replay
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

/** A STALE, historical live frame — exactly the shape chat/route.ts emits:
 *  NO `startedAt`, ever. A FRESH object literal on every call, matching an
 *  unrelated parent rerender that rebuilds `liveTurns` with
 *  equivalent-but-new content (not the same reference). */
function staleLiveFrame(): { q: string; a: ChatTurn } {
  return {
    q: "is this an SMC SS5Y3-DUW01302?",
    a: {
      answer: "Looking into it.",
      citations: [],
      status: "answered",
      unknownFrames: [{ kind: "manual_search_status", manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true }],
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

function props(
  liveTurns: { q: string; a: ChatTurn }[],
  turns: NotebookServerTurn[] = [SMC_TURN],
): UnifiedChatProps {
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
});

describe("UnifiedChat — a generation-less live frame replay never reopens a settled search (#4195 round 4 F14)", () => {
  it("stays settled across an unrelated rerender that re-feeds the SAME stale historical frame", async () => {
    vi.useFakeTimers();
    // Hydration GET starts following with a KNOWN generation.
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    const view = render(<UnifiedChat {...props([staleLiveFrame()])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();

    // The tick settles it to a KNOWN generation.
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText("Found it.")).toBeTruthy();
    const callsAtSettle = fetchManualSearchStatus.mock.calls.length;

    // An UNRELATED parent rerender rebuilds `meta`/`liveTurns` with brand-new
    // object identity but EQUIVALENT content — the SAME stale frame.
    view.rerender(<UnifiedChat {...props([staleLiveFrame()])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Found it.")).toBeTruthy();
    expect(screen.queryByText(/Searching SMC's documentation/)).toBeNull();
    // No new GET was triggered by the replay — it never reopened tracking.
    expect(fetchManualSearchStatus.mock.calls.length).toBe(callsAtSettle);

    // Several more equivalent-but-new rerenders: still settled, never resets.
    for (let i = 0; i < 3; i++) {
      view.rerender(<UnifiedChat {...props([staleLiveFrame()])} />);
      await act(async () => { await Promise.resolve(); });
    }
    expect(screen.getByText("Found it.")).toBeTruthy();
    expect(fetchManualSearchStatus.mock.calls.length).toBe(callsAtSettle);
  });

  it("stays unresolved (budget exhausted) across the same stale replay — never replenishes the spent budget", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    const view = render(<UnifiedChat {...props([staleLiveFrame()])} />);
    await act(async () => { await Promise.resolve(); });
    for (let i = 0; i < 5; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    }
    expect(screen.getByText(/Still searching — check back in a minute\./)).toBeTruthy();
    const callsAtUnresolved = fetchManualSearchStatus.mock.calls.length;

    view.rerender(<UnifiedChat {...props([staleLiveFrame()])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Still searching — check back in a minute\./)).toBeTruthy();
    expect(fetchManualSearchStatus.mock.calls.length).toBe(callsAtUnresolved);
  });

  it("a genuinely NEW search (its own startedAt, via the confirm path) still starts following right after a settled one", async () => {
    vi.useFakeTimers();
    // The FIRST identity's search is already settled on hydration.
    fetchManualSearchStatus.mockResolvedValueOnce({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" });
    const onSend = vi.fn();
    render(
      <UnifiedChat
        {...props([], [SMC_TURN, ROCKWELL_TURN])}
        handlers={{ onSend, onStop: () => {}, onCitation: () => {} }}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Found it.")).toBeTruthy();

    // Confirming the SECOND, different identity starts a NEW search with its
    // OWN generation ("gen-2") — the confirm route's own structured response,
    // never the generation-less live-frame path.
    confirmIdentityProposal.mockResolvedValue({
      manualReady: false, searching: true, startedAt: "gen-2",
      message: "Confirmed. I'll look for its manual.",
    });
    // The immediate authoritative re-read right after confirm (Codex F6)
    // doesn't see the row yet — the optimistic seed (using `startedAt` from
    // the confirm response itself) is what takes effect.
    fetchManualSearchStatus.mockResolvedValueOnce(null);
    const confirmButtons = screen.getAllByRole("button", { name: "Use its manuals" });
    await act(async () => {
      fireEvent.click(confirmButtons[1]!);
      await Promise.resolve();
    });

    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();
  });
});
