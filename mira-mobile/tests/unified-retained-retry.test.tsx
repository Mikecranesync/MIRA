// @vitest-environment jsdom
// R7 on the retained-bytes path: a failed photo send keeps its bytes, and its
// Try again composes them again (#3863). That retry is the send, so it empties
// the composer too; a compose that fails again puts the question back.
// Run: cd mira-mobile && npx vitest run tests/unified-retained-retry
import { afterEach, describe, expect, it, vi } from "vitest";

type Composed = { question: string; rider?: unknown; scope?: readonly string[]; failure?: string };
const { composeMock } = vi.hoisted(() => ({
  composeMock: vi.fn(async (text: string): Promise<Composed> => ({ question: text, rider: { visualEvidence: [] } })),
}));
vi.mock("../src/unified/attachments", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/unified/attachments")>();
  return {
    ...real,
    useUnifiedAttachments: () => ({
      attachPhoto: vi.fn(),
      attachCamera: vi.fn(),
      attachFile: vi.fn(),
      compose: composeMock,
      stashForHandoff: vi.fn(),
      hasCarried: () => false,
      hasRetained: () => true,
    }),
  };
});
vi.mock("../src/api/notebook-sources", () => ({ fetchNotebookSources: vi.fn(async () => null) }));
vi.mock("../src/api/manual-search-status", () => ({ fetchManualSearchStatus: vi.fn(async () => null) }));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn(async () => ({})) } }));

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UnifiedChat } from "../src/screens/UnifiedChat";
import type { NotebookServerTurn } from "../src/api/resources";
import { _resetTransientLayersForTest } from "../src/lib/transient-layer";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
}

const TURN: NotebookServerTurn = {
  id: "row-1",
  question: "What does this nameplate say?",
  answerStatus: "answered",
  answerText: "It reads 480 V.",
  evidence: [],
  basis: "general_reasoning",
};

afterEach(() => {
  cleanup();
  _resetTransientLayersForTest();
  vi.clearAllMocks();
});

function mount(onSend = vi.fn()) {
  render(
    <UnifiedChat
      turns={[TURN]}
      liveTurns={[]}
      pending={null}
      busy={false}
      canStop={false}
      canRetry
      chatError="The photo didn't upload — try again."
      failedQuestion="Why F004?"
      handlers={{ onSend, onStop: () => {}, onRetry: vi.fn(), onCitation: () => {} }}
      meta={{ notebookId: "nb-1", title: "PF525 acceptance", identityConfirmed: false }}
    />,
  );
  return onSend;
}

function composer(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
}

describe("R7 — Try again with retained photo bytes", () => {
  it("sends the composed question and empties the composer", async () => {
    const onSend = mount();
    await waitFor(() => expect(composer().value).toBe("Why F004?"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Why F004?", { visualEvidence: [] }));
    expect(composeMock).toHaveBeenCalledWith("Why F004?", [], { retry: true });
    expect(composer().value).toBe("");
    expect(screen.queryByRole("alert", { name: "Send error" })).toBeNull();
  });

  it("puts the question back when the photo fails to upload again", async () => {
    composeMock.mockResolvedValueOnce({ question: "Why F004?", failure: "The photo didn't upload — try again." });
    const onSend = mount();
    await waitFor(() => expect(composer().value).toBe("Why F004?"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onSend).not.toHaveBeenCalled();
    expect(composer().value).toBe("Why F004?");
    expect(screen.getByRole("alert", { name: "Send error" })).toBeTruthy();
  });
});
