// @vitest-environment jsdom
// Codex round 2 (#4195 F4/F6/F8/F9): the searching indicator must (a) follow
// a search that started on HYDRATION (no live frame — the server never
// persists manual_search_status), (b) follow a search a CONFIRMATION
// started, (c) never reset its attempt budget on a `running` response, and
// (d) never silently abandon tracking on a single inconclusive/null read.
// All driven by the shared, pure `manual-search-follow.ts` state machine;
// this file proves the HOST WIRING (timers + the detail-fetch seam) around it.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/unified-chat-manual-search-status
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

import { UnifiedChat } from "../UnifiedChat";
import type { NotebookServerTurn } from "../../api/resources";

const NB = "nb-1";

/** A persisted turn carrying ONLY an identity_proposal — no manual_search_status
 *  frame. This is the REALISTIC persisted shape (chat/route.ts never persists
 *  the status frame); the confirm card's own manufacturer+model is what the
 *  hydration check keys its GET on. */
const PROPOSAL_ONLY_TURN: NotebookServerTurn = {
  id: "t1",
  question: "is this an SMC SS5Y3-DUW01302?",
  answerStatus: "insufficient_evidence",
  answerText: null,
  evidence: [{ kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" }],
  basis: null,
};

function mount(turns: NotebookServerTurn[] = [PROPOSAL_ONLY_TURN], onSend: (...a: unknown[]) => void = vi.fn()) {
  return render(
    <UnifiedChat
      turns={turns}
      liveTurns={[]}
      pending={null}
      busy={false}
      canStop={false}
      canRetry={false}
      chatError={null}
      handlers={{ onSend, onStop: () => {}, onCitation: () => {} }}
      meta={{ notebookId: NB, threadId: "notebook-nb-1:thread-legacy", title: "CV-101", identityConfirmed: false }}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  fetchManualSearchStatus.mockReset();
  confirmIdentityProposal.mockReset();
});

describe("UnifiedChat — hydration follows a running search to completion (#4195 F4/F6)", () => {
  it("has no status rendered before the first hydration check resolves, then renders running, then the settled outcome", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (v: unknown) => void;
    fetchManualSearchStatus.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    mount();
    expect(screen.queryByText(/Searching/)).toBeNull();

    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it — check Sources.", startedAt: "gen-1" });
    await act(async () => {
      resolveFirst({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
      await Promise.resolve();
    });
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByText("Found it — check Sources.")).toBeTruthy();
    expect(screen.queryByText(/Searching SMC's documentation/)).toBeNull();
  });

  it("survives a remount — the SAME hydration check runs again and is followed again", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    const view = mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/Searching/)).toBeTruthy();
    view.unmount();
    cleanup();

    fetchManualSearchStatus.mockReset();
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Done on reopen.", startedAt: "gen-1" });
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Done on reopen.")).toBeTruthy();
  });
});

describe("UnifiedChat — a confirmation that starts a search is followed (#4195 F4)", () => {
  it("follows progress after confirming, using the structured `searching` signal (not scraped from message text)", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue(null); // nothing running yet at hydration time
    confirmIdentityProposal.mockResolvedValue({ manualReady: false, searching: true, message: "Confirmed. I'll look for its manual." });
    mount();
    await act(async () => {
      await Promise.resolve();
    });

    const confirmButton = screen.getByRole("button", { name: "Use its manuals" });
    await act(async () => {
      fireEvent.click(confirmButton);
      await Promise.resolve();
    });
    // The optimistic follow starts immediately, before any GET confirms it.
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();

    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByText("Found it.")).toBeTruthy();
  });

  it("does NOT start following when the confirm route reports searching:false", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue(null);
    confirmIdentityProposal.mockResolvedValue({ manualReady: false, searching: false, message: "No automatic manual search was started." });
    mount();
    await act(async () => { await Promise.resolve(); });
    const confirmButton = screen.getByRole("button", { name: "Use its manuals" });
    await act(async () => {
      fireEvent.click(confirmButton);
      await Promise.resolve();
    });
    expect(screen.queryByText(/Searching SMC's documentation/)).toBeNull();
  });
});

describe("UnifiedChat — confirm reconciles against the AUTHORITATIVE status regardless of `searching` (#4195 round 4 F6)", () => {
  it("a settled candidate-review decline disappears after a confirm that promotes WITHOUT starting a new search (manualReady:true, searching:false)", async () => {
    // Hydration settles on a NEGATIVE candidate-review outcome for a KNOWN generation.
    fetchManualSearchStatus.mockResolvedValueOnce({
      manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false,
      message: "Candidate: not turned on.", startedAt: "gen-1",
    });
    confirmIdentityProposal.mockResolvedValue({ manualReady: true, searching: false, message: "Confirmed." });
    mount();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Candidate: not turned on.")).toBeTruthy();

    // The authoritative re-read AFTER confirm reports the SAME generation,
    // now ready — this is what the confirm handler must now fetch even
    // though `searching` is false.
    fetchManualSearchStatus.mockResolvedValue({
      manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false,
      message: "Ready — check Sources.", startedAt: "gen-1",
    });
    const confirmButton = screen.getByRole("button", { name: "Use its manuals" });
    await act(async () => {
      fireEvent.click(confirmButton);
      await Promise.resolve();
    });

    // The old decline is gone, replaced by the authoritative ready status —
    // with no further send and no remount.
    expect(screen.getByText("Ready — check Sources.")).toBeTruthy();
    expect(screen.queryByText("Candidate: not turned on.")).toBeNull();
    expect(confirmIdentityProposal).toHaveBeenCalledTimes(1);
  });
});

describe("UnifiedChat — the attempt budget (Codex F8) and inconclusive reads (Codex F9)", () => {
  it("does not reset the budget on repeated running responses, and terminates unresolved at the fixed cap", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    mount();
    // The hydration check SEEDS the follow (attempts:0) — it does not itself
    // spend a budget attempt; only the tick effect's re-checks do.
    await act(async () => { await Promise.resolve(); });
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
    }
    // 5 ticks exhausts the 5-attempt budget.
    expect(screen.getByText(/Still searching — check back in a minute\./)).toBeTruthy();
    // No further requests once unresolved.
    const callsAtUnresolved = fetchManualSearchStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(fetchManualSearchStatus.mock.calls.length).toBe(callsAtUnresolved);
  });

  it("a single null (inconclusive) read does not abandon tracking — it keeps following and later settles", async () => {
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValueOnce({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true, startedAt: "gen-1" });
    mount();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Searching/)).toBeTruthy();

    fetchManualSearchStatus.mockResolvedValueOnce(null); // a transient failure, surfaced as null
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    // Still showing the last known ("Searching…") status — not blanked.
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();

    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Recovered and found it.", startedAt: "gen-1" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByText("Recovered and found it.")).toBeTruthy();
  });
});
