// @vitest-environment jsdom
// R6: the conversation tells the unified root when the notebook's sources may
// have changed, so the drawer's "Sources (N)" can be re-read. It does so when
// it opens (the Sources panel, where uploads happen, replaces the chat while it
// is open), when a composed send with an attachment succeeds, and when a
// background manual search settles and the scope is re-read. It stays quiet on
// HOME, on a plain text send, and on a failed send.
//
// Run: cd mira-mobile && bunx vitest run tests/unified-chat-sources-signal
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
}

const nativePick = vi.hoisted(() => ({ pickPhoto: vi.fn(), capturePhoto: vi.fn(), pickDocument: vi.fn() }));
vi.mock("../src/lib/native-pick", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/native-pick")>();
  return { ...real, ...nativePick };
});
const resources = vi.hoisted(() => ({
  lookAtPhoto: vi.fn(),
  uploadSourceToNotebook: vi.fn(),
  getNotebookDetail: vi.fn(async () => ({ notebook: {}, sources: [], turns: [], threads: [], photos: [] })),
}));
vi.mock("../src/api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/resources")>();
  return { ...real, ...resources };
});
const { fetchManualSearchStatus } = vi.hoisted(() => ({ fetchManualSearchStatus: vi.fn(async () => null) }));
vi.mock("../src/api/manual-search-status", () => ({ fetchManualSearchStatus }));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn(async () => ({})) } }));

import { UnifiedChat } from "../src/screens/UnifiedChat";
import { clearAttachments } from "../src/unified/attachment-handoff";
import { _resetTransientLayersForTest } from "../src/lib/transient-layer";
import type { NotebookServerTurn } from "../src/api/resources";

const META = { notebookId: "nb-1", title: "PF525", asset: null, identityConfirmed: false };

const LOOK_OK = {
  fileId: "file-1",
  observation: { capturedAt: "2026-10-08T00:00:00Z" },
  attachment: { linkId: "link-1", notebookId: "nb-1" },
  observationPersisted: true,
};

function host() {
  return { projects: [], machines: [], onOpenItem: vi.fn(), onSourcesMayHaveChanged: vi.fn() };
}

function handlers() {
  return { onSend: vi.fn(), onStop: vi.fn(), onCitation: vi.fn() };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  _resetTransientLayersForTest();
  clearAttachments();
  vi.clearAllMocks();
});

async function sendPhoto(question: string) {
  nativePick.pickPhoto.mockResolvedValueOnce(new File(["x"], "nameplate.jpg", { type: "image/jpeg" }));
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Photo" })); });
  fireEvent.change(screen.getByRole("textbox", { name: "Ask MIRA" }), { target: { value: question } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
}

describe("UnifiedChat tells the root when sources may have changed", () => {
  it("signals once when a notebook's conversation opens", () => {
    const h = host();
    render(<UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={handlers()} host={h} meta={META} />);
    expect(h.onSourcesMayHaveChanged).toHaveBeenCalledTimes(1);
  });

  it("stays quiet on HOME, where there is no notebook yet", () => {
    const h = host();
    render(
      <UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null}
        handlers={handlers()} host={h} attachmentNotebookId={null}
        meta={{ notebookId: "home", threadId: "home", projectId: "project-home", title: "FactoryLM", asset: null, identityConfirmed: false }} />,
    );
    expect(h.onSourcesMayHaveChanged).not.toHaveBeenCalled();
  });

  it("signals after a send with an attachment succeeds, and not after a plain text send", async () => {
    resources.lookAtPhoto.mockResolvedValue(LOOK_OK);
    const h = host();
    const send = handlers();
    render(<UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={send} host={h} meta={META} />);
    h.onSourcesMayHaveChanged.mockClear();

    fireEvent.change(screen.getByRole("textbox", { name: "Ask MIRA" }), { target: { value: "What does F004 mean" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    expect(send.onSend).toHaveBeenCalledTimes(1);
    expect(h.onSourcesMayHaveChanged).not.toHaveBeenCalled();

    await sendPhoto("what is this");
    await waitFor(() => expect(send.onSend).toHaveBeenCalledTimes(2));
    expect(h.onSourcesMayHaveChanged).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when a send with an attachment fails", async () => {
    resources.lookAtPhoto.mockRejectedValueOnce(new Error("Network request failed"));
    const h = host();
    render(<UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={handlers()} host={h} meta={META} />);
    h.onSourcesMayHaveChanged.mockClear();

    await sendPhoto("what is this");
    await waitFor(() => expect(screen.getByRole("alert", { name: "Send error" })).toBeTruthy());

    expect(h.onSourcesMayHaveChanged).not.toHaveBeenCalled();
  });

  // The new-project case on the Pixel: the manual is acquired in the
  // background, and the search settling is what makes it a source.
  it("signals when a background manual search settles and the scope is re-read", async () => {
    vi.useFakeTimers();
    const turn: NotebookServerTurn = {
      id: "t1",
      question: "is this a PowerFlex 525?",
      answerStatus: "insufficient_evidence",
      answerText: null,
      evidence: [{ kind: "identity_proposal", manufacturer: "Allen-Bradley", model: "PowerFlex 525" }],
      basis: null,
    };
    fetchManualSearchStatus
      .mockResolvedValueOnce({ manufacturer: "Allen-Bradley", model: "PowerFlex 525", running: true, startedAt: "gen-1" } as never)
      .mockResolvedValue({ manufacturer: "Allen-Bradley", model: "PowerFlex 525", running: false, message: "Found it — check Sources.", startedAt: "gen-1" } as never);
    const h = host();
    render(<UnifiedChat turns={[turn]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={handlers()} host={h} meta={META} />);
    await act(async () => { await Promise.resolve(); });
    h.onSourcesMayHaveChanged.mockClear();

    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText("Found it — check Sources.")).toBeTruthy();
    await act(async () => { await Promise.resolve(); });

    expect(resources.getNotebookDetail).toHaveBeenCalled();
    expect(h.onSourcesMayHaveChanged).toHaveBeenCalledTimes(1);
  });
});
