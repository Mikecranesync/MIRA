// @vitest-environment jsdom
// F004 M3 (#4303): on the unified phone shell, a manual-based question the
// selected manual could not answer is NEVER silently re-asked in general
// mode once the server reports its evidence status. The failed turn stays,
// says honestly what happened, and offers "Get general guidance (not from the
// manual)"; only that tap sends a NEW general turn, linked to the failed one.
// With the server flag off (no status sent) the #3862 behaviour is unchanged.
//
// Run: cd mira-mobile && bunx vitest run tests/unified-general-guidance
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getNotebookDetail: vi.fn(),
  askNotebook: vi.fn(),
}));

vi.mock("../src/api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api/resources")>();
  return { ...real, ...api };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
}
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn(async () => ({})) } }));

import { NotebookScreen } from "../src/screens/NotebookScreen";
import { clearAttachments } from "../src/unified/attachment-handoff";

const ACTION = "Get general guidance (not from the manual)";
const QUESTION = "What does fault F004 mean on this drive";
const ROW = "11111111-1111-4111-8111-111111111111";

const NOTEBOOK = {
  id: "nb-1",
  displayName: "PowerFlex 525 Line 1",
  manufacturer: "Allen-Bradley",
  model: "525",
  equipmentType: null,
  identityStatus: "user_confirmed",
  nodeId: "node-1",
  sourceCount: 1,
  createdAt: null,
  asset: null as null | { entityId: string; confirmedAt: string },
};
const MANUAL = {
  docId: "doc-manual",
  filename: "520-UM001.pdf",
  status: "parsed",
  enabledByDefault: true,
  matchState: "user_confirmed",
  pages: null,
  fileId: "file-manual",
  originFileId: null,
  sourceRole: "manual",
  matchEvidence: null,
};
const entry = (outcome: string, fallback: Record<string, unknown>, retrieval = "passages_found") => ({
  kind: "grounding_status",
  v: 1,
  outcome,
  retrieval: { status: retrieval, scopeDocIds: ["doc-manual"], passageCount: 2, returnedDocIds: ["doc-manual"], returnedSourceRefs: [] },
  citation: { status: "refused", linkedDocIds: [], linkedSourceRefs: [], unresolvedMarkerCount: 0 },
  manualCited: false,
  droppedRefCount: 0,
  fallback,
});
const detail = (over: { asset?: typeof NOTEBOOK.asset; turns?: unknown[] } = {}) => ({
  notebook: { ...NOTEBOOK, asset: over.asset ?? null },
  sources: [MANUAL],
  turns: over.turns ?? [],
  threads: [],
  photos: [],
});
const REFUSED = {
  answer: "I couldn't answer that from the selected sources.",
  citations: [],
  status: "insufficient_evidence",
  sawStatus: true,
  unknownFrames: [entry("refused_with_passages", { offered: true })],
};
const GENERAL = {
  answer: "Undervoltage faults usually point at the incoming supply.",
  citations: [],
  status: "answered",
  sawStatus: true,
  evidenceBasis: "general_reasoning",
  unknownFrames: [entry("answered_without_manual", { offered: false, of: ROW }, "not_attempted")],
};

afterEach(() => {
  cleanup();
  clearAttachments();
  vi.clearAllMocks();
});

async function mountAndAsk() {
  render(<NotebookScreen id="nb-1" chromeless unifiedShell={{ projects: [], machines: [], onOpenItem: () => {} }} backRef={{ current: null }} onExit={() => {}} />);
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Ask MIRA" })).toBeTruthy());
  fireEvent.change(screen.getByRole("textbox", { name: "Ask MIRA" }), { target: { value: QUESTION } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
  await waitFor(() => expect(api.askNotebook).toHaveBeenCalled());
}

describe("unified phone: an explicit choice replaces the silent general re-ask (F004 M3)", () => {
  it("one grounded ask; the failed turn stays with an honest status and the action; nothing else is sent", async () => {
    api.getNotebookDetail.mockResolvedValue(detail());
    api.askNotebook.mockResolvedValueOnce(REFUSED);
    await mountAndAsk();
    await screen.findByText(/read passages from the selected manual but couldn't answer from them/);
    expect(api.askNotebook).toHaveBeenCalledTimes(1);
    const [, question, scope, opts] = api.askNotebook.mock.calls[0]!;
    expect(question).toBe(QUESTION);
    expect(scope).toEqual(["doc-manual"]);
    expect(opts.mode).toBeUndefined();
    expect(screen.getByRole("button", { name: ACTION })).toBeTruthy();
  });

  it("the tap sends ONE new general turn linked to the failed one; both turns stay visible", async () => {
    api.getNotebookDetail.mockResolvedValue(detail());
    api.askNotebook.mockResolvedValueOnce(REFUSED).mockResolvedValueOnce(GENERAL);
    await mountAndAsk();
    const button = await screen.findByRole("button", { name: ACTION });
    const firstId = api.askNotebook.mock.calls[0]![3].clientRequestId as string;
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(api.askNotebook).toHaveBeenCalledTimes(2));
    const [, question, scope, opts] = api.askNotebook.mock.calls[1]!;
    expect(question).toBe(QUESTION);
    expect(scope).toEqual([]);
    expect(opts.mode).toBe("general");
    expect(opts.fallbackOf).toBe(firstId);
    expect(opts.clientRequestId).not.toBe(firstId);
    await screen.findByText("Undervoltage faults usually point at the incoming supply.");
    expect(screen.getByText(/read passages from the selected manual but couldn't answer from them/)).toBeTruthy();
    expect(screen.getByText("General guidance — not from your manual.")).toBeTruthy();
    // The offer was used: no live action remains to send a second general turn.
    expect(screen.queryByRole("button", { name: ACTION })).toBeNull();
  });

  it("declares the capability on the unified shell — chat body and detail load", async () => {
    api.getNotebookDetail.mockResolvedValue(detail());
    api.askNotebook.mockResolvedValueOnce(REFUSED);
    await mountAndAsk();
    expect(api.askNotebook.mock.calls[0]![3].declareGroundingStatus).toBe(true);
    expect(api.getNotebookDetail.mock.calls[0]![1]).toMatchObject({ declareGroundingStatus: true });
  });

  it("control — server flag off (no status sent): the #3862 re-ask is unchanged", async () => {
    api.getNotebookDetail.mockResolvedValue(detail());
    api.askNotebook
      .mockResolvedValueOnce({ ...REFUSED, unknownFrames: undefined })
      .mockResolvedValueOnce({ ...GENERAL, unknownFrames: undefined });
    await mountAndAsk();
    await waitFor(() => expect(api.askNotebook).toHaveBeenCalledTimes(2));
    expect(api.askNotebook.mock.calls[1]![3].mode).toBe("general");
    expect(api.askNotebook.mock.calls[1]![3].fallbackOf).toBeUndefined();
  });

  it("control — a machine-bound notebook (server offers nothing): one ask, no action", async () => {
    api.getNotebookDetail.mockResolvedValue(detail({ asset: { entityId: "e-1", confirmedAt: "2026-10-01T00:00:00Z" } }));
    api.askNotebook.mockResolvedValueOnce({ ...REFUSED, unknownFrames: [entry("refused_with_passages", { offered: false })] });
    await mountAndAsk();
    await screen.findByText(/read passages from the selected manual but couldn't answer from them/);
    expect(api.askNotebook).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: ACTION })).toBeNull();
  });

  it("after reload, a saved failed turn still offers the action and links by its row id", async () => {
    api.getNotebookDetail.mockResolvedValue(detail({
      turns: [{
        id: ROW,
        question: QUESTION,
        answerStatus: "insufficient_evidence",
        answerText: "I couldn't answer that from the selected sources.",
        evidence: [entry("refused_with_passages", { offered: true })],
        basis: "general_reasoning",
      }],
    }));
    api.askNotebook.mockResolvedValueOnce(GENERAL);
    render(<NotebookScreen id="nb-1" chromeless unifiedShell={{ projects: [], machines: [], onOpenItem: () => {} }} backRef={{ current: null }} onExit={() => {}} />);
    const button = await screen.findByRole("button", { name: ACTION });
    // A refusal is not "general guidance": the legacy basis chip is gone.
    expect(screen.queryByText(/General guidance — not grounded/)).toBeNull();
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(api.askNotebook).toHaveBeenCalledTimes(1));
    const [, question, scope, opts] = api.askNotebook.mock.calls[0]!;
    expect(question).toBe(QUESTION);
    expect(scope).toEqual([]);
    expect(opts).toMatchObject({ mode: "general", fallbackOf: ROW });
  });
});
