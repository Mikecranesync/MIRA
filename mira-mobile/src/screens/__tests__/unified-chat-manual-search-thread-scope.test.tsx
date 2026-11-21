// @vitest-environment jsdom
// #5750 Codex F1: a thread that turns to a DIFFERENT model must lose the
// project's ready line and link. The notebook GET hides the project status
// for such a thread and says so ("hidden"), which the mounted chat must tell
// apart from a failed read (null) — a failed read keeps the last status.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/unified-chat-manual-search-thread-scope
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
if (!("scrollIntoView" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => {}, writable: true });
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

const { fetchManualSearchStatus, getNotebookDetail } = vi.hoisted(() => ({
  fetchManualSearchStatus: vi.fn(),
  getNotebookDetail: vi.fn(async () => ({ notebook: {}, sources: [], turns: [], threads: [], photos: [] })),
}));
vi.mock("../../api/manual-search-status", () => ({ fetchManualSearchStatus }));
vi.mock("../../api/identity-confirm", () => ({ confirmIdentityProposal: vi.fn() }));
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, getNotebookDetail };
});

import { UnifiedChat, type UnifiedChatProps } from "../UnifiedChat";
import type { ChatTurn } from "../../lib/sse";
import type { NotebookServerTurn } from "../../api/resources";

const NB = "nb-1";
const READY_MESSAGE = "The AutomationDirect GS11N-20P2 manual is ready to answer from.";
const READY = {
  manufacturer: "AutomationDirect",
  model: "GS11N-20P2",
  running: false,
  message: READY_MESSAGE,
  manualUrl: "https://app.example.test/hub/v3/source/?file=6c1f0b2e-1111-2222-3333-444455556666&page=26",
  startedAt: "gen-1",
};
const LOOKALIKE_Q = "Find me the manual for AutomationDirect GS11N-20P25";
const LOOKALIKE_A: ChatTurn = {
  answer: "GS11N-20P25 is not listed in the GS10 manual this project holds.",
  citations: [],
  status: "answered",
};

function props(over: Partial<UnifiedChatProps> = {}): UnifiedChatProps {
  return {
    turns: [],
    liveTurns: [],
    pending: null,
    busy: false,
    canStop: false,
    canRetry: false,
    chatError: null,
    handlers: { onSend: vi.fn(), onStop: () => {}, onCitation: () => {} },
    meta: { notebookId: NB, threadId: "notebook-nb-1:thread-new", title: "CV-101", identityConfirmed: true },
    ...over,
  };
}

function readyShown(): boolean {
  return screen.queryByText(READY_MESSAGE) !== null || screen.queryByText(/Open website to find the manual/) !== null;
}

/** Whether the ready line or its link sits in the same turn as `question`. */
function lineUnder(question: string): boolean {
  const turnOf = (el: Element | null) => el?.closest(".fl-turn") ?? null;
  const asked = turnOf(screen.queryAllByText(question).at(-1) ?? null);
  if (!asked) return false;
  // The answer to a question is the turn that follows it.
  const answer = asked.nextElementSibling;
  return !!answer && (answer.textContent ?? "").includes(READY_MESSAGE);
}

/** Whether any manual status line (ready or still searching) sits in the
 *  answer to `question`. */
function statusUnder(question: string): boolean {
  const asked = screen.queryAllByText(question).at(-1)?.closest(".fl-turn") ?? null;
  const answer = asked?.nextElementSibling ?? null;
  return !!answer?.querySelector('[data-part-type="manual_search_status"]');
}

/** An earlier exact-model turn already answered in this thread, so the
 *  hydrated project status has an answer to attach to. */
const EXACT = { q: "Find me the manual for AutomationDirect GS11N-20P2", a: { answer: "Here it is.", citations: [], status: "answered" } as ChatTurn };

async function hydrateThenAskLookalike(readAfterSend: unknown) {
  fetchManualSearchStatus.mockResolvedValue(READY);
  const view = render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText(READY_MESSAGE)).toBeTruthy(); // precondition: hydration showed the ready line.

  if (readAfterSend instanceof Error) fetchManualSearchStatus.mockRejectedValue(readAfterSend);
  else fetchManualSearchStatus.mockResolvedValue(readAfterSend);
  const callsBeforeSend = fetchManualSearchStatus.mock.calls.length;
  view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT], pending: { q: LOOKALIKE_Q, a: { answer: "", citations: [], status: "" } }, busy: true })} />);
  await act(async () => { await Promise.resolve(); });
  // While the look-alike answer streams, the project line stays where it was.
  expect(lineUnder(LOOKALIKE_Q)).toBe(false);
  expect(lineUnder(EXACT.q)).toBe(true);
  view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT, { q: LOOKALIKE_Q, a: LOOKALIKE_A }] })} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByText(LOOKALIKE_A.answer)).toBeTruthy();
  return { callsBeforeSend };
}

afterEach(() => {
  cleanup();
  fetchManualSearchStatus.mockReset();
});

describe("UnifiedChat — a look-alike request drops the project's ready line (#5750 F1)", () => {
  it("re-reads the status once the answer lands, and a hidden result clears the line and link", async () => {
    const { callsBeforeSend } = await hydrateThenAskLookalike("hidden");
    expect(fetchManualSearchStatus.mock.calls.length).toBeGreaterThan(callsBeforeSend);
    expect(readyShown()).toBe(false);
  });

  // #5750 r2 F1: an inconclusive re-read must not move the cached line onto
  // the look-alike answer. It stays under the answer it was read with.
  it("a failed re-read keeps the line under the earlier answer, never under the look-alike one", async () => {
    await hydrateThenAskLookalike(null);
    expect(lineUnder(EXACT.q)).toBe(true);
    expect(lineUnder(LOOKALIKE_Q)).toBe(false);
  });

  it("a transport error keeps the line under the earlier answer, never under the look-alike one", async () => {
    await hydrateThenAskLookalike(new Error("offline"));
    expect(lineUnder(EXACT.q)).toBe(true);
    expect(lineUnder(LOOKALIKE_Q)).toBe(false);
  });

  it("control: a re-read that still reports the status moves it under the new answer", async () => {
    await hydrateThenAskLookalike(READY);
    expect(lineUnder(LOOKALIKE_Q)).toBe(true);
    expect(lineUnder(EXACT.q)).toBe(false);
  });

  it("control: before any send, hydration shows the line under the latest answer", async () => {
    fetchManualSearchStatus.mockResolvedValue(READY);
    render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
    await act(async () => { await Promise.resolve(); });
    expect(lineUnder(EXACT.q)).toBe(true);
  });

  // #5750 r2: a status read that starts while an answer is still streaming
  // was checked against the thread WITHOUT that answer, so it stays where it
  // was — the poll of a running search must not move it onto the new answer.
  it("a read started while an answer streams keeps the status under the earlier answer", async () => {
    vi.useFakeTimers();
    try {
      const RUNNING = { ...READY, running: true, message: undefined, manualUrl: undefined };
      fetchManualSearchStatus.mockResolvedValue(RUNNING);
      const view = render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(statusUnder(EXACT.q)).toBe(true); // precondition: hydration shows the running search.
      const callsBefore = fetchManualSearchStatus.mock.calls.length;
      view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT], pending: { q: LOOKALIKE_Q, a: { answer: "", citations: [], status: "" } }, busy: true })} />);
      await act(async () => { await Promise.resolve(); });
      await act(async () => { vi.advanceTimersByTime(4100); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(fetchManualSearchStatus.mock.calls.length).toBeGreaterThan(callsBefore); // precondition: the poll ran mid-stream.
      expect(statusUnder(LOOKALIKE_Q)).toBe(false);
      expect(statusUnder(EXACT.q)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // #5750 r3: the saved window slides when a reload moves live answers into
  // the newest 50 rows. The line stays on the answer it was read with, by
  // that answer's request id, not by its position.
  const row = (id: string, question: string, answerText: string, clientRequestId?: string) =>
    ({ id, question, answerStatus: "answered", answerText, evidence: [], ...(clientRequestId ? { clientRequestId } : {}) }) as unknown as NotebookServerTurn;
  const R1 = row("r1", "What is the input voltage of the GS11N-20P2?", "230 V single phase.");
  const R2 = row("r2", EXACT.q, "Here it is.");
  const SAME_Q = "What is the rated current of the GS11N-20P2?";
  const SAME_A: ChatTurn = { answer: "1.6 A.", citations: [], status: "answered" };
  const PENDING = (q: string) => ({ q, a: { answer: "", citations: [], status: "" } as ChatTurn });
  const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

  it("after the saved window slides, a streaming look-alike answer never gets the line", async () => {
    fetchManualSearchStatus.mockResolvedValue(READY);
    const view = render(<UnifiedChat {...props({ turns: [R1, R2] })} />);
    await settle();
    expect(lineUnder(EXACT.q)).toBe(true); // precondition: hydration placed it under the newest saved answer.
    view.rerender(<UnifiedChat {...props({ turns: [R1, R2], pending: PENDING(SAME_Q), busy: true })} />);
    await settle();
    view.rerender(<UnifiedChat {...props({ turns: [R1, R2], liveTurns: [{ q: SAME_Q, a: SAME_A, requestId: "req-3" }] })} />);
    await settle();
    expect(lineUnder(SAME_Q)).toBe(true); // precondition: the re-read placed it under the new answer.
    // Reload: the answer is saved and the window drops the oldest row.
    const saved = [R2, row("r3", SAME_Q, SAME_A.answer, "req-3")];
    view.rerender(<UnifiedChat {...props({ turns: saved })} />);
    await settle();
    expect(lineUnder(SAME_Q)).toBe(true);
    fetchManualSearchStatus.mockImplementation(() => new Promise(() => {}));
    view.rerender(<UnifiedChat {...props({ turns: saved, pending: PENDING(LOOKALIKE_Q), busy: true })} />);
    await settle();
    expect(lineUnder(LOOKALIKE_Q)).toBe(false);
    expect(lineUnder(SAME_Q)).toBe(true);
  });

  it("after a failed re-read and a window slide, the line stays on the earlier answer", async () => {
    fetchManualSearchStatus.mockResolvedValue(READY);
    const view = render(<UnifiedChat {...props({ turns: [R1, R2] })} />);
    await settle();
    expect(lineUnder(EXACT.q)).toBe(true); // precondition.
    fetchManualSearchStatus.mockResolvedValue(null);
    view.rerender(<UnifiedChat {...props({ turns: [R1, R2], pending: PENDING(LOOKALIKE_Q), busy: true })} />);
    await settle();
    view.rerender(<UnifiedChat {...props({ turns: [R1, R2], liveTurns: [{ q: LOOKALIKE_Q, a: LOOKALIKE_A, requestId: "req-la" }] })} />);
    await settle();
    expect(lineUnder(EXACT.q)).toBe(true); // precondition: the failed read left it in place.
    view.rerender(<UnifiedChat {...props({ turns: [R2, row("rla", LOOKALIKE_Q, LOOKALIKE_A.answer, "req-la")] })} />);
    await settle();
    expect(lineUnder(LOOKALIKE_Q)).toBe(false);
    expect(lineUnder(EXACT.q)).toBe(true);
  });

  // #5750 r3: a read on a thread with no answer yet has nothing to sit under,
  // so the first question's streaming answer never inherits it.
  it("a status read on an empty thread never lands on the first streaming answer", async () => {
    fetchManualSearchStatus.mockResolvedValue(READY);
    const view = render(<UnifiedChat {...props()} />);
    await settle();
    expect(fetchManualSearchStatus).toHaveBeenCalled(); // precondition: the mount read ran.
    fetchManualSearchStatus.mockImplementation(() => new Promise(() => {}));
    view.rerender(<UnifiedChat {...props({ pending: PENDING(LOOKALIKE_Q), busy: true })} />);
    await settle();
    expect(lineUnder(LOOKALIKE_Q)).toBe(false);
  });

  // #5750 r3: a stopped answer is saved after its stream closes, so the read
  // that starts when it stops may not include the look-alike question.
  it("a read after a stopped look-alike answer keeps the line on the earlier answer", async () => {
    fetchManualSearchStatus.mockResolvedValue(READY);
    const view = render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
    await settle();
    expect(lineUnder(EXACT.q)).toBe(true); // precondition.
    const callsBefore = fetchManualSearchStatus.mock.calls.length;
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT], pending: PENDING(LOOKALIKE_Q), busy: true })} />);
    await settle();
    const stopped: ChatTurn = { answer: "GS11N-20P25 is", citations: [], status: "stopped" };
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT, { q: LOOKALIKE_Q, a: stopped, requestId: "req-stop" }] })} />);
    await settle();
    expect(fetchManualSearchStatus.mock.calls.length).toBeGreaterThan(callsBefore); // precondition: it re-read.
    expect(lineUnder(LOOKALIKE_Q)).toBe(false);
    expect(lineUnder(EXACT.q)).toBe(true);
  });

  it("control: a read after a finished answer places the line under that answer", async () => {
    fetchManualSearchStatus.mockResolvedValue(READY);
    const view = render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
    await settle();
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT], pending: PENDING(SAME_Q), busy: true })} />);
    await settle();
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT, { q: SAME_Q, a: SAME_A, requestId: "req-done" }] })} />);
    await settle();
    expect(lineUnder(SAME_Q)).toBe(true);
  });

  // #5750 r2 F8: the re-read for an earlier send settles after a newer send.
  // Its result was checked against the earlier answer, so it stays there.
  it("an older send's re-read never places the line under a newer answer", async () => {
    const SAME_Q = "What is the rated current of the GS11N-20P2?";
    const SAME_A: ChatTurn = { answer: "1.6 A.", citations: [], status: "answered" };
    fetchManualSearchStatus.mockResolvedValue(READY);
    const view = render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
    await act(async () => { await Promise.resolve(); });

    const reads: Array<(v: unknown) => void> = [];
    fetchManualSearchStatus.mockImplementation(() => new Promise((resolve) => { reads.push(resolve); }));
    const send = async (live: { q: string; a: ChatTurn }[], pendingQ: string) => {
      view.rerender(<UnifiedChat {...props({ liveTurns: live, pending: { q: pendingQ, a: { answer: "", citations: [], status: "" } }, busy: true })} />);
      await act(async () => { await Promise.resolve(); });
    };
    await send([EXACT], SAME_Q);
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT, { q: SAME_Q, a: SAME_A }] })} />);
    await act(async () => { await Promise.resolve(); });
    await send([EXACT, { q: SAME_Q, a: SAME_A }], LOOKALIKE_Q);
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT, { q: SAME_Q, a: SAME_A }, { q: LOOKALIKE_Q, a: LOOKALIKE_A }] })} />);
    await act(async () => { await Promise.resolve(); });
    expect(reads).toHaveLength(2); // precondition: one re-read per finished answer, both still open.

    await act(async () => { reads[0]!(READY); await Promise.resolve(); await Promise.resolve(); });
    expect(lineUnder(LOOKALIKE_Q)).toBe(false);
    expect(lineUnder(SAME_Q)).toBe(true);

    await act(async () => { reads[1]!("hidden"); await Promise.resolve(); await Promise.resolve(); });
    expect(readyShown()).toBe(false);
  });
});
