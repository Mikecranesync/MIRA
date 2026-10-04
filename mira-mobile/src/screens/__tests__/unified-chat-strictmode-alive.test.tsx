// @vitest-environment jsdom
// Codex round 7 F20 (#4195) — `aliveRef` inside `UnifiedChatForNotebook` is
// initialized `true` exactly once, at first render, and only the mount
// effect's CLEANUP ever wrote `false`. React 18 StrictMode
// (`mira-mobile/src/main.tsx` wraps the whole app in it) runs effect setup,
// that cleanup, then setup AGAIN on every mount — so under StrictMode the
// sequence was: init(true) -> setup(no-op) -> cleanup(false) -> setup
// (nothing restores it). The component renders normally (StrictMode's replay
// is invisible in the DOM), but every async continuation gated on
// `aliveRef.current` — a compose that resolves, a confirm's scope refresh —
// is silently dropped from the very first render onward, in every dev build.
//
// Fix: the mount effect's SETUP also writes `true`, so the second StrictMode
// pass restores exactly what its own matching cleanup just cleared, while a
// real unmount still ends on that cleanup's `false` with no later setup to
// undo it.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/unified-chat-strictmode-alive
import React from "react";
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
  fetchManualSearchStatus: vi.fn(async () => null as unknown),
}));
vi.mock("../../api/identity-confirm", () => ({ confirmIdentityProposal }));
vi.mock("../../api/manual-search-status", () => ({ fetchManualSearchStatus }));
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, getNotebookDetail };
});

// A controllable, deferred `useUnifiedAttachments().compose` — forces
// `onSend` down the ASYNC compose path (the one with a real `await` between
// capturing state and calling `handlers.onSend`), exactly like the attach
// flow F20 is about.
const { composeMock, hasCarriedMock, hasRetainedMock, stashForHandoffMock } = vi.hoisted(() => ({
  composeMock: vi.fn(async (text: string) => ({ question: text }) as { question: string; rider?: unknown; scope?: readonly string[]; failure?: string }),
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

import { UnifiedChat } from "../UnifiedChat";
import type { NotebookServerTurn } from "../../api/resources";

const NB = "nb-1";

const PROPOSAL_TURN: NotebookServerTurn = {
  id: "t1",
  question: "is this an SMC SS5Y3-DUW01302?",
  answerStatus: "insufficient_evidence",
  answerText: null,
  evidence: [{ kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" }],
  basis: null,
};

function mount(onSend: (text: string, evidence?: unknown, scope?: readonly string[]) => void) {
  // The StrictMode wrapper is the whole point of this file: `main.tsx`
  // renders the real app inside it, so a component that only works OUTSIDE
  // StrictMode is not actually proven to work in the dev build technicians
  // (and anyone reproducing a bug report) run against.
  return render(
    <React.StrictMode>
      <UnifiedChat
        turns={[PROPOSAL_TURN]}
        liveTurns={[]}
        pending={null}
        busy={false}
        canStop={false}
        canRetry={false}
        chatError={null}
        handlers={{ onSend, onStop: () => {}, onCitation: () => {} }}
        meta={{ notebookId: NB, threadId: "notebook-nb-1:thread-legacy", title: "CV-101", identityConfirmed: false }}
      />
    </React.StrictMode>,
  );
}

afterEach(() => {
  cleanup();
  confirmIdentityProposal.mockReset();
  getNotebookDetail.mockReset();
  getNotebookDetail.mockResolvedValue({ notebook: {}, sources: [], turns: [], threads: [], photos: [] });
  fetchManualSearchStatus.mockReset();
  fetchManualSearchStatus.mockResolvedValue(null);
  composeMock.mockReset();
  composeMock.mockImplementation(async (text: string) => ({ question: text }));
  hasCarriedMock.mockReset();
  hasCarriedMock.mockReturnValue(false);
  hasRetainedMock.mockReset();
  hasRetainedMock.mockReturnValue(false);
  stashForHandoffMock.mockReset();
});

describe("UnifiedChat under React.StrictMode — aliveRef must survive the setup/cleanup/setup replay (#4195 round 7 F20)", () => {
  it("a send whose attachment composition resolves still reaches handlers.onSend", async () => {
    const onSend = vi.fn();
    mount(onSend);

    // Force the async compose path (the one gated on `aliveRef.current`).
    hasCarriedMock.mockReturnValue(true);
    composeMock.mockResolvedValue({ question: "what am I looking at?", rider: { visualEvidence: { fileId: "f1", capturedAt: "2026-10-01T00:00:00Z" } } });

    const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what am I looking at?" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      // Let the composed promise's microtask settle inside this act().
      await Promise.resolve();
      await Promise.resolve();
    });

    // Under the F20 defect, `aliveRef.current` is `false` from the component's
    // very first render under StrictMode, so this compose's continuation is
    // silently dropped and `onSend` is never called.
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      "what am I looking at?",
      { visualEvidence: { fileId: "f1", capturedAt: "2026-10-01T00:00:00Z" } },
    );
  });

  it("a confirmed identity's scope refresh still lands, and the NEXT plain send rides it", async () => {
    confirmIdentityProposal.mockResolvedValue({ manualReady: true, message: "Confirmed." });
    getNotebookDetail.mockResolvedValue({
      notebook: { id: NB, displayName: "x", manufacturer: "SMC", model: "SS5Y3-DUW01302" },
      sources: [{ docId: "doc-promoted", enabledByDefault: true, matchState: "verified" }],
      turns: [],
      threads: [],
      photos: [],
    } as never);
    const onSend = vi.fn();
    mount(onSend);

    const confirmButton = await screen.findByRole("button", { name: "Use its manuals" });
    await act(async () => {
      fireEvent.click(confirmButton);
    });
    // Under the F20 defect, `refreshPromotedScope`'s `if (!aliveRef.current) return;`
    // guard at the top fires immediately (the instance looks dead from birth),
    // so `getNotebookDetail` is never even called and "Confirmed." still shows
    // (confirming itself does not depend on `aliveRef`).
    await screen.findByText(/Confirmed\./);
    expect(getNotebookDetail).toHaveBeenCalledWith(NB, expect.anything());

    const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what is the port size?" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    const [text, , scope] = onSend.mock.calls[0]!;
    expect(text).toBe("what is the port size?");
    expect(scope).toEqual(["doc-promoted"]);
  });
});
