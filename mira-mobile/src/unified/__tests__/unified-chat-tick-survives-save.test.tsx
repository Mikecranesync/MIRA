// @vitest-environment jsdom
// #6104 r1 F2 (mobile): the reload that follows an answer replaces the streamed turn
// (`live-<i>-a`) with its saved row (`<rowId>-a`), which mounts a new identity card. A technician
// who ticked "<number> is this machine's number" on the streamed card must still send that
// number from the saved one. The saved row's clientRequestId is the streamed turn's requestId,
// so the host gives both cards that id as their tick key.
//
// Run: cd mira-mobile && bunx vitest run src/unified/__tests__/unified-chat-tick-survives-save
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

const { confirmIdentityProposal, getNotebookDetail, fetchManualSearchStatus } = vi.hoisted(() => ({
  confirmIdentityProposal: vi.fn(),
  getNotebookDetail: vi.fn(),
  fetchManualSearchStatus: vi.fn(async () => null),
}));
vi.mock("../../api/identity-confirm", () => ({ confirmIdentityProposal }));
vi.mock("../../api/manual-search-status", () => ({ fetchManualSearchStatus }));
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, getNotebookDetail };
});

import { UnifiedChat } from "../../screens/UnifiedChat";
import type { NotebookServerTurn } from "../../api/resources";
import type { ChatTurn } from "../../chat-adapter/contract";

const NB = "nb-6104";
const QUESTION = "Our SMC SS5Y3-DUW01302 manifold SS5Y3-DUW01302-A leaks at the end plate";
const CARD = { kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302", offeredNumber: "SS5Y3-DUW01302-A" };

function streamed(requestId: string): { q: string; a: ChatTurn; requestId: string } {
  return { q: QUESTION, requestId, a: { answer: "Looking into it.", citations: [], status: "answered", unknownFrames: [CARD] } };
}
function saved(clientRequestId: string): NotebookServerTurn {
  const row = { id: "row-6104", question: QUESTION, answerStatus: "answered", answerText: "Looking into it.", evidence: [CARD], basis: null, clientRequestId };
  return row as NotebookServerTurn;
}

function view(turns: NotebookServerTurn[], liveTurns: { q: string; a: ChatTurn; requestId: string }[]) {
  return (
    <UnifiedChat
      turns={turns}
      liveTurns={liveTurns}
      pending={null}
      busy={false}
      canStop={false}
      canRetry={false}
      chatError={null}
      handlers={{ onSend: () => {}, onStop: () => {}, onCitation: () => {} }}
      meta={{ notebookId: NB, threadId: "notebook-nb-6104:thread-legacy", title: "Manifold", identityConfirmed: false }}
    />
  );
}

const box = () => screen.getByRole("checkbox") as HTMLInputElement;

async function tickThenSave(liveRequestId: string, savedRequestId: string) {
  confirmIdentityProposal.mockResolvedValue({ manualReady: false, message: "Confirmed." });
  getNotebookDetail.mockResolvedValue({ notebook: { id: NB, displayName: "x" }, sources: [], turns: [], threads: [], photos: [] });
  const r = render(view([], [streamed(liveRequestId)]));
  await screen.findByText(/is this machine's number/);
  await act(async () => { fireEvent.click(box()); });
  expect(box().checked).toBe(true); // precondition: the streamed card was ticked
  await act(async () => { r.rerender(view([saved(savedRequestId)], [])); });
  await screen.findByText(/is this machine's number/);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("UnifiedChat: a tick survives the saved answer replacing the streamed one (#6104 r1 F2)", () => {
  it("the saved card is still ticked, and its confirm sends the number", async () => {
    await tickThenSave("req-m-same", "req-m-same");
    expect(box().checked).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use its manuals" })); });
    expect(confirmIdentityProposal).toHaveBeenCalledWith(NB, { manufacturer: "SMC", model: "SS5Y3-DUW01302", confirmedNumber: "SS5Y3-DUW01302-A" });
  });

  it("control: a saved row from another send starts unticked", async () => {
    await tickThenSave("req-m-a", "req-m-b");
    expect(box().checked).toBe(false);
  });
});
