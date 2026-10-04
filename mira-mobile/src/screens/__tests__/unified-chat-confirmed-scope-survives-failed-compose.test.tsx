// @vitest-environment jsdom
// Codex round 7 F22 (#4195) — `onSend` captures `confirmedScopeRef.current`
// and clears it to `null` BEFORE `attachments.compose(...)` resolves, so a
// confirm's promoted-manual scope is spent the instant a send with an
// attachment is ATTEMPTED, not when one actually reaches the parent. If that
// compose then fails (a refusal) or rejects (a thrown error), no send ever
// goes out — but the scope is already gone. A technician who confirms an
// identity, attaches a photo whose upload fails, and retries loses the
// promoted manual on the one send that should have carried it.
//
// Fix: the failure and rejection branches restore the captured scope into the
// ref — but ONLY when the ref is still empty, so a newer scope stashed by a
// confirm/refresh that landed while the failed compose was in flight is never
// clobbered by this older one.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/unified-chat-confirmed-scope-survives-failed-compose
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

type Composed = { question: string; rider?: unknown; scope?: readonly string[]; failure?: string };
const { composeMock, hasCarriedMock, hasRetainedMock, stashForHandoffMock } = vi.hoisted(() => ({
  composeMock: vi.fn(async (text: string) => ({ question: text }) as Composed),
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
  return render(
    <UnifiedChat
      turns={[PROPOSAL_TURN]}
      liveTurns={[]}
      pending={null}
      busy={false}
      canStop
      canRetry
      chatError={null}
      handlers={{ onSend, onStop: () => {}, onRetry: () => {}, onCitation: () => {} }}
      meta={{ notebookId: NB, threadId: "notebook-nb-1:thread-legacy", title: "CV-101", identityConfirmed: false }}
    />,
  );
}

async function confirmAndPromote(onSend: (text: string, evidence?: unknown, scope?: readonly string[]) => void) {
  confirmIdentityProposal.mockResolvedValue({ manualReady: true, searching: false, message: "Confirmed." });
  getNotebookDetail.mockResolvedValue({
    notebook: { id: NB, displayName: "x", manufacturer: "SMC", model: "SS5Y3-DUW01302" },
    sources: [{ docId: "doc-promoted", enabledByDefault: true, matchState: "verified" }],
    turns: [],
    threads: [],
    photos: [],
  } as never);
  mount(onSend);
  const confirmButton = await screen.findByRole("button", { name: "Use its manuals" });
  await act(async () => {
    fireEvent.click(confirmButton);
  });
  await screen.findByText(/Confirmed\./);
  expect(getNotebookDetail).toHaveBeenCalledWith(NB, expect.anything());
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

describe("UnifiedChat — a failed photo composition must not consume the promoted-manual scope (#4195 round 7 F22)", () => {
  it("compose returning a FAILURE refusal: the retry's successful send still carries the promoted scope", async () => {
    const onSend = vi.fn();
    await confirmAndPromote(onSend);

    // Attach a photo and send — the first composition REFUSES (no throw).
    hasCarriedMock.mockReturnValue(true);
    composeMock.mockResolvedValueOnce({ question: "what's wrong?", failure: "Could not upload the photo." });
    const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what's wrong?" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSend).not.toHaveBeenCalled();
    await screen.findByText(/Could not upload the photo\./);

    // Retry: the real `attachments.compose` would have put the bytes into
    // `retained`, which is what makes the host's own Retry use the composed
    // path instead of re-sending plain text.
    hasRetainedMock.mockReturnValue(true);
    composeMock.mockResolvedValueOnce({ question: "what's wrong?", rider: { visualEvidence: { fileId: "f1", capturedAt: "2026-10-01T00:00:00Z" } } });
    const retryButton = await screen.findByRole("button", { name: "Try again" });
    await act(async () => {
      fireEvent.click(retryButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    const [text, rider, scope] = onSend.mock.calls[0]!;
    expect(text).toBe("what's wrong?");
    expect(rider).toEqual({ visualEvidence: { fileId: "f1", capturedAt: "2026-10-01T00:00:00Z" } });
    expect(scope).toEqual(["doc-promoted"]);
  });

  it("compose REJECTING (thrown error): the retry's successful send still carries the promoted scope", async () => {
    const onSend = vi.fn();
    await confirmAndPromote(onSend);

    hasCarriedMock.mockReturnValue(true);
    composeMock.mockRejectedValueOnce(new Error("upload failed"));
    const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what's wrong?" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSend).not.toHaveBeenCalled();
    await screen.findByText(/upload failed/);

    hasRetainedMock.mockReturnValue(true);
    composeMock.mockResolvedValueOnce({ question: "what's wrong?", rider: { visualEvidence: { fileId: "f1", capturedAt: "2026-10-01T00:00:00Z" } } });
    const retryButton = await screen.findByRole("button", { name: "Try again" });
    await act(async () => {
      fireEvent.click(retryButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    const [, , scope] = onSend.mock.calls[0]!;
    expect(scope).toEqual(["doc-promoted"]);
  });

  it("control: a successful send still consumes the scope one-shot — the NEXT plain send has no override", async () => {
    const onSend = vi.fn();
    await confirmAndPromote(onSend);

    hasCarriedMock.mockReturnValue(true);
    composeMock.mockResolvedValueOnce({ question: "what's wrong?", rider: { visualEvidence: { fileId: "f1", capturedAt: "2026-10-01T00:00:00Z" } } });
    const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what's wrong?" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![2]).toEqual(["doc-promoted"]);

    // The NEXT send, with nothing held, must NOT replay the already-consumed scope.
    hasCarriedMock.mockReturnValue(false);
    fireEvent.change(input, { target: { value: "second question" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend.mock.calls[1]).toEqual(["second question"]);
  });
});
