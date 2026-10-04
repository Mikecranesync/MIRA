// @vitest-environment jsdom
// Codex F1 (HIGH, #4175/#4189): after a successful mobile confirmation that
// enables a source, the next question must ride notebook retrieval with the
// promoted document in scope — not the stale, empty scope the host computed
// before the confirm. UnifiedChat is the canonical, unguarded adapter host
// (.claude/rules/factorylm-unified-ui-cutover.md); this fix lives here, never
// in the frozen NotebookScreen.tsx.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/unified-chat-identity-confirm
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
  getNotebookDetail: vi.fn(),
}));
vi.mock("../../api/identity-confirm", () => ({ confirmIdentityProposal }));
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, getNotebookDetail };
});

import { UnifiedChat } from "../UnifiedChat";
import type { NotebookServerTurn } from "../../api/resources";

const NB = "nb-1";

/** A turn whose assistant reply carries a persisted (unconfirmed) identity
 *  proposal — the exact evidence shape chat/route.ts persists — so the
 *  confirm card renders on mount via the existing unknown-frame passthrough. */
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
      canStop={false}
      canRetry={false}
      chatError={null}
      handlers={{ onSend, onStop: () => {}, onCitation: () => {} }}
      meta={{ notebookId: NB, threadId: "notebook-nb-1:thread-legacy", title: "CV-101", identityConfirmed: false }}
    />,
  );
}

afterEach(cleanup);

describe("UnifiedChat — identity confirmation refreshes scope before the next send (#4175/#4189 F1)", () => {
  it("re-reads notebook detail after a successful confirm and rides the promoted doc on the NEXT plain-text send", async () => {
    confirmIdentityProposal.mockResolvedValue({ manualReady: true, message: "Confirmed." });
    getNotebookDetail.mockResolvedValue({
      notebook: { id: NB, displayName: "x", manufacturer: "SMC", model: "SS5Y3-DUW01302" },
      sources: [{ docId: "doc-promoted", enabledByDefault: true, matchState: "verified" }],
      turns: [],
      threads: [],
      photos: [],
    });
    const onSend = vi.fn();
    mount(onSend);

    const confirmButton = await screen.findByRole("button", { name: "Use its manuals" });
    await act(async () => {
      fireEvent.click(confirmButton);
    });
    await screen.findByText(/Confirmed\./);
    expect(confirmIdentityProposal).toHaveBeenCalledWith(NB, { manufacturer: "SMC", model: "SS5Y3-DUW01302" });
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

  it("does not override the host's scope when the re-read fails (best-effort, confirm already succeeded)", async () => {
    confirmIdentityProposal.mockResolvedValue({ manualReady: true, message: "Confirmed." });
    getNotebookDetail.mockRejectedValue(new Error("network"));
    const onSend = vi.fn();
    mount(onSend);

    const confirmButton = await screen.findByRole("button", { name: "Use its manuals" });
    await act(async () => {
      fireEvent.click(confirmButton);
    });
    await screen.findByText(/Confirmed\./);

    const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what is the port size?" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("what is the port size?");
  });

  it("the override is one-shot: a SECOND send after the confirm does not replay the stashed scope", async () => {
    confirmIdentityProposal.mockResolvedValue({ manualReady: true, message: "Confirmed." });
    getNotebookDetail.mockResolvedValue({
      notebook: { id: NB, displayName: "x", manufacturer: "SMC", model: "SS5Y3-DUW01302" },
      sources: [{ docId: "doc-promoted", enabledByDefault: true, matchState: "verified" }],
      turns: [],
      threads: [],
      photos: [],
    });
    const onSend = vi.fn();
    mount(onSend);

    const confirmButton = await screen.findByRole("button", { name: "Use its manuals" });
    await act(async () => {
      fireEvent.click(confirmButton);
    });
    await screen.findByText(/Confirmed\./);

    const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first question" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    fireEvent.change(input, { target: { value: "second question" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend.mock.calls[0]).toEqual(["first question", undefined, ["doc-promoted"]]);
    expect(onSend.mock.calls[1]).toEqual(["second question"]);
  });
});
