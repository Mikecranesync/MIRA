// @vitest-environment jsdom
// Pointing at a photograph — the wired half.
//
// The hub's photo re-read no longer guesses from phrasing; it fires only when
// the client names one attached photograph. These pin the affordance that does
// the naming: which rows offer it, what the technician can SEE before sending,
// and that the pointer actually reaches the request and then goes away.
//
// The pin is deliberately NOT a promise that the photograph will be re-read —
// that depends on a server flag the client cannot see. It is a statement that
// the next question is ABOUT this photograph, which is true either way.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/notebook-photo-pin

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const { chatUi, askNotebook, getNotebookDetail, setSourceEnabled, requestBinary } = vi.hoisted(
  () => ({
    chatUi: { value: "legacy" as string | null },
    askNotebook: vi.fn(),
    getNotebookDetail: vi.fn(),
    setSourceEnabled: vi.fn(),
    requestBinary: vi.fn(),
  }),
);

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) =>
      key === "flm.chatui.v1" ? { value: chatUi.value } : { value: null },
    ),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));
vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, askNotebook, getNotebookDetail, setSourceEnabled };
});
// The Sources row and the pin chip both render a SourceThumb, which fetches
// the photograph's bytes. Stub the transport so these suites stay offline.
vi.mock("../../api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/client")>();
  return { ...real, requestBinary };
});

import { NotebookScreen } from "../NotebookScreen";
import type { NotebookSource } from "../../api/resources";

const PHOTO: NotebookSource = {
  docId: "d-photo",
  filename: "IMG_2231.jpg",
  status: "indexed",
  enabledByDefault: true,
  matchState: "user_confirmed",
  pages: null,
  fileId: "f-doc",
  originFileId: "f-photo",
  sourceRole: "photo",
  matchEvidence: null,
};
const MANUAL: NotebookSource = {
  docId: "d-manual",
  filename: "gs10-manual.pdf",
  status: "indexed",
  enabledByDefault: true,
  matchState: "user_confirmed",
  pages: 180,
  fileId: "f-man",
  originFileId: null,
  sourceRole: "manual",
  matchEvidence: null,
};

const detail = (sources: NotebookSource[]) => ({
  notebook: { id: "nb1", displayName: "CV-101", manufacturer: null, model: null },
  sources,
  turns: [],
});

function mount(chatV2Available = false) {
  const backRef = { current: null as (() => boolean) | null };
  return render(
    <NotebookScreen id="nb1" backRef={backRef} onExit={() => {}} chatV2Available={chatV2Available} />,
  );
}

/** Chat → overflow → Sources, the only route to the source list. */
async function openSources() {
  fireEvent.click(await screen.findByTestId("nb-overflow"));
  fireEvent.click(await screen.findByText(/^📄 Sources/));
}

const pinButton = () =>
  screen.getByRole("button", { name: "Ask about this photo" }) as HTMLButtonElement;

async function send(text: string) {
  const ta = (await screen.findByRole("textbox", { name: "Ask a question" })) as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

type AskOpts = { photoRead?: { docId: string } };
const lastPhotoRead = (call: number) =>
  (askNotebook.mock.calls[call][3] as AskOpts).photoRead;

beforeEach(() => {
  chatUi.value = "legacy";
  askNotebook.mockReset();
  getNotebookDetail.mockReset();
  setSourceEnabled.mockReset();
  requestBinary.mockReset();
  requestBinary.mockRejectedValue(new Error("no bytes in test"));
  setSourceEnabled.mockResolvedValue(undefined);
  askNotebook.mockResolvedValue({ answer: "ok", citations: [], status: "answered" });
  getNotebookDetail.mockResolvedValue(detail([PHOTO, MANUAL]));
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe("which rows offer to be pointed at", () => {
  it("exactly the photo row — a manual is never askable-about", async () => {
    mount();
    await openSources();
    expect(screen.getAllByRole("button", { name: "Ask about this photo" })).toHaveLength(1);
    // The manual row still has its own three actions, and none of them is this.
    expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(2);
    expect(pinButton().disabled).toBe(false);
  });

  it("a row that is out of chat scope shows the action DISABLED, and says why", async () => {
    // Unchecked: its docId never reaches sourceDocIds, so the server would
    // intersect the pointer away. Hiding the button would leave no way to
    // learn that; disabling it names the fix.
    getNotebookDetail.mockResolvedValue(detail([{ ...PHOTO, enabledByDefault: false }, MANUAL]));
    mount();
    await openSources();
    expect(pinButton().disabled).toBe(true);
    expect(pinButton().getAttribute("title")).toMatch(/Include this source in chat first/);
  });
});

describe("the pin is visible before it is spent", () => {
  it("names the file above the composer and the next question carries photoRead", async () => {
    mount();
    await openSources();
    fireEvent.click(pinButton());
    // Pinning returns to the conversation — the pin is about the NEXT question.
    const chip = await screen.findByTestId("photo-pin");
    expect(chip.textContent).toContain("Next question is about");
    expect(chip.textContent).toContain("IMG_2231.jpg");
    // It states what the question is ABOUT — never that the photo will be
    // re-read, which depends on a server flag the client cannot see.
    expect(chip.textContent).not.toMatch(/re-?read|vision/i);

    await send("read the wire numbers off it");
    expect(askNotebook).toHaveBeenCalledTimes(1);
    expect(lastPhotoRead(0)).toEqual({ docId: "d-photo" });
  });

  it("is CONSUMED by the send — the follow-up carries no pointer", async () => {
    mount();
    await openSources();
    fireEvent.click(pinButton());
    await screen.findByTestId("photo-pin");
    await send("read the wire numbers off it");
    expect(screen.queryByTestId("photo-pin")).toBeNull();

    await send("and what gauge are they");
    expect(askNotebook).toHaveBeenCalledTimes(2);
    expect(lastPhotoRead(1)).toBeUndefined();
  });

  it("can be taken back before sending", async () => {
    mount();
    await openSources();
    fireEvent.click(pinButton());
    await screen.findByTestId("photo-pin");
    fireEvent.click(screen.getByRole("button", { name: "Don't ask about this photo" }));
    expect(screen.queryByTestId("photo-pin")).toBeNull();

    await send("what is P06.01");
    expect(lastPhotoRead(0)).toBeUndefined();
  });

  it("DROPS when the pinned source leaves chat scope", async () => {
    // Unchecking the box removes the docId from sourceDocIds, so the server
    // would ignore the pointer. A chip left standing would be a lie.
    mount();
    await openSources();
    fireEvent.click(pinButton());
    await screen.findByTestId("photo-pin");

    await openSources();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    // Back on the conversation, where the chip lives — asserting its absence
    // from the Sources panel would pass for the wrong reason (it never renders
    // there), which is exactly how a stale pin would slip through.
    fireEvent.click(screen.getByText("‹ Back to chat"));
    expect(screen.queryByTestId("photo-pin")).toBeNull();

    await send("what is P06.01");
    expect(lastPhotoRead(0)).toBeUndefined();
  });
});

describe("both conversation surfaces show it", () => {
  it("ChatV2 renders the same chip above its composer", async () => {
    chatUi.value = null; // the ChatV2 default
    mount(true);
    await screen.findByTestId("v2-input");
    await openSources();
    fireEvent.click(pinButton());
    const chip = await screen.findByTestId("photo-pin");
    expect(chip.textContent).toContain("IMG_2231.jpg");
    // Still the screen's state, not ChatV2's: the undo goes back through the
    // handler and the chip disappears from the surface that rendered it.
    fireEvent.click(screen.getByRole("button", { name: "Don't ask about this photo" }));
    expect(screen.queryByTestId("photo-pin")).toBeNull();
  });
});
