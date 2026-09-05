// @vitest-environment jsdom
// 086 §3 — a disputed asset identity is EXPLAINED on both mobile surfaces.
//
// When the server withholds the notebook's bound machine for a turn (the
// client's asset claim did not match the confirmed binding), the technician
// must see why no machine-specific history was used — live, and again after
// reload from the persisted `{kind:"identity_dispute"}` entry. Before this,
// ChatV2 rendered the persisted entry as "something this app version can't
// display yet" and the classic screen dropped it silently.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/identity-dispute
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const { nativePlatform, askNotebook, getNotebookDetail, lookAtPhoto, pickPhoto } = vi.hoisted(() => ({
  nativePlatform: { value: false },
  askNotebook: vi.fn(),
  getNotebookDetail: vi.fn(),
  lookAtPhoto: vi.fn(),
  pickPhoto: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => nativePlatform.value, convertFileSrc: (p: string) => p },
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
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, askNotebook, getNotebookDetail, lookAtPhoto };
});
vi.mock("../../lib/native-pick", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/native-pick")>();
  return { ...real, pickPhoto };
});

import { NotebookScreen } from "../NotebookScreen";
import { parseChatSse, type ChatTurn } from "../../lib/sse";

const wire = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

const DISPUTE = {
  kind: "identity_dispute",
  requestedAssetId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  boundAssetId: "ee715d08-4ea6-4b7a-b99b-958a33c39ea8",
  boundUnsPath: "enterprise.plant.line.conveyor_1",
};
const PERSISTED_DISPUTED = {
  id: "t-dispute",
  question: "what happened around the fault?",
  answerStatus: "answered",
  answerText: "An overcurrent fault usually means the motor drew more than the drive's limit.",
  evidence: [DISPUTE],
  basis: "general_reasoning",
};
const PERSISTED_PLAIN = { ...PERSISTED_DISPUTED, id: "t-plain", evidence: [] };
const CITATION = { citationId: "1", sourceTitle: "GS10 manual", page: 42, quote: "115% FLA", docId: "d1", fileId: "f1", originFileId: null };
/** A disputed turn that was still answered FROM THE MANUALS (the owner's
 *  decision: only machine identity/history is withheld on a dispute). */
const PERSISTED_DISPUTED_CITED = {
  id: "t-dispute-cited",
  question: "what does an OC fault mean?",
  answerStatus: "answered",
  answerText: "Overcurrent: the motor drew more than the drive's limit [1].",
  evidence: [DISPUTE, CITATION],
  basis: "oem_documentation",
};
/** A disputed turn that was NOT answered at all. */
const PERSISTED_DISPUTED_ABSTAINED = {
  id: "t-dispute-abstain",
  question: "what is the belt tension spec?",
  answerStatus: "insufficient_evidence",
  answerText: null,
  evidence: [DISPUTE],
  basis: null,
};

const detail = (turns: unknown[] = []) => ({
  notebook: { id: "nb1", displayName: "CV-101", manufacturer: null, model: null },
  sources: [],
  turns,
});
function mount(available: boolean) {
  const backRef = { current: null as (() => boolean) | null };
  return render(<NotebookScreen id="nb1" backRef={backRef} onExit={() => {}} chatV2Available={available} />);
}
const SURFACES: [string, boolean][] = [
  ["classic (fail-closed fallback)", false],
  ["ChatV2 (default)", true],
];

beforeEach(() => {
  nativePlatform.value = false;
  askNotebook.mockReset();
  getNotebookDetail.mockReset();
  lookAtPhoto.mockReset();
  pickPhoto.mockReset();
  getNotebookDetail.mockResolvedValue(detail());
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe.each(SURFACES)("identity dispute — %s", (_name, available) => {
  it("a PERSISTED disputed turn explains itself on reload, and is not 'undisplayable'", async () => {
    getNotebookDetail.mockResolvedValue(detail([PERSISTED_DISPUTED]));
    mount(available);
    const notice = await screen.findByTestId("identity-dispute");
    expect(notice.textContent).toMatch(/not the machine this notebook is bound to/i);
    expect(await screen.findByText(/overcurrent fault usually means/i)).toBeTruthy();
    expect(screen.queryByTestId("unknown-part")).toBeNull();
    expect(screen.queryByText(/can.t display yet/i)).toBeNull();
  });

  it("an ordinary persisted turn shows NO dispute notice (control)", async () => {
    getNotebookDetail.mockResolvedValue(detail([PERSISTED_PLAIN]));
    mount(available);
    expect(await screen.findByText(/overcurrent fault usually means/i)).toBeTruthy();
    expect(screen.queryByTestId("identity-dispute")).toBeNull();
  });

  it("a CITED disputed turn keeps its citation and is NOT labelled general guidance (round 5 copy)", async () => {
    getNotebookDetail.mockResolvedValue(detail([PERSISTED_DISPUTED_CITED]));
    mount(available);
    const notice = await screen.findByTestId("identity-dispute");
    expect(notice.textContent).toMatch(/not the machine this notebook is bound to/i);
    expect(await screen.findByText(/GS10 manual/)).toBeTruthy();
    expect(screen.queryByText(/general guidance/i)).toBeNull();
    expect(notice.textContent).not.toMatch(/answered/i);
  });

  it("an ABSTAINED disputed turn is explained without being described as answered (round 5 copy)", async () => {
    getNotebookDetail.mockResolvedValue(detail([PERSISTED_DISPUTED_ABSTAINED]));
    mount(available);
    const notice = await screen.findByTestId("identity-dispute");
    expect(notice.textContent).not.toMatch(/answered/i);
    expect(notice.textContent).not.toMatch(/general guidance/i);
    expect(notice.textContent).toMatch(/history was not used/i);
  });

  it("the IN-FLIGHT turn shows the dispute the moment the marker lands — before any content (round 6)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    askNotebook.mockImplementation(async (_id: string, _msg: string, _scope: unknown, opts: { onUpdate?: (t: ChatTurn) => void }) => {
      // The marker frame is FIRST on a disputed wire; the parser reports it
      // with no answer text yet.
      opts.onUpdate?.({ answer: "", citations: [], status: "", identityDisputed: true });
      await gate;
      return parseChatSse(
        wire({ kind: "evidence", identityDisputed: true }) +
          wire({ kind: "content", content: "An overcurrent fault usually means the motor drew too much." }) +
          wire({ kind: "sources", citations: [] }) +
          wire({ kind: "status", status: "answered" }),
      );
    });
    mount(available);
    const input = (await screen.findByRole("textbox", { name: "Ask a question" })) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what happened around the fault?" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    // Still pending (the provider has not produced a byte) — the notice is up.
    const notice = await screen.findByTestId("identity-dispute");
    expect(notice.textContent).toMatch(/not the machine this notebook is bound to/i);
    expect(screen.queryByText(/overcurrent fault/i)).toBeNull();
    release();
    await act(async () => {
      await gate;
    });
    expect(await screen.findByText(/overcurrent fault/i)).toBeTruthy();
    expect(screen.getAllByTestId("identity-dispute").length).toBeGreaterThan(0);
  });

  it("a LIVE disputed turn shows the notice from the evidence frame", async () => {
    const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    const live = parseChatSse(
      frame({ kind: "content", content: "An overcurrent fault usually means the motor drew too much." }) +
        frame({ kind: "sources", citations: [] }) +
        frame({ kind: "evidence", basis: "general_reasoning", label: "General guidance", identityDisputed: true }) +
        frame({ kind: "status", status: "answered" }),
    );
    expect(live.identityDisputed).toBe(true);
    askNotebook.mockImplementation(async (_id: string, _msg: string, _scope: unknown, opts: { onUpdate?: (t: ChatTurn) => void }) => {
      opts.onUpdate?.({ answer: "An overcurrent", citations: [], status: "" });
      return live;
    });
    mount(available);
    const input = (await screen.findByRole("textbox", { name: "Ask a question" })) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what happened around the fault?" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    const notice = await screen.findByTestId("identity-dispute");
    expect(notice.textContent).toMatch(/not the machine this notebook is bound to/i);
  });
});
