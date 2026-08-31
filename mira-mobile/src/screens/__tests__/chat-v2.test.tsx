// @vitest-environment jsdom
// ChatV2 — the SHIPPING conversation surface (PRD 2026-08-30). These pin the
// same technician-facing contracts the classic screen pins, on the surface
// that is actually the default: STRM-1 (paints as frames arrive), STRM-2
// (Stop keeps the partial, marks it Stopped, drops citations), CMPS-1
// (textarea, Enter sends), hydration (a persisted stopped turn reloads as
// stopped), and the attachment entry points.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/chat-v2

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, act, waitFor } from "@testing-library/react";

// jsdom ships no ResizeObserver; the Android WebView (Chromium) has had it
// since Chrome 64, so this is a test-environment shim only — the thread
// viewport uses it to keep the scroll pinned as content grows.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// Same story for scrollTo on the viewport element.
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
    // ChatV2 is the default; returning null exercises that default.
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
import type { ChatTurn } from "../../lib/sse";

const CITATION = {
  citationId: "1",
  sourceTitle: "GS10 manual",
  page: 42,
  quote: "115% FLA",
  docId: "d1",
  fileId: "f1",
  originFileId: null,
};

const detail = (turns: unknown[] = []) => ({
  notebook: { id: "nb1", displayName: "CV-101", manufacturer: null, model: null },
  sources: [],
  turns,
});

function mount(chatV2Available = true) {
  const backRef = { current: null as (() => boolean) | null };
  return render(
    <NotebookScreen
      id="nb1"
      backRef={backRef}
      onExit={() => {}}
      chatV2Available={chatV2Available}
    />,
  );
}

const composer = async () =>
  (await screen.findByRole("textbox", { name: "Ask a question" })) as HTMLTextAreaElement;

async function type(text: string) {
  const el = await composer();
  fireEvent.change(el, { target: { value: text } });
  return el;
}

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

describe("ChatV2 (default surface)", () => {
  it("fails closed to legacy chat when the server omits chat_v2", async () => {
    mount(false);
    expect(
      await screen.findByText(/Ask anything now — answers are general until this notebook/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("v2-empty")).toBeNull();
  });

  it("renders the conversation, not the classic panel", async () => {
    mount();
    expect(await screen.findByTestId("v2-empty")).toBeTruthy();
    expect(await composer()).toBeTruthy();
    expect(screen.getByTestId("v2-attach")).toBeTruthy();
  });

  it("CMPS-1: Enter sends through the screen's send path", async () => {
    askNotebook.mockResolvedValue({
      answer: "The overload trips at 115% [1].",
      citations: [CITATION],
      status: "answered",
    } as ChatTurn);
    mount();
    const el = await type("what trips the overload");
    await act(async () => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(1));
    expect(askNotebook.mock.calls[0][1]).toBe("what trips the overload");
    expect(await screen.findByText(/overload trips at 115%/)).toBeTruthy();
  });

  it("STRM-1: the answer paints as frames arrive", async () => {
    // The turn is held open so the DOM can be inspected mid-stream: a partial
    // must be visible BEFORE the final frame lands, or the technician is
    // watching a spinner rather than an answer.
    let release!: (t: ChatTurn) => void;
    let sawSecondFrame!: () => void;
    const secondFramePainted = new Promise<void>((r) => (sawSecondFrame = r));
    askNotebook.mockImplementation(async (_id, _msg, _scope, opts) => {
      opts.onUpdate?.({ answer: "The ", citations: [], status: "" });
      queueMicrotask(() => {
        opts.onUpdate?.({ answer: "The overload ", citations: [], status: "" });
        sawSecondFrame();
      });
      return await new Promise<ChatTurn>((res) => (release = res));
    });
    mount();
    const el = await type("q");
    await act(async () => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    await act(async () => {
      await secondFramePainted;
    });
    // Mid-stream: the partial is on screen and the turn has NOT completed.
    expect(screen.getByText(/The overload/)).toBeTruthy();
    expect(screen.queryByText(/trips\./)).toBeNull();
    await act(async () => {
      release({ answer: "The overload trips.", citations: [], status: "answered" } as ChatTurn);
    });
    await waitFor(() => expect(screen.getByText(/The overload trips\./)).toBeTruthy());
  });

  it("STRM-2: Stop replaces Send, keeps the partial, marks it Stopped, drops citations", async () => {
    let abort!: (reason?: unknown) => void;
    askNotebook.mockImplementation(async (_id, _msg, _scope, opts) => {
      opts.onUpdate?.({ answer: "The overload tri", citations: [CITATION], status: "" });
      return await new Promise((_res, rej) => {
        abort = () => rej(new DOMException("Aborted", "AbortError"));
        opts.signal?.addEventListener("abort", () => abort());
      });
    });
    mount();
    const el = await type("q");
    await act(async () => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    // While running, Stop is offered instead of Send.
    const stop = await screen.findByTestId("v2-stop");
    expect(screen.queryByTestId("v2-send")).toBeNull();
    await act(async () => {
      fireEvent.click(stop);
    });
    expect(await screen.findByTestId("stopped-caption")).toBeTruthy();
    expect(screen.getByText(/The overload tri/)).toBeTruthy();
    // A stopped answer is not an answer: no citation chip survives.
    expect(screen.queryByText(/GS10 manual/)).toBeNull();
    await waitFor(() => expect(screen.getByTestId("v2-send")).toBeTruthy());
  });

  it("native buffered chat is honest: it shows Working and never offers cosmetic Stop", async () => {
    nativePlatform.value = true;
    askNotebook.mockImplementation(() => new Promise(() => {}));
    mount();
    const el = await type("q");
    await act(async () => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    expect(await screen.findByTestId("v2-working")).toBeTruthy();
    expect(screen.queryByTestId("v2-stop")).toBeNull();
  });

  it("hydration: a persisted stopped turn reloads as Stopped with no chips", async () => {
    getNotebookDetail.mockResolvedValue(
      detail([
        {
          id: "t1",
          question: "tell me everything",
          answerStatus: "error",
          answerText: "The overload tri",
          evidence: [CITATION],
          basis: null,
        },
      ]),
    );
    mount();
    expect(await screen.findByTestId("stopped-caption")).toBeTruthy();
    expect(screen.getByText(/The overload tri/)).toBeTruthy();
    expect(screen.queryByText(/GS10 manual/)).toBeNull();
  });

  it("hydration: an answered turn reloads with its citation chip and basis", async () => {
    getNotebookDetail.mockResolvedValue(
      detail([
        {
          id: "t1",
          question: "what trips it",
          answerStatus: "answered",
          answerText: "Trips at 115% [1].",
          evidence: [CITATION],
          basis: "general_reasoning",
        },
      ]),
    );
    mount();
    expect(await screen.findByText(/Trips at 115%/)).toBeTruthy();
    expect(screen.getByText(/GS10 manual/)).toBeTruthy();
    expect(screen.getByTestId("basis-general")).toBeTruthy();
  });

  it("attachment menu offers the photo and document doors", async () => {
    mount();
    const attach = await screen.findByTestId("v2-attach");
    await act(async () => {
      fireEvent.click(attach);
    });
    const menu = await screen.findByTestId("v2-attach-menu");
    expect(menu.textContent).toMatch(/Photo/);
    expect(menu.textContent).toMatch(/Document/);
  });

  it("sends the visible composer draft as the photo question", async () => {
    const file = new File(["photo"], "motor.jpg", { type: "image/jpeg" });
    pickPhoto.mockResolvedValue(file);
    lookAtPhoto.mockResolvedValue({
      fileId: "photo-1",
      observation: { capturedAt: "2026-08-31T12:00:00.000Z" },
    });
    askNotebook.mockResolvedValue({ answer: "Bearing housing.", citations: [], status: "answered" });
    mount();
    await type("Is this bearing housing damaged?");
    fireEvent.click(await screen.findByTestId("v2-attach"));
    fireEvent.click(await screen.findByRole("button", { name: /Photo/ }));
    await waitFor(() => expect(lookAtPhoto).toHaveBeenCalledTimes(1));
    expect(lookAtPhoto.mock.calls[0][3]).toBe("Is this bearing housing damaged?");
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(1));
    expect(askNotebook.mock.calls[0][1]).toBe("Is this bearing housing damaged?");
  });

  it("offers a message-level Copy action for a completed answer", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    askNotebook.mockResolvedValue({ answer: "Inspect the overload relay.", citations: [], status: "answered" });
    mount();
    const el = await type("what should I inspect");
    await act(async () => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Copy answer" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Inspect the overload relay."));
  });

  it("a failed send surfaces Retry and keeps the question", async () => {
    askNotebook.mockRejectedValue(new Error("network"));
    mount();
    const el = await type("what trips the overload");
    await act(async () => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    const retry = await screen.findByText("Retry");
    expect((await composer()).value).toBe("what trips the overload");
    askNotebook.mockResolvedValue({ answer: "ok", citations: [], status: "answered" } as ChatTurn);
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(2));
    // CMPS-2: the retry re-sends the identical question, not a recomputed one.
    expect(askNotebook.mock.calls[1][1]).toBe("what trips the overload");
  });
});
