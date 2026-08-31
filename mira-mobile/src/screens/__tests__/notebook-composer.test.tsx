// @vitest-environment jsdom
// NotebookScreen chat panel: STRM-1 (paints per update), STRM-2 (Stop keeps
// partial text, no citations / follow-ups), CMPS-1 (textarea + Enter sends),
// CMPS-2 (failure keeps the question; Retry re-sends the identical body).
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/notebook-composer

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    // These suites pin the CLASSIC chat surface, which still ships behind
    // More → "Chat style". ChatV2 is the default, so the preference is
    // returned explicitly here rather than relied upon — the ChatV2 contracts
    // are pinned separately in src/screens/__tests__/chat-v2.test.tsx and
    // src/chat-adapter/__tests__/.
    get: vi.fn(async ({ key }: { key: string }) =>
      key === "flm.chatui.v1" ? { value: "legacy" } : { value: null },
    ),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));

const { askNotebook, getNotebookDetail } = vi.hoisted(() => ({
  askNotebook: vi.fn(),
  getNotebookDetail: vi.fn(),
}));

vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, askNotebook, getNotebookDetail };
});

import { NotebookScreen } from "../NotebookScreen";
import type { ChatTurn } from "../../lib/sse";

const detail = () => ({
  notebook: { id: "nb1", displayName: "CV-101", manufacturer: null, model: null },
  sources: [],
  turns: [],
});

function mount() {
  const backRef = { current: null as (() => boolean) | null };
  return render(<NotebookScreen id="nb1" backRef={backRef} onExit={() => {}} />);
}

async function composer() {
  return (await screen.findByRole("textbox", { name: "Ask a question" })) as HTMLTextAreaElement;
}

type AskOpts = { signal?: AbortSignal; onUpdate?: (t: ChatTurn) => void; history?: unknown; mode?: string };

beforeEach(() => {
  askNotebook.mockReset();
  getNotebookDetail.mockReset();
  getNotebookDetail.mockResolvedValue(detail());
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe("NotebookScreen composer", () => {
  it("is a textarea; Enter sends, Shift+Enter and composing Enter do not", async () => {
    askNotebook.mockResolvedValue({ answer: "ok", citations: [], status: "answered" });
    mount();
    const ta = await composer();
    expect(ta.tagName).toBe("TEXTAREA");
    expect(ta.getAttribute("enterkeyhint")).toBe("send");
    fireEvent.change(ta, { target: { value: "why did it trip" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(askNotebook).not.toHaveBeenCalled();
    fireEvent.keyDown(ta, { key: "Enter", keyCode: 229 });
    expect(askNotebook).not.toHaveBeenCalled();
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(askNotebook).toHaveBeenCalledTimes(1);
    expect(askNotebook.mock.calls[0][1]).toBe("why did it trip");
    await screen.findByText("ok");
  });

  it("CMPS-2: a failed send keeps the question in the composer; Retry re-sends the identical body", async () => {
    askNotebook.mockRejectedValueOnce(new Error("502"));
    askNotebook.mockResolvedValueOnce({ answer: "second time", citations: [], status: "answered" });
    mount();
    const ta = await composer();
    fireEvent.change(ta, { target: { value: "what is P06.01" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect((await composer()).value).toBe("what is P06.01");

    fireEvent.click(retry);
    await screen.findByText("second time");
    expect(askNotebook).toHaveBeenCalledTimes(2);
    const [a, b] = askNotebook.mock.calls as [unknown[], unknown[]];
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe(a[1]);
    expect(b[2]).toEqual(a[2]);
    const oa = a[3] as AskOpts;
    const ob = b[3] as AskOpts;
    expect(ob.mode).toEqual(oa.mode);
    expect(ob.history).toEqual(oa.history);
    expect(JSON.stringify({ m: ob.mode, h: ob.history })).toBe(JSON.stringify({ m: oa.mode, h: oa.history }));
  });

  it("STRM-1: each onUpdate paints; STRM-2: Stop keeps partial text, marks Stopped, no chips/follow-ups", async () => {
    let opts!: AskOpts;
    askNotebook.mockImplementation((_id: string, _q: string, _s: string[], o: AskOpts) => {
      opts = o;
      return new Promise<ChatTurn>((_res, rej) => {
        o.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")));
      });
    });
    mount();
    const ta = await composer();
    fireEvent.change(ta, { target: { value: "explain F004" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();

    act(() => opts.onUpdate?.({ answer: "F004 is ", citations: [], status: "" }));
    expect(screen.getByText("F004 is")).toBeTruthy();
    act(() =>
      opts.onUpdate?.({
        answer: "F004 is an under-voltage",
        citations: [{ citationId: "1", sourceTitle: "x" }],
        status: "",
        followups: ["should not show"],
      }),
    );
    expect(screen.getByText("F004 is an under-voltage")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    await screen.findByText("Stopped");
    expect(screen.getByText("F004 is an under-voltage")).toBeTruthy();
    expect(screen.queryByText("should not show")).toBeNull();
    expect(screen.queryByText(/1 · x/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Citation 1" })).toBeNull();
    // Composer is back to Send and the stopped question is NOT restored (it was not a failure).
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect((await composer()).value).toBe("");

    // The stopped turn is NOT an answer: the next send carries no memory of it.
    askNotebook.mockResolvedValueOnce({ answer: "next", citations: [], status: "answered" });
    fireEvent.change(await composer(), { target: { value: "next question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("next");
    const nextOpts = askNotebook.mock.calls.at(-1)?.[3] as AskOpts;
    expect(JSON.stringify(nextOpts.history ?? [])).not.toContain("under-voltage");
    expect(JSON.stringify(nextOpts.history ?? [])).not.toContain("explain F004");
  });

  it("STRM-2 reload: a persisted error+partial turn renders the partial with Stopped, no chips/basis, and is excluded from history", async () => {
    getNotebookDetail.mockResolvedValue({
      ...detail(),
      turns: [
        {
          id: "t1",
          question: "explain F004",
          answerStatus: "error",
          answerText: "F004 is an under-voltage",
          evidence: [{ citationId: "1", sourceTitle: "ghost", page: 3, docId: "d", fileId: "f" }],
          basis: "general_reasoning",
        },
        { id: "t2", question: "later q", answerStatus: "answered", answerText: "later a", evidence: [] },
      ],
    });
    askNotebook.mockResolvedValueOnce({ answer: "next", citations: [], status: "answered" });
    mount();
    await screen.findByText("Stopped");
    expect(screen.getByText("F004 is an under-voltage")).toBeTruthy();
    expect(screen.queryByText(/1 · ghost/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Citation 1" })).toBeNull();
    expect(screen.queryByText(/General guidance/)).toBeNull();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();

    fireEvent.change(await composer(), { target: { value: "next question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("next");
    const h = JSON.stringify((askNotebook.mock.calls.at(-1)?.[3] as AskOpts).history ?? []);
    expect(h).not.toContain("under-voltage");
    expect(h).not.toContain("explain F004");
    expect(h).toContain("later q");
    expect(h).toContain("later a");
  });

  it("STRM-2 reload: a persisted error+null turn renders the existing error copy, never Stopped", async () => {
    getNotebookDetail.mockResolvedValue({
      ...detail(),
      turns: [{ id: "t1", question: "what tripped?", answerStatus: "error", answerText: null, evidence: [] }],
    });
    mount();
    await screen.findByText("Something went wrong answering that — try again.");
    expect(screen.queryByText("Stopped")).toBeNull();
  });
});
