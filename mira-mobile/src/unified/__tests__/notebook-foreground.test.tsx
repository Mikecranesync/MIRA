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
// jsdom has no scrollIntoView; useConversationFollow calls it when following latest (#4703).
if (!("scrollIntoView" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => {}, writable: true });
}
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";

const { askNotebook, getNotebookDetail, setSourceEnabled, appListeners } = vi.hoisted(() => ({
  askNotebook: vi.fn(),
  getNotebookDetail: vi.fn(),
  setSourceEnabled: vi.fn(),
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
  return { ...real, askNotebook, getNotebookDetail, setSourceEnabled };
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
  setSourceEnabled.mockReset();
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

// Android runs the unified shell (UnifiedRoot → chromeless NotebookScreen →
// UnifiedChat), not the classic list the cases above pin. Same contract there.
describe("unified shell returns to the foreground (#3990)", () => {
  const mountUnified = () =>
    render(
      <NotebookScreen
        id="nb1"
        threadId="th1"
        backRef={{ current: null }}
        onExit={() => {}}
        chromeless
        unifiedShell={{ projects: [], machines: [], onOpenItem: () => {} }}
      />,
    );

  it("shows the web turn after resume, and a phone turn exactly once", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([]));
    askNotebook.mockResolvedValue({ answer: "F0003 trips at 135 C.", citations: [], status: "answered" });
    mountUnified();
    const ta = await screen.findByRole("textbox");
    fireEvent.change(ta, { target: { value: "What trips F0003?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("F0003 trips at 135 C.");
    expect(screen.queryByText("F0002 trips at 840 V.")).toBeNull();

    getNotebookDetail.mockResolvedValue(detail([PHONE, WEB]));
    await resume();

    await screen.findByText("F0002 trips at 840 V.");
    expect(screen.getAllByText("F0003 trips at 135 C.")).toHaveLength(1);
  });

  // #4637 / #4639 on the surface Android runs. The rows echo the request id
  // the phone minted, as the Hub returns it.
  const sent: string[] = [];
  const rowFor = (id: string, question: string, answerText: string, clientRequestId: string) => ({
    ...turn(id, question, answerText),
    clientRequestId,
  });
  async function askUnified(question: string) {
    const ta = await screen.findByRole("textbox");
    fireEvent.change(ta, { target: { value: question } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  }

  it("#4637: a resume mid-answer catches up exactly once after the answer settles", async () => {
    sent.length = 0;
    getNotebookDetail.mockResolvedValueOnce(detail([]));
    let settle!: (t: ChatTurn) => void;
    askNotebook.mockImplementation((_id: string, _q: string, _s: string[], o: { clientRequestId?: string }) => {
      sent.push(String(o.clientRequestId));
      return new Promise<ChatTurn>((r) => (settle = r));
    });
    mountUnified();
    await askUnified("What trips F0003?");
    const calls = getNotebookDetail.mock.calls.length;
    await resume();
    expect(getNotebookDetail.mock.calls.length).toBe(calls);

    // #4074: the Hub names the saved row of the live answer in its turn_saved frame,
    // so the answer needs no re-read and the foreground catch-up stays the only fetch.
    const savedRow = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    getNotebookDetail.mockResolvedValue(
      detail([rowFor(savedRow, "What trips F0003?", "F0003 trips at 135 C.", sent[0]!), rowFor("t2", "And F0002?", "F0002 trips at 840 V.", "web-1")]),
    );
    await act(async () =>
      settle({ answer: "F0003 trips at 135 C.", citations: [], status: "answered", persistedTurnId: savedRow }),
    );

    await screen.findByText("F0002 trips at 840 V.");
    expect(getNotebookDetail.mock.calls.length).toBe(calls + 1);
    expect(screen.getAllByText("F0003 trips at 135 C.")).toHaveLength(1);
  });

  it("#4639: a same-question web row with a different request id leaves the phone's turn", async () => {
    sent.length = 0;
    getNotebookDetail.mockResolvedValueOnce(detail([]));
    askNotebook.mockImplementation(async (_id: string, _q: string, _s: string[], o: { clientRequestId?: string }) => {
      sent.push(String(o.clientRequestId));
      return { answer: "F0003 trips at 135 C.", citations: [], status: "answered" };
    });
    mountUnified();
    await askUnified("What trips F0003?");
    await screen.findByText("F0003 trips at 135 C.");

    getNotebookDetail.mockResolvedValue(detail([rowFor("w1", "What trips F0003?", "F0003 trips at 135 C.", "web-1")]));
    await resume();
    await act(async () => {});

    expect(sent[0]).not.toBe("web-1");
    expect(screen.getAllByText("F0003 trips at 135 C.")).toHaveLength(2);
  });
});

describe("dropPersistedLiveTurns", () => {
  const lt = (q: string, answer: string, requestId?: string) => ({ q, a: { answer }, ...(requestId ? { requestId } : {}) });
  it("legacy rows (no request id): each new row consumes at most one live turn; old rows consume none", async () => {
    const { dropPersistedLiveTurns } = await import("../live-turn-reconcile");
    const live = [lt("a", "x"), lt("a", "x"), lt("b", "y")];
    const rows = [
      { id: "old", question: "b", answerText: "y" },
      { id: "n1", question: "a", answerText: "x" },
    ];
    expect(dropPersistedLiveTurns(new Set(["old"]), rows, live)).toEqual([lt("a", "x"), lt("b", "y")]);
    expect(dropPersistedLiveTurns(new Set(["old", "n1"]), rows, live)).toEqual(live);
  });

  it("#4639: a legacy row with the same question but a different answer is not this turn", async () => {
    const { dropPersistedLiveTurns } = await import("../live-turn-reconcile");
    const live = [lt("a", "phone answer")];
    expect(dropPersistedLiveTurns(new Set(), [{ id: "w", question: "a", answerText: "web answer" }], live)).toEqual(live);
  });

  it("#4639: rows that expose a request id match by id only", async () => {
    const { dropPersistedLiveTurns } = await import("../live-turn-reconcile");
    const live = [lt("a", "x", "r1"), lt("a", "x", "r2")];
    // Same question AND answer, different id (another client): nothing goes.
    expect(dropPersistedLiveTurns(new Set(), [{ id: "w", question: "a", answerText: "x", clientRequestId: "web" }], live)).toEqual(live);
    // A row with no id at all (sent without one) is never this phone's turn.
    expect(dropPersistedLiveTurns(new Set(), [{ id: "w", question: "a", answerText: "x", clientRequestId: null }], live)).toEqual(live);
    // The matching id removes exactly that turn, even when it is not the first.
    expect(dropPersistedLiveTurns(new Set(), [{ id: "p", question: "a", answerText: "x", clientRequestId: "r2" }], live)).toEqual([live[0]]);
  });
});

// The rows below carry the request id the phone minted, as the Hub returns it
// from #4639 on. `asked` records every id this phone sent, in order.
describe("foreground sync converges on server truth (#4637 #4638 #4639)", () => {
  const row = (id: string, question: string, answerText: string, clientRequestId: string | null) => ({
    ...turn(id, question, answerText),
    clientRequestId,
  });
  let asked: string[];
  beforeEach(() => {
    asked = [];
  });

  async function ask(question: string) {
    const ta = (await screen.findByRole("textbox", { name: "Ask a question" })) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: question } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  }
  function answers(...texts: string[]) {
    const queue = [...texts];
    askNotebook.mockImplementation(async (_id: string, _q: string, _s: string[], o: { clientRequestId?: string }) => {
      asked.push(String(o.clientRequestId));
      return { answer: queue.shift() ?? "", citations: [], status: "answered" };
    });
  }
  function heldAnswer() {
    let settle!: (t: ChatTurn) => void;
    askNotebook.mockImplementation((_id: string, _q: string, _s: string[], o: { clientRequestId?: string }) => {
      asked.push(String(o.clientRequestId));
      return new Promise<ChatTurn>((r) => (settle = r));
    });
    return (t: ChatTurn) => act(async () => settle(t));
  }
  function heldFetch() {
    let land!: (d: unknown) => void;
    getNotebookDetail.mockImplementationOnce(() => new Promise((r) => (land = r)));
    return (d: unknown) => act(async () => land(d));
  }

  it("#4637: a resume during an in-flight answer catches up once after it finishes", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([]));
    const settle = heldAnswer();
    mount();
    await ask("What trips F0003?");
    const calls = getNotebookDetail.mock.calls.length;

    // Two resumes while the answer streams: neither fetches over it.
    await resume();
    await resume();
    expect(getNotebookDetail.mock.calls.length).toBe(calls);

    getNotebookDetail.mockResolvedValue(
      detail([row("t1", "What trips F0003?", "F0003 trips at 135 C.", asked[0]!), row("t2", "And F0002?", "F0002 trips at 840 V.", "web-1")]),
    );
    await settle({ answer: "F0003 trips at 135 C.", citations: [], status: "answered" });

    await screen.findByText("F0002 trips at 840 V.");
    expect(getNotebookDetail.mock.calls.length).toBe(calls + 1);
    expect(screen.getAllByText("F0003 trips at 135 C.")).toHaveLength(1);
    expect(screen.getAllByText("F0002 trips at 840 V.")).toHaveLength(1);
  });

  it("#4637: a resume reload that lands mid-answer is replayed after the answer", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([]));
    mount();
    await screen.findByRole("textbox", { name: "Ask a question" });
    const land = heldFetch();
    await resume();
    const settle = heldAnswer();
    await ask("What trips F0003?");
    // The reload lands while the answer is still streaming: it must not commit.
    await land(detail([row("t2", "And F0002?", "F0002 trips at 840 V.", "web-1")]));
    expect(screen.queryByText("F0002 trips at 840 V.")).toBeNull();
    const calls = getNotebookDetail.mock.calls.length;

    getNotebookDetail.mockResolvedValue(
      detail([row("t2", "And F0002?", "F0002 trips at 840 V.", "web-1"), row("t3", "What trips F0003?", "F0003 trips at 135 C.", asked[0]!)]),
    );
    await settle({ answer: "F0003 trips at 135 C.", citations: [], status: "answered" });

    await screen.findByText("F0002 trips at 840 V.");
    expect(getNotebookDetail.mock.calls.length).toBe(calls + 1);
    expect(screen.getAllByText("F0003 trips at 135 C.")).toHaveLength(1);
  });

  it("control #4637: an idle resume fetches immediately and nothing replays later", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([PHONE]));
    answers("F0006 is a ground fault.");
    mount();
    await screen.findByText("F0003 trips at 135 C.");
    const calls = getNotebookDetail.mock.calls.length;
    getNotebookDetail.mockResolvedValue(detail([PHONE, WEB]));
    await resume();
    await screen.findByText("F0002 trips at 840 V.");
    expect(getNotebookDetail.mock.calls.length).toBe(calls + 1);

    await ask("explain F0006");
    await screen.findByText("F0006 is a ground fault.");
    expect(getNotebookDetail.mock.calls.length).toBe(calls + 1);
  });

  it("#4638: an older reload that lands last cannot overwrite a newer one", async () => {
    const OLD = row("t1", "What trips F0003?", "F0003 trips at 135 C.", "web-0");
    const NEW = row("t2", "And F0002?", "F0002 trips at 840 V.", "web-1");
    getNotebookDetail.mockResolvedValueOnce(detail([OLD]));
    mount();
    await screen.findByText("F0003 trips at 135 C.");

    const landA = heldFetch();
    await resume();
    const landB = heldFetch();
    await resume();

    await landB(detail([OLD, NEW]));
    await screen.findByText("F0002 trips at 840 V.");
    await landA(detail([OLD]));

    expect(screen.getByText("F0002 trips at 840 V.")).toBeTruthy();
    expect(screen.getAllByText("F0003 trips at 135 C.")).toHaveLength(1);
  });

  it("#4638: an older reload cannot reconcile live turns against its stale snapshot", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([]));
    answers("first answer");
    mount();
    await ask("Q?");
    await screen.findByText("first answer");

    const landA = heldFetch();
    await resume();
    const landB = heldFetch();
    await resume();
    // B (newest) has not saved the phone turn yet; A's snapshot claims it.
    await landB(detail([row("t2", "And F0002?", "F0002 trips at 840 V.", "web-1")]));
    await screen.findByText("F0002 trips at 840 V.");
    await landA(detail([row("t1", "Q?", "first answer", asked[0]!)]));

    // A is discarded whole: the web turn stays, the live phone turn stays.
    expect(screen.getByText("F0002 trips at 840 V.")).toBeTruthy();
    expect(screen.getAllByText("first answer")).toHaveLength(1);
  });

  it("#4638: an ordinary refresh started after a resume reload wins over it", async () => {
    const SRC = { docId: "d1", filename: "manual.pdf", status: "ready", enabledByDefault: true, matchState: "user_confirmed",
      pages: 3, fileId: null, originFileId: null, sourceRole: "manual", matchEvidence: null };
    const WIRING = { ...SRC, docId: "d2", filename: "wiring.pdf" };
    const withSources = (src: unknown[]) => ({ ...detail([PHONE]), sources: src });
    getNotebookDetail.mockResolvedValueOnce(withSources([SRC]));
    setSourceEnabled.mockRejectedValue(new Error("offline"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "More options" }));
    fireEvent.click(screen.getByRole("button", { name: /Sources \(1\)/ }));
    await screen.findByText("manual.pdf");

    const landResume = heldFetch();
    await resume();
    // A failed toggle refreshes from the server — a NEWER load than the resume.
    const landRefresh = heldFetch();
    await act(async () => {
      fireEvent.click(screen.getByTitle("Include this source in notebook chat"));
    });
    await landRefresh(withSources([SRC, WIRING]));
    await screen.findByText("wiring.pdf");
    await landResume(withSources([SRC]));

    expect(screen.getByText("wiring.pdf")).toBeTruthy();
  });

  it("#4638 (Codex F1): a refresh that supersedes a resume reload still de-duplicates the phone turn", async () => {
    const SRC = { docId: "d1", filename: "manual.pdf", status: "ready", enabledByDefault: true, matchState: "user_confirmed",
      pages: 3, fileId: null, originFileId: null, sourceRole: "manual", matchEvidence: null };
    const withSources = (t: unknown[]) => ({ ...detail(t), sources: [SRC] });
    getNotebookDetail.mockResolvedValueOnce(withSources([]));
    setSourceEnabled.mockRejectedValue(new Error("offline"));
    const histories: unknown[] = [];
    const replies = ["F0003 trips at 135 C.", "F0004 is undervoltage."];
    askNotebook.mockImplementation(async (_id: string, _q: string, _s: string[], o: { clientRequestId?: string; history?: unknown }) => {
      asked.push(String(o.clientRequestId));
      histories.push(o.history);
      return { answer: replies.shift() ?? "", citations: [], status: "answered" };
    });
    mount();
    await ask("What trips F0003?");
    await screen.findByText("F0003 trips at 135 C.");
    const saved = withSources([row("t1", "What trips F0003?", "F0003 trips at 135 C.", asked[0]!)]);

    const landResume = heldFetch();
    await resume();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(screen.getByRole("button", { name: /Sources \(1\)/ }));
    const landRefresh = heldFetch();
    await act(async () => {
      fireEvent.click(await screen.findByTitle("Include this source in notebook chat"));
    });
    await landRefresh(saved);
    await landResume(saved);
    fireEvent.click(screen.getByText(/Back to chat|← Chat|Chat/, { selector: "button.nb-panel-back" }));

    expect(screen.getAllByText("F0003 trips at 135 C.")).toHaveLength(1);
    getNotebookDetail.mockResolvedValue(saved);
    await ask("And F0004?");
    await screen.findByText("F0004 is undervoltage.");
    const sentHistory = histories[1] as { role: string; content: string }[];
    expect(sentHistory.filter((h) => h.content === "What trips F0003?")).toHaveLength(1);
  });

  it("control #4638: a single reload still commits", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([PHONE]));
    mount();
    await screen.findByText("F0003 trips at 135 C.");
    const land = heldFetch();
    await resume();
    await land(detail([PHONE, WEB]));
    expect(screen.getByText("F0002 trips at 840 V.")).toBeTruthy();
  });

  it("#4639: a same-question web row with a different request id leaves the phone's local turn", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([]));
    answers("F0003 trips at 135 C.");
    mount();
    await ask("What trips F0003?");
    await screen.findByText("F0003 trips at 135 C.");

    // Same question, same answer text — only the request id differs.
    getNotebookDetail.mockResolvedValue(detail([row("w1", "What trips F0003?", "F0003 trips at 135 C.", "web-1")]));
    await resume();
    await act(async () => {});

    expect(asked[0]).not.toBe("web-1");
    expect(screen.getAllByText("F0003 trips at 135 C.")).toHaveLength(2);
  });

  it("#4639: a row with the matching request id removes exactly that live turn", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([]));
    answers("first answer", "second answer");
    mount();
    await ask("Same question?");
    await screen.findByText("first answer");
    await ask("Same question?");
    await screen.findByText("second answer");
    expect(asked).toHaveLength(2);

    getNotebookDetail.mockResolvedValue(detail([row("p2", "Same question?", "second answer", asked[1]!)]));
    await resume();
    await act(async () => {});

    expect(screen.getAllByText("first answer")).toHaveLength(1);
    expect(screen.getAllByText("second answer")).toHaveLength(1);
  });

  it("#4639: a general re-ask's live turn carries the re-ask's id, not the abstained one's", async () => {
    const SRC = { docId: "d1", filename: "manual.pdf", status: "ready", enabledByDefault: true, matchState: "user_confirmed",
      pages: 3, fileId: null, originFileId: null, sourceRole: "manual", matchEvidence: null };
    const withSources = (t: unknown[]) => ({ ...detail(t), sources: [SRC] });
    getNotebookDetail.mockResolvedValueOnce(withSources([]));
    const replies = [
      { answer: "The manual does not cover that.", citations: [], status: "insufficient_evidence" },
      { answer: "A VFD varies motor speed.", citations: [], status: "answered" },
    ];
    askNotebook.mockImplementation(async (_id: string, _q: string, _s: string[], o: { clientRequestId?: string }) => {
      asked.push(String(o.clientRequestId));
      return replies.shift();
    });
    mount();
    await ask("What is a VFD?");
    await screen.findByText("A VFD varies motor speed.");
    expect(asked).toHaveLength(2);

    // Only the abstention is saved so far: it is NOT the turn the phone shows,
    // so the live general answer must stay.
    getNotebookDetail.mockResolvedValue(withSources([
      row("t1", "What is a VFD?", "The manual does not cover that.", asked[0]!),
    ]));
    await resume();
    await screen.findByText("The manual does not cover that.");
    expect(screen.getAllByText("A VFD varies motor speed.")).toHaveLength(1);

    // Once the general answer is saved too, it renders once.
    getNotebookDetail.mockResolvedValue(withSources([
      row("t1", "What is a VFD?", "The manual does not cover that.", asked[0]!),
      row("t2", "What is a VFD?", "A VFD varies motor speed.", asked[1]!),
    ]));
    await resume();
    await act(async () => {});
    expect(screen.getAllByText("A VFD varies motor speed.")).toHaveLength(1);
  });

  it("phone → web → phone continuation, then a cold restart, renders every turn once", async () => {
    getNotebookDetail.mockResolvedValueOnce(detail([]));
    answers("P1 answer", "P2 answer");
    const view = mount();
    await ask("P1?");
    await screen.findByText("P1 answer");

    const afterWeb = () => [row("t1", "P1?", "P1 answer", asked[0]!), row("t2", "W1?", "W1 answer", "web-1")];
    getNotebookDetail.mockResolvedValue(detail(afterWeb()));
    await resume();
    await screen.findByText("W1 answer");

    await ask("P2?");
    await screen.findByText("P2 answer");
    const all = () => [...afterWeb(), row("t3", "P2?", "P2 answer", asked[1]!), row("t4", "W2?", "W2 answer", "web-2")];
    getNotebookDetail.mockResolvedValue(detail(all()));
    await resume();
    await screen.findByText("W2 answer");
    for (const a of ["P1 answer", "W1 answer", "P2 answer", "W2 answer"]) expect(screen.getAllByText(a)).toHaveLength(1);

    // Cold restart: a fresh mount from the server alone.
    view.unmount();
    getNotebookDetail.mockResolvedValueOnce(detail(all()));
    mount();
    await screen.findByText("W2 answer");
    for (const a of ["P1 answer", "W1 answer", "P2 answer", "W2 answer"]) expect(screen.getAllByText(a)).toHaveLength(1);
  });
});
