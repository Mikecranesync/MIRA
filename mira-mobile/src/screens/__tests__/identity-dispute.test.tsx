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
