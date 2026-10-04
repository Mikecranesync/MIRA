// @vitest-environment jsdom
// Codex round 4 F14 (#4195): a live SSE `manual_search_status` frame used to
// NEVER carry `startedAt` — chat/route.ts's own frame builder omitted it —
// and an UNRELATED parent rerender that rebuilds `meta`/`liveTurns` with
// equivalent-but-new object identity could re-feed that SAME historical,
// generation-less frame into the live-status effect (`UnifiedChat.tsx`'s
// effect over `latestManualSearchStatus`) on every render. Before the fix
// this read as "a different generation" and reset: reopening a settled
// search or replenishing an exhausted budget on every unrelated rerender.
//
// Round 5 F15: the chat route NOW stamps a real `startedAt` on every live
// frame (`manualSearchStatusFrame`), and the mobile decoder
// (`../../unified/to-interaction.ts`'s `unknownInteractionPart`) carries it
// through. The generation-less scenario below is KEPT as a backward-compat
// case (an older server that predates the stamp) — see
// `observeLiveManualSearchFrame`'s own header
// (`packages/factorylm-interaction/src/manual-search-follow.ts`) for the
// full state machine. This file now ALSO proves the two things that change
// once a live frame carries a generation: (1) a SAME-generation replay that
// still says `running: true` must stay a no-op even though it now carries a
// real generation (the regression `reseedManualSearchFollow` would introduce
// for live frames), and (2) a genuinely NEW search reported purely via a
// live frame — no confirm, no GET — starts following immediately, even
// right after an older generation already settled.
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

/** A STALE, historical live frame carrying NO `startedAt` — the backward-
 *  compat case (an older server that predates the chat-route stamp). A
 *  FRESH object literal on every call, matching an unrelated parent
 *  rerender that rebuilds `liveTurns` with equivalent-but-new content (not
 *  the same reference). */
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

/** Round 5 (#4195 F15): the SAME shape, but WITH a generation — what a
 *  current server actually sends. A fresh object literal on every call. */
function liveFrame(
  manufacturer: string,
  model: string,
  running: boolean,
  startedAt: string,
): { q: string; a: ChatTurn } {
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

describe("UnifiedChat — a live frame WITH a generation (#4195 round 5 F15)", () => {
  it("a SAME-generation live frame replay, still saying running:true, stays settled — no new request (the regression a current server's stamp could introduce)", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    const view = render(<UnifiedChat {...props([liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1")])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();

    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText("Found it.")).toBeTruthy();
    const callsAtSettle = fetchManualSearchStatus.mock.calls.length;

    // An unrelated rerender re-delivers the EXACT same gen-1 frame, still
    // `running: true` (a stale snapshot cached from before the search
    // settled). Rerendering the old turn alone must make ZERO new requests
    // and must NOT reopen the settled search.
    view.rerender(<UnifiedChat {...props([liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1")])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Found it.")).toBeTruthy();
    expect(screen.queryByText(/Searching SMC's documentation/)).toBeNull();
    expect(fetchManualSearchStatus.mock.calls.length).toBe(callsAtSettle);
  });

  it("a genuinely NEW search reported purely via a LIVE FRAME (its own, different generation) starts following and resolves — no confirm needed (THE F15 fix)", async () => {
    vi.useFakeTimers();
    // gen-1's search is already settled on hydration.
    fetchManualSearchStatus.mockResolvedValueOnce({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" });
    const view = render(<UnifiedChat {...props([], [SMC_TURN, ROCKWELL_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Found it.")).toBeTruthy();
    const callsAtSmcSettle = fetchManualSearchStatus.mock.calls.length;

    // A genuinely new candidate search for a DIFFERENT part (Rockwell),
    // reported live with its OWN gen-2 — no confirm click, no GET yet. The
    // "Searching…" message renders directly from the live frame itself,
    // with no fetch — proving the OLD gen-1 settle never suppressed it.
    view.rerender(<UnifiedChat {...props([liveFrame("Rockwell", "1756-L71", true, "gen-2")], [SMC_TURN, ROCKWELL_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();
    expect(fetchManualSearchStatus.mock.calls.length).toBe(callsAtSmcSettle); // no fetch yet — the live frame alone started it

    // Polling starts: the periodic tick (not the live frame) issues the next
    // GET, keyed to gen-2, and that's what resolves it.
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "Rockwell", model: "1756-L71", running: false, message: "Found it (2).", startedAt: "gen-2" });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fetchManualSearchStatus.mock.calls.length).toBe(callsAtSmcSettle + 1);
    expect(screen.getByText("Found it (2).")).toBeTruthy();
  });
});

// Codex round 6 F17 (#4195): `UnifiedChat` tracked exactly ONE active search
// (`follow`) and overlaid only ITS status onto the thread
// (`withManualSearchOverride(baseThread, follow?.status ?? null)`). The
// moment a SECOND, different search took over that one slot, the FIRST
// search's settled outcome had nothing left overlaying it, and its turn
// reverted to the raw, still-`running: true` frame baked into `baseThread`
// (the server never updates a historical SSE frame after the fact) —
// indefinitely, since nothing ever re-checks it again. Fixed by
// `settledManualSearches` (a per-generation outcome map) +
// `withManualSearchOverrides` (apply every known outcome, not just the
// active one) — see `UnifiedChat.tsx` and `to-interaction.ts`.
describe("UnifiedChat — a second, different search must not erase the first search's resolved outcome (#4195 round 6 F17)", () => {
  it("SMC resolves, then Rockwell starts and resolves — neither shows Searching, and SMC's resolved outcome survives across unrelated rerenders", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    const view = render(<UnifiedChat {...props([liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1")])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();

    // SMC's search settles.
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it (SMC).", startedAt: "gen-1" });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText("Found it (SMC).")).toBeTruthy();

    // A SECOND, different search starts — Rockwell's OWN live frame, its
    // own generation (gen-2). SMC's RAW frame is STILL present in
    // `liveTurns` (still `running: true` — this is exactly where SMC's turn
    // would revert without the fix).
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "Rockwell", model: "1756-L71", running: true, startedAt: "gen-2" });
    view.rerender(
      <UnifiedChat
        {...props([
          liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1"),
          liveFrame("Rockwell", "1756-L71", true, "gen-2"),
        ])}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Found it (SMC).")).toBeTruthy();
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();
    expect(screen.queryByText(/Searching SMC's documentation/)).toBeNull();

    // Rockwell's search settles too.
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "Rockwell", model: "1756-L71", running: false, message: "Found it (Rockwell).", startedAt: "gen-2" });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText("Found it (SMC).")).toBeTruthy();
    expect(screen.getByText("Found it (Rockwell).")).toBeTruthy();
    expect(screen.queryByText(/Searching/)).toBeNull();

    // Several unrelated rerenders with EQUIVALENT-but-new live-frame
    // objects: both outcomes stay exactly as settled, and the replay makes
    // no new requests.
    const callsAtBothSettled = fetchManualSearchStatus.mock.calls.length;
    for (let i = 0; i < 3; i++) {
      view.rerender(
        <UnifiedChat
          {...props([
            liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1"),
            liveFrame("Rockwell", "1756-L71", true, "gen-2"),
          ])}
        />,
      );
      await act(async () => { await Promise.resolve(); });
    }
    expect(screen.getByText("Found it (SMC).")).toBeTruthy();
    expect(screen.getByText("Found it (Rockwell).")).toBeTruthy();
    expect(screen.queryByText(/Searching/)).toBeNull();
    expect(fetchManualSearchStatus.mock.calls.length).toBe(callsAtBothSettled);
  });

  // The "orphan" half of F17: a generation ABANDONED mid-flight by a newer
  // live frame before it ever settled is in neither the settled map (it
  // never reached phase !== "following") nor the active follow — without
  // handling, it would spin "Searching…" forever too, just via a different
  // path than the settled case above.
  it("a search dropped by a THIRD generation before it ever settled renders the shared neutral fallback, not a perpetual spinner", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValueOnce({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it (SMC).", startedAt: "gen-1" });
    const view = render(<UnifiedChat {...props([liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1")])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Found it (SMC).")).toBeTruthy();

    // gen-2 (Rockwell) starts via its own live frame and never settles.
    view.rerender(
      <UnifiedChat
        {...props([
          liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1"),
          liveFrame("Rockwell", "1756-L71", true, "gen-2"),
        ])}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();

    // gen-3 (Siemens) arrives via a THIRD live frame BEFORE gen-2 ever
    // settles — the follower abandons gen-2 outright, mid-flight.
    view.rerender(
      <UnifiedChat
        {...props([
          liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1"),
          liveFrame("Rockwell", "1756-L71", true, "gen-2"),
          liveFrame("Siemens", "6ES7", true, "gen-3"),
        ])}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    // gen-2 (Rockwell) never gets a perpetual spinner — the shared
    // renderer's OWN existing non-running fallback, not invented copy.
    expect(screen.queryByText(/Searching Rockwell's documentation/)).toBeNull();
    expect(screen.getByText("Finished searching for the Rockwell 1756-L71 manual.")).toBeTruthy();
    // gen-3 (Siemens), the new active follow, is actually "Searching…".
    expect(screen.getByText(/Searching Siemens's documentation for 6ES7…/)).toBeTruthy();
    // gen-1 (SMC) is untouched throughout.
    expect(screen.getByText("Found it (SMC).")).toBeTruthy();
  });
});

describe("UnifiedChat — a delayed hydration read never replaces a newer live search (#4195 Codex r8 F23)", () => {
  it("keeps following generation G2 when the mount-time GET for an older settled G1 arrives after G2's live frame", async () => {
    vi.useFakeTimers();
    let resolveHydration!: (v: unknown) => void;
    fetchManualSearchStatus.mockImplementationOnce(() => new Promise((r) => { resolveHydration = r; }));
    const view = render(<UnifiedChat {...props([], [SMC_TURN, ROCKWELL_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(fetchManualSearchStatus).toHaveBeenCalledTimes(1);

    // A newer search starts on the live stream while the hydration GET is still in flight.
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "Rockwell", model: "1756-L71", running: true, startedAt: "gen-2" });
    view.rerender(<UnifiedChat {...props([liveFrame("Rockwell", "1756-L71", true, "gen-2")], [SMC_TURN, ROCKWELL_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();

    // The stale hydration answer (an older, already-settled G1) lands now.
    await act(async () => {
      resolveHydration({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Old result.", startedAt: "gen-1" });
      await Promise.resolve();
    });
    expect(screen.queryByText("Old result.")).toBeNull();
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();

    // G2 is still being polled.
    const before = fetchManualSearchStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fetchManualSearchStatus.mock.calls.length).toBe(before + 1);
  });

  // Codex round 11 remediation (#4195, single reader): this used to race a
  // confirm's OWN authoritative `fetchManualSearchStatus` call (dispatched
  // unconditionally after every confirm) against a live frame. That call no
  // longer exists for `searching: true` (a pure optimistic seed now — see
  // `createMobileManualSearchDriver`'s `seed`); the remaining analogous read
  // is the PROBE the confirm path requests when the route reports
  // `searching: false` (`driver.probe()`), which is exactly what this test
  // now exercises — same race shape, same invariant, through the surviving
  // mechanism.
  it("a confirm-requested probe that lands after a newer live frame does not replace it", async () => {
    fetchManualSearchStatus.mockResolvedValueOnce(null); // mount-time hydration: nothing yet
    let resolveConfirmProbe!: (v: unknown) => void;
    fetchManualSearchStatus.mockImplementationOnce(() => new Promise((r) => { resolveConfirmProbe = r; }));
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "Rockwell", model: "1756-L71", running: true, startedAt: "gen-2" });
    confirmIdentityProposal.mockResolvedValue({ manualReady: false, searching: false, message: "No automatic manual search was started." });
    const view = render(<UnifiedChat {...props([], [SMC_TURN, ROCKWELL_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    const confirm = (await screen.findAllByRole("button", { name: "Use its manuals" }))[0]!;
    await act(async () => { fireEvent.click(confirm); });
    for (let i = 0; i < 10 && fetchManualSearchStatus.mock.calls.length < 2; i++) {
      await act(async () => { await Promise.resolve(); });
    }
    expect(fetchManualSearchStatus.mock.calls.length).toBeGreaterThanOrEqual(2);

    view.rerender(<UnifiedChat {...props([liveFrame("Rockwell", "1756-L71", true, "gen-2")], [SMC_TURN, ROCKWELL_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();

    await act(async () => {
      resolveConfirmProbe({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Old result.", startedAt: "gen-1" });
      await Promise.resolve();
    });
    expect(screen.queryByText("Old result.")).toBeNull();
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();
  });

  it("Codex r9: a delayed hydration read does not replace a newer search discovered by polling", async () => {
    vi.useFakeTimers();
    let resolveHydration!: (v: unknown) => void;
    fetchManualSearchStatus.mockImplementationOnce(() => new Promise((r) => { resolveHydration = r; }));
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "Rockwell", model: "1756-L71", running: true, startedAt: "gen-2" });
    // A cached running G1 frame: the screen follows G1 while hydration is still in flight.
    render(<UnifiedChat {...props([liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1")], [SMC_TURN, ROCKWELL_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();

    // The periodic poll discovers a newer search G2.
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();

    // The stale hydration answer (G1, settled) arrives only now.
    await act(async () => {
      resolveHydration({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Old result.", startedAt: "gen-1" });
      await Promise.resolve();
    });
    expect(screen.queryByText("Old result.")).toBeNull();
    expect(screen.getByText(/Searching Rockwell's documentation for 1756-L71…/)).toBeTruthy();
    const before = fetchManualSearchStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fetchManualSearchStatus.mock.calls.length).toBe(before + 1);
  });

  it("Codex r10 F25: empty polls do not discard a delayed but valid settled hydration result", async () => {
    vi.useFakeTimers();
    let resolveHydration!: (v: unknown) => void;
    fetchManualSearchStatus.mockImplementationOnce(() => new Promise((r) => { resolveHydration = r; }));
    fetchManualSearchStatus.mockResolvedValue(null); // transient: polls return no status
    render(<UnifiedChat {...props([liveFrame("SMC", "SS5Y3-DUW01302", true, "gen-1")], [SMC_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    for (let i = 0; i < 5; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    }
    expect(screen.getByText(/Still searching — check back in a minute\./)).toBeTruthy();

    await act(async () => {
      resolveHydration({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" });
      await Promise.resolve();
    });
    expect(screen.getByText("Found it.")).toBeTruthy();
  });

  it("control: a hydration read with no newer input still seeds the follower", async () => {
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" });
    render(<UnifiedChat {...props([], [SMC_TURN])} />);
    await act(async () => { await Promise.resolve(); });
    expect(await screen.findByText("Found it.")).toBeTruthy();
  });
});
