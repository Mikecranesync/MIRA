// @vitest-environment jsdom
// PRD #3990 Golden Conversation, "return to Android": a thread open on the
// phone, continued on web while the app sat in the background, must show the
// web turn when the app comes back to the foreground — without a relaunch or a
// manual reopen. Opposite-direction controls: a resume never refetches over an
// in-flight answer, and a turn asked on this phone renders exactly once after
// the resume reload (it is now persisted AND still in the session's live list).
//
// Run: cd mira-mobile && bunx vitest run src/unified/__tests__/notebook-foreground

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
}
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";

const { askNotebook, getNotebookDetail, appListeners } = vi.hoisted(() => ({
  askNotebook: vi.fn(),
  getNotebookDetail: vi.fn(),
  appListeners: [] as ((s: { isActive: boolean }) => void)[],
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (event: string, cb: (s: { isActive: boolean }) => void) => {
      if (event === "appStateChange") appListeners.push(cb);
      return {
        remove: async () => {
          const i = appListeners.indexOf(cb);
          if (i >= 0) appListeners.splice(i, 1);
        },
      };
    }),
  },
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) =>
      key === "flm.chatui.v1" ? { value: "legacy" } : { value: null },
    ),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, askNotebook, getNotebookDetail };
});

import { NotebookScreen } from "../../screens/NotebookScreen";
import type { ChatTurn } from "../../lib/sse";

const turn = (id: string, question: string, answerText: string) => ({
  id,
  threadId: "th1",
  question,
  answerStatus: "answered",
  answerText,
  evidence: [],
  basis: null,
});

const detail = (t: unknown[]) => ({
  notebook: { id: "nb1", displayName: "CV-101", manufacturer: null, model: null },
  sources: [],
  turns: t,
  photos: [],
});

function mount() {
  const backRef = { current: null as (() => boolean) | null };
  return render(<NotebookScreen id="nb1" threadId="th1" backRef={backRef} onExit={() => {}} />);
}

async function resume() {
  await act(async () => {
    for (const cb of [...appListeners]) cb({ isActive: false });
  });
  await act(async () => {
    for (const cb of [...appListeners]) cb({ isActive: true });
  });
}

const PHONE = turn("t1", "What trips F0003?", "F0003 trips at 135 C.");
const WEB = turn("t2", "And F0002?", "F0002 trips at 840 V.");

beforeEach(() => {
  askNotebook.mockReset();
  getNotebookDetail.mockReset();
  appListeners.length = 0;
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe("NotebookScreen returns to the foreground (#3990)", () => {
  it("shows a turn added on web while the app was backgrounded", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([PHONE]));
    mount();
    await screen.findByText("F0003 trips at 135 C.");
    expect(screen.queryByText("F0002 trips at 840 V.")).toBeNull();

    getNotebookDetail.mockResolvedValue(detail([PHONE, WEB]));
    await resume();

    await screen.findByText("F0002 trips at 840 V.");
    expect(getNotebookDetail).toHaveBeenLastCalledWith("nb1", { threadId: "th1" });
    // Silent reload: the thread never drops to the loading state.
    expect(screen.getByText("F0003 trips at 135 C.")).toBeTruthy();
  });

  it("a turn asked on this phone renders once after the resume reload", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([]));
    askNotebook.mockResolvedValue({ answer: "F0003 trips at 135 C.", citations: [], status: "answered" });
    mount();
    const ta = (await screen.findByRole("textbox", { name: "Ask a question" })) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "What trips F0003?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("F0003 trips at 135 C.");

    getNotebookDetail.mockResolvedValue(detail([PHONE, WEB]));
    await resume();

    await screen.findByText("F0002 trips at 840 V.");
    expect(screen.getAllByText("F0003 trips at 135 C.")).toHaveLength(1);
  });

  it("keeps a local-only turn the server never saved", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([]));
    askNotebook.mockResolvedValue({ answer: "local only answer", citations: [], status: "answered" });
    mount();
    const ta = (await screen.findByRole("textbox", { name: "Ask a question" })) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "never persisted?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("local only answer");

    getNotebookDetail.mockResolvedValue(detail([WEB]));
    await resume();

    await screen.findByText("F0002 trips at 840 V.");
    expect(screen.getAllByText("local only answer")).toHaveLength(1);
  });

  it("control: a resume during an in-flight answer does not refetch over it", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([PHONE]));
    let opts!: { onUpdate?: (t: ChatTurn) => void };
    askNotebook.mockImplementation((_id: string, _q: string, _s: string[], o: typeof opts) => {
      opts = o;
      return new Promise<ChatTurn>(() => {});
    });
    mount();
    const ta = (await screen.findByRole("textbox", { name: "Ask a question" })) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "explain F0006" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    act(() => opts.onUpdate?.({ answer: "F0006 is ", citations: [], status: "" }));
    const calls = getNotebookDetail.mock.calls.length;

    getNotebookDetail.mockResolvedValue(detail([PHONE, WEB]));
    await resume();

    expect(getNotebookDetail.mock.calls.length).toBe(calls);
    expect(screen.getByText("F0006 is")).toBeTruthy();
    expect(screen.queryByText("F0002 trips at 840 V.")).toBeNull();
  });

  it("control: a reload that lands after a thread switch is discarded", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([PHONE]));
    const backRef = { current: null as (() => boolean) | null };
    const view = render(<NotebookScreen id="nb1" threadId="th1" backRef={backRef} onExit={() => {}} />);
    await screen.findByText("F0003 trips at 135 C.");

    let land!: (d: unknown) => void;
    getNotebookDetail.mockImplementationOnce(() => new Promise((r) => (land = r)));
    await resume();
    const OTHER = turn("t9", "Other thread?", "other thread answer");
    getNotebookDetail.mockResolvedValueOnce(detail([OTHER]));
    view.rerender(<NotebookScreen id="nb1" threadId="th2" backRef={backRef} onExit={() => {}} />);
    await screen.findByText("other thread answer");

    await act(async () => land(detail([PHONE, WEB])));
    expect(screen.queryByText("F0002 trips at 840 V.")).toBeNull();
    expect(screen.getByText("other thread answer")).toBeTruthy();
  });

  it("control: background alone (no return) does not refetch", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([PHONE]));
    mount();
    await screen.findByText("F0003 trips at 135 C.");
    const calls = getNotebookDetail.mock.calls.length;
    await act(async () => {
      for (const cb of [...appListeners]) cb({ isActive: false });
    });
    expect(getNotebookDetail.mock.calls.length).toBe(calls);
  });
});

describe("dropPersistedLiveTurns", () => {
  it("each new row consumes at most one live turn; old rows consume none", async () => {
    const { dropPersistedLiveTurns } = await import("../live-turn-reconcile");
    const live = [{ q: "a" }, { q: "a" }, { q: "b" }];
    const rows = [
      { id: "old", question: "b" },
      { id: "n1", question: "a" },
    ];
    expect(dropPersistedLiveTurns(new Set(["old"]), rows, live)).toEqual([{ q: "a" }, { q: "b" }]);
    expect(dropPersistedLiveTurns(new Set(["old", "n1"]), rows, live)).toEqual(live);
  });
});
