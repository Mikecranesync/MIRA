// @vitest-environment jsdom
// #5750 Codex F1: a thread that turns to a DIFFERENT model must lose the
// project's ready line and link. The notebook GET hides the project status
// for such a thread and says so ("hidden"), which the mounted chat must tell
// apart from a failed read (null) — a failed read keeps the last status.
//
// #5750 r3 F10/F12: a status read names the saved answer the server checked it
// against (`answer`, from `manualSearchAnswer`). The chat shows the status under
// that answer only, never under its own newest one.
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

/** An earlier exact-model answer in this thread, saved by request id. */
const EXACT = { q: "Find me the manual for AutomationDirect GS11N-20P2", a: { answer: "Here it is.", citations: [], status: "answered" } as ChatTurn, requestId: "req-1" };
const ON_EXACT = { ...READY, answer: "req-1" };
const PENDING = (q: string) => ({ q, a: { answer: "", citations: [], status: "" } as ChatTurn });
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const LOOKALIKE = { q: LOOKALIKE_Q, a: LOOKALIKE_A, requestId: "req-2" };
const SAME_Q = "What is the rated current of the GS11N-20P2?";
const SAME = { q: SAME_Q, a: { answer: "1.6 A.", citations: [], status: "answered" } as ChatTurn, requestId: "req-3" };
const row = (id: string, question: string, answerText: string, clientRequestId?: string) =>
  ({ id, question, answerStatus: "answered", answerText, evidence: [], ...(clientRequestId ? { clientRequestId } : {}) }) as unknown as NotebookServerTurn;

function answerOf(question: string): Element | null {
  return screen.queryAllByText(question).at(-1)?.closest(".fl-turn")?.nextElementSibling ?? null;
}
/** Whether the GS11N-20P2 manual link is anywhere in the answer to `question`. */
function linkUnder(question: string): boolean {
  const answer = answerOf(question);
  return !!answer && [...answer.querySelectorAll("a")].some((a) => (a.getAttribute("href") ?? "").includes("6c1f0b2e"));
}

async function hydrateThenAskLookalike(readAfterSend: unknown) {
  fetchManualSearchStatus.mockResolvedValue(ON_EXACT);
  const view = render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
  await settle();
  expect(lineUnder(EXACT.q)).toBe(true); // precondition: hydration placed it under the answer the server named.

  if (readAfterSend instanceof Error) fetchManualSearchStatus.mockRejectedValue(readAfterSend);
  else fetchManualSearchStatus.mockResolvedValue(readAfterSend);
  const callsBeforeSend = fetchManualSearchStatus.mock.calls.length;
  view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT], pending: PENDING(LOOKALIKE_Q), busy: true })} />);
  await settle();
  expect(lineUnder(LOOKALIKE_Q)).toBe(false);
  view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT, LOOKALIKE] })} />);
  await settle();
  expect(screen.getByText(LOOKALIKE_A.answer)).toBeTruthy();
  expect(fetchManualSearchStatus.mock.calls.length).toBeGreaterThan(callsBeforeSend); // precondition: it re-read.
  return view;
}

afterEach(() => {
  cleanup();
  fetchManualSearchStatus.mockReset();
});

describe("UnifiedChat — the status sits under the answer the server checked (#5750)", () => {
  it("a hidden re-read clears the line and link", async () => {
    await hydrateThenAskLookalike("hidden");
    expect(readyShown()).toBe(false);
  });

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

  it("control: a re-read that names the new answer moves the line under it", async () => {
    await hydrateThenAskLookalike({ ...READY, answer: "req-2" });
    expect(lineUnder(LOOKALIKE_Q)).toBe(true);
    expect(lineUnder(EXACT.q)).toBe(false);
  });

  it("a re-read that names the earlier answer keeps the line there", async () => {
    await hydrateThenAskLookalike(ON_EXACT);
    expect(lineUnder(EXACT.q)).toBe(true);
    expect(lineUnder(LOOKALIKE_Q)).toBe(false);
  });

  // No answer named (an older server, or a whole-notebook read): no fallback
  // to the newest answer.
  it("a read that names no answer places the line nowhere", async () => {
    fetchManualSearchStatus.mockResolvedValue(READY);
    render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
    await settle();
    expect(fetchManualSearchStatus).toHaveBeenCalled(); // precondition: the mount read ran.
    expect(readyShown()).toBe(false);
  });

  it("a read on a thread with no answer yet never lands on the first streaming answer", async () => {
    fetchManualSearchStatus.mockResolvedValue({ ...READY, answer: null });
    const view = render(<UnifiedChat {...props()} />);
    await settle();
    expect(fetchManualSearchStatus).toHaveBeenCalled(); // precondition.
    fetchManualSearchStatus.mockImplementation(() => new Promise(() => {}));
    view.rerender(<UnifiedChat {...props({ pending: PENDING(LOOKALIKE_Q), busy: true })} />);
    await settle();
    expect(readyShown()).toBe(false);
  });

  // Codex r3 F12: the server checked a newer answer saved by another device.
  it("a status checked against another device's newer answer never lands under this phone's answer, and appears under that answer once synced", async () => {
    const R1 = row("r1", EXACT.q, EXACT.a.answer, "req-1");
    fetchManualSearchStatus.mockResolvedValue(ON_EXACT);
    const view = render(<UnifiedChat {...props({ turns: [R1] })} />);
    await settle();
    expect(lineUnder(EXACT.q)).toBe(true); // precondition.
    const BACK_Q = "OK, back to my drive. Find me the manual.";
    fetchManualSearchStatus.mockResolvedValue({ ...READY, answer: "req-web" });
    view.rerender(<UnifiedChat {...props({ turns: [R1], pending: PENDING(LOOKALIKE_Q), busy: true })} />);
    await settle();
    view.rerender(<UnifiedChat {...props({ turns: [R1], liveTurns: [LOOKALIKE] })} />);
    await settle();
    expect(lineUnder(LOOKALIKE_Q)).toBe(false);
    expect(lineUnder(EXACT.q)).toBe(false);
    // The reload brings in the answer the server checked.
    const synced = [R1, row("r-la", LOOKALIKE_Q, LOOKALIKE_A.answer, "req-2"), row("r-web", BACK_Q, "It's in Sources.", "req-web")];
    view.rerender(<UnifiedChat {...props({ turns: synced })} />);
    await settle();
    expect(lineUnder(LOOKALIKE_Q)).toBe(false);
    expect(lineUnder(BACK_Q)).toBe(true);
  });

  // Codex r3 F10: the notebook was re-identified as an ACS580 and the server's
  // ACS580 status has no search timestamp. The follower must take it as the
  // new machine's status, and the old GS11N-20P2 link must never move.
  it("a generationless status for a changed machine never moves the old link, and shows under its answer", async () => {
    fetchManualSearchStatus.mockResolvedValue(ON_EXACT);
    const view = render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
    await settle();
    expect(linkUnder(EXACT.q)).toBe(true); // precondition: the timestamped GS11N-20P2 link is shown.
    const ACS_Q = "What does fault 2310 mean on the ACS580?";
    const ACS_MESSAGE = "The ABB ACS580 firmware manual is ready to answer from.";
    fetchManualSearchStatus.mockResolvedValue({ manufacturer: "ABB", model: "ACS580", running: false, message: ACS_MESSAGE, answer: "req-acs" });
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT], pending: PENDING(ACS_Q), busy: true })} />);
    await settle();
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT, { q: ACS_Q, a: { answer: "Overcurrent.", citations: [], status: "answered" }, requestId: "req-acs" }] })} />);
    await settle();
    expect(linkUnder(ACS_Q)).toBe(false);
    expect(answerOf(ACS_Q)?.textContent ?? "").not.toContain(READY_MESSAGE);
    expect(answerOf(ACS_Q)?.textContent ?? "").toContain(ACS_MESSAGE);
  });

  // A read the follower refuses (a generationless replay for the machine it
  // already tracks by timestamp) leaves the line where it was.
  it("a refused read never moves the line to the answer it names", async () => {
    fetchManualSearchStatus.mockResolvedValue(ON_EXACT);
    const view = render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
    await settle();
    expect(lineUnder(EXACT.q)).toBe(true); // precondition.
    const { startedAt: _gen, ...generationless } = READY;
    fetchManualSearchStatus.mockResolvedValue({ ...generationless, message: "replayed", answer: "req-3" });
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT], pending: PENDING(SAME_Q), busy: true })} />);
    await settle();
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT, SAME] })} />);
    await settle();
    expect(fetchManualSearchStatus.mock.calls.length).toBeGreaterThan(1); // precondition: it re-read.
    expect(screen.queryByText("replayed")).toBeNull();
    expect(lineUnder(EXACT.q)).toBe(true);
    expect(lineUnder(SAME_Q)).toBe(false);
  });

  // A re-read of the search already followed (same generation and machine)
  // that the server checked against a newer answer moves the line there.
  it("a re-read of the followed search moves the line to the newer answer it names", async () => {
    const RUNNING = { ...READY, running: true, message: undefined, manualUrl: undefined };
    fetchManualSearchStatus.mockResolvedValue({ ...RUNNING, answer: "req-1" });
    const view = render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
    await settle();
    expect(statusUnder(EXACT.q)).toBe(true); // precondition.
    fetchManualSearchStatus.mockResolvedValue({ ...RUNNING, answer: "req-3" });
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT], pending: PENDING(SAME_Q), busy: true })} />);
    await settle();
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT, SAME] })} />);
    await settle();
    expect(statusUnder(SAME_Q)).toBe(true);
    expect(statusUnder(EXACT.q)).toBe(false);
  });

  it("a poll during a running search keeps the status under the answer it names", async () => {
    vi.useFakeTimers();
    try {
      const RUNNING = { ...READY, running: true, message: undefined, manualUrl: undefined, answer: "req-1" };
      fetchManualSearchStatus.mockResolvedValue(RUNNING);
      const view = render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
      await settle();
      expect(statusUnder(EXACT.q)).toBe(true); // precondition: hydration shows the running search.
      const callsBefore = fetchManualSearchStatus.mock.calls.length;
      view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT], pending: PENDING(LOOKALIKE_Q), busy: true })} />);
      await settle();
      await act(async () => { vi.advanceTimersByTime(4100); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(fetchManualSearchStatus.mock.calls.length).toBeGreaterThan(callsBefore); // precondition: the poll ran mid-stream.
      expect(statusUnder(LOOKALIKE_Q)).toBe(false);
      expect(statusUnder(EXACT.q)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // #5750 r2 F8: an older send's re-read settles after a newer send.
  it("an older send's re-read stays under the answer it names", async () => {
    fetchManualSearchStatus.mockResolvedValue(ON_EXACT);
    const view = render(<UnifiedChat {...props({ liveTurns: [EXACT] })} />);
    await settle();
    const reads: Array<(v: unknown) => void> = [];
    fetchManualSearchStatus.mockImplementation(() => new Promise((resolve) => { reads.push(resolve); }));
    const send = async (live: typeof EXACT[], pendingQ: string) => {
      view.rerender(<UnifiedChat {...props({ liveTurns: live, pending: PENDING(pendingQ), busy: true })} />);
      await settle();
    };
    await send([EXACT], SAME_Q);
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT, SAME] })} />);
    await settle();
    await send([EXACT, SAME], LOOKALIKE_Q);
    view.rerender(<UnifiedChat {...props({ liveTurns: [EXACT, SAME, LOOKALIKE] })} />);
    await settle();
    expect(reads).toHaveLength(2); // precondition: one re-read per finished answer, both still open.
    await act(async () => { reads[0]!({ ...READY, answer: "req-3" }); await Promise.resolve(); await Promise.resolve(); });
    expect(lineUnder(LOOKALIKE_Q)).toBe(false);
    expect(lineUnder(SAME_Q)).toBe(true);
    await act(async () => { reads[1]!("hidden"); await Promise.resolve(); await Promise.resolve(); });
    expect(readyShown()).toBe(false);
  });
});
