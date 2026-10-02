// @vitest-environment jsdom
// Codex round 3 F4: the round-2 integration test for "a confirmation that
// starts a search is followed" mocked `confirmIdentityProposal` itself,
// which bypassed its decoder entirely and could never catch F4 (the decoder
// silently dropping the server's `searching`/`startedAt` fields). This file
// mocks ONLY the shared transport (`request()` in `../../api/client`) —
// the SAME seam `src/api/__tests__/identity-confirm.test.ts` and
// `manual-search-status.test.ts` already mock at — and lets the REAL
// `confirmIdentityProposal` and `fetchManualSearchStatus` wrappers run.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/unified-chat-manual-search-real-transport
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

const { request, getNotebookDetail } = vi.hoisted(() => ({
  request: vi.fn(),
  // F1's unrelated scope-refresh seam — mocked directly (as every sibling
  // test in this directory does) so it never needs a real network call;
  // it is not the wrapper this file is proving.
  getNotebookDetail: vi.fn(async () => ({ notebook: {}, sources: [], turns: [], threads: [], photos: [] })),
}));
vi.mock("../../api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/client")>();
  return { ...real, request };
});
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, getNotebookDetail };
});

import { UnifiedChat } from "../UnifiedChat";
import type { NotebookServerTurn } from "../../api/resources";

const NB = "nb-1";

const PROPOSAL_ONLY_TURN: NotebookServerTurn = {
  id: "t1",
  question: "is this an SMC SS5Y3-DUW01302?",
  answerStatus: "insufficient_evidence",
  answerText: null,
  evidence: [{ kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" }],
  basis: null,
};

function mount(onSend: (...a: unknown[]) => void = vi.fn()) {
  return render(
    <UnifiedChat
      turns={[PROPOSAL_ONLY_TURN]}
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
  request.mockReset();
  getNotebookDetail.mockClear();
});

describe("UnifiedChat + REAL confirmIdentityProposal/fetchManualSearchStatus wrappers (Codex round 3 F4)", () => {
  it("decodes the server's real JSON through the real wrappers: hydration null -> confirm starts a search -> the next GET resolves it", async () => {
    vi.useFakeTimers();

    // Hydration GET (fetchManualSearchStatus) — real server shape, no search running.
    request.mockImplementationOnce(async () => ({ status: 200, data: { manualSearch: null }, text: "" }));
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(/Searching/)).toBeNull();

    // Confirm POST (confirmIdentityProposal) — real server JSON shape,
    // exactly what the Hub's identity/confirm route emits: `searching: true`,
    // no `startedAt` (the optimistic, generation-less case this decoder must
    // still carry through correctly).
    request.mockImplementationOnce(async () => ({
      status: 200,
      data: { ok: true, manualReady: false, searching: true, message: "Confirmed. I'll look for its manual." },
      text: "",
    }));
    // Codex round 4 F6: the confirm handler now ALSO fetches the
    // authoritative status right away (regardless of `searching`) — the
    // search row isn't visible on this immediate re-read yet, so the
    // optimistic seed below is still the one that takes effect.
    request.mockImplementationOnce(async () => ({ status: 200, data: { manualSearch: null }, text: "" }));
    const confirmButton = screen.getByRole("button", { name: "Use its manuals" });
    await act(async () => {
      fireEvent.click(confirmButton);
      await Promise.resolve();
    });
    // The real decoder carried `searching: true` through — the optimistic
    // follow starts immediately, before any GET confirms it.
    expect(screen.getByText(/Searching SMC's documentation for SS5Y3-DUW01302…/)).toBeTruthy();
    expect(request).toHaveBeenCalledWith(
      "/api/equipment-notebooks/nb-1/identity/confirm/",
      expect.objectContaining({ method: "POST" }),
    );

    // The tick effect's next GET (fetchManualSearchStatus again) — real
    // server JSON, now settled.
    request.mockImplementation(async () => ({
      status: 200,
      data: { manualSearch: { manufacturer: "SMC", model: "SS5Y3-DUW01302", running: false, message: "Found it.", startedAt: "gen-1" } },
      text: "",
    }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByText("Found it.")).toBeTruthy();
    expect(screen.queryByText(/Searching SMC's documentation/)).toBeNull();
  });
});
