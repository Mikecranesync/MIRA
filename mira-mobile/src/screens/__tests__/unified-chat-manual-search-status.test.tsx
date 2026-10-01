// @vitest-environment jsdom
// Codex F4 (HIGH, #4189): the searching indicator never followed acquisition
// completion — NotebookScreen (frozen) keeps a completed turn's parts
// verbatim in `liveTurns` forever, so a `manual_search_status` part baked
// with running:true at stream-close time stayed "Searching…" indefinitely.
// UnifiedChat (canonical, open) now re-checks a bounded few times via the
// existing detail-fetch seam and overlays the real outcome once it settles —
// without another question, and without a reload.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/unified-chat-manual-search-status
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

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

const { fetchManualSearchStatus } = vi.hoisted(() => ({ fetchManualSearchStatus: vi.fn() }));
vi.mock("../../api/manual-search-status", () => ({ fetchManualSearchStatus }));

import { UnifiedChat } from "../UnifiedChat";
import type { NotebookServerTurn } from "../../api/resources";

const NB = "nb-1";

const SEARCHING_TURN: NotebookServerTurn = {
  id: "t1",
  question: "is this an SMC SS5Y3-DUW01302?",
  answerStatus: "insufficient_evidence",
  answerText: null,
  evidence: [
    { kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" },
    { kind: "manual_search_status", manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true },
  ],
  basis: null,
};

function mount() {
  return render(
    <UnifiedChat
      turns={[SEARCHING_TURN]}
      liveTurns={[]}
      pending={null}
      busy={false}
      canStop={false}
      canRetry={false}
      chatError={null}
      handlers={{ onSend: () => {}, onStop: () => {}, onCitation: () => {} }}
      meta={{ notebookId: NB, threadId: "notebook-nb-1:thread-legacy", title: "CV-101", identityConfirmed: false }}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("UnifiedChat — the searching status resolves without another question or reload (#4189 F4)", () => {
  it("shows 'Searching…' immediately, then the real outcome once the bounded re-check finds it settled", async () => {
    fetchManualSearchStatus.mockReset();
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue({
      manufacturer: "SMC",
      model: "SS5Y3-DUW01302",
      running: false,
      message: "Found it — check Sources.",
    });
    mount();

    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();
    expect(fetchManualSearchStatus).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(fetchManualSearchStatus).toHaveBeenCalledWith(NB, expect.anything());
    expect(screen.getByText("Found it — check Sources.")).toBeTruthy();
    expect(screen.queryByText(/Searching SMC's documentation/)).toBeNull();
  });

  it("stops re-checking once settled — does not call again on a later tick", async () => {
    fetchManualSearchStatus.mockReset();
    vi.useFakeTimers();
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Done." });
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(fetchManualSearchStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(fetchManualSearchStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps re-checking (bounded) while still running, then stops once it settles", async () => {
    fetchManualSearchStatus.mockReset();
    vi.useFakeTimers();
    fetchManualSearchStatus
      .mockResolvedValueOnce({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true })
      .mockResolvedValueOnce({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Done." });
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(fetchManualSearchStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(fetchManualSearchStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Done.")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(fetchManualSearchStatus).toHaveBeenCalledTimes(2);
  });
});
