// @vitest-environment jsdom
// #3996 — a photo send hands the question to the host only after the upload
// (`attachments.compose` → LOOK) resolves, so the draft and chip vanished and
// nothing showed in the conversation for ~5–18 s on a real Pixel. The question
// must appear as a pending turn as soon as Send accepts it, and must not be
// duplicated or left behind once the host's own pending turn takes over or the
// upload fails.
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/unified-chat-photo-send-pending-turn
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
vi.mock("../../api/manual-search-status", () => ({ fetchManualSearchStatus: vi.fn(async () => null) }));

type Composed = { question: string; rider?: unknown; failure?: string };
const { composeMock, hasCarriedMock } = vi.hoisted(() => ({
  composeMock: vi.fn(async (text: string) => ({ question: text }) as Composed),
  hasCarriedMock: vi.fn(() => true),
}));
vi.mock("../../unified/attachments", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../unified/attachments")>();
  return {
    ...real,
    useUnifiedAttachments: () => ({
      attachPhoto: vi.fn(),
      attachCamera: vi.fn(),
      attachFile: vi.fn(),
      compose: composeMock,
      stashForHandoff: vi.fn(),
      hasCarried: hasCarriedMock,
      hasRetained: vi.fn(() => false),
    }),
  };
});

import { UnifiedChat } from "../UnifiedChat";
import type { ChatTurn } from "../../lib/sse";

const NB = "nb-1";
const QUESTION = "What does this drawing tell you?";
const EMPTY_TURN: ChatTurn = { answer: "", citations: [], status: "" };
const RIDER = { visualEvidence: { fileId: "f1", capturedAt: "2026-10-24T00:00:00Z" } };

function element(pending: { q: string; a: ChatTurn } | null, onSend: (...args: unknown[]) => void) {
  return (
    <UnifiedChat
      turns={[]}
      liveTurns={[]}
      pending={pending}
      busy={false}
      canStop
      canRetry
      chatError={null}
      handlers={{ onSend, onStop: () => {}, onRetry: () => {}, onCitation: () => {} }}
      meta={{ notebookId: NB, threadId: "notebook-nb-1:thread-legacy", title: "CV-101", identityConfirmed: false }}
    />
  );
}

/** The question rendered as a conversation turn (the composer's restored draft does not count). */
const questionsShown = () => screen.queryAllByText(QUESTION).filter((e) => e.closest("[data-turn-id]")).length;

async function send() {
  const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: QUESTION } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
    await Promise.resolve();
  });
  return input;
}

afterEach(() => {
  cleanup();
  composeMock.mockReset();
  composeMock.mockImplementation(async (text: string) => ({ question: text }));
  hasCarriedMock.mockReset();
  hasCarriedMock.mockReturnValue(true);
});

describe("UnifiedChat — a photo send shows the question while the photo uploads (#3996)", () => {
  it("shows the question as soon as Send accepts it, before the upload resolves", async () => {
    let finish!: (c: Composed) => void;
    composeMock.mockImplementationOnce(() => new Promise<Composed>((resolve) => { finish = resolve; }));
    const onSend = vi.fn();
    render(element(null, onSend));
    expect(questionsShown()).toBe(0);

    await send();
    expect(onSend).not.toHaveBeenCalled();
    expect(questionsShown()).toBe(1);

    await act(async () => {
      finish({ question: QUESTION, rider: RIDER });
      await Promise.resolve();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("once the host shows its own pending turn, the question appears exactly once", async () => {
    let finish!: (c: Composed) => void;
    composeMock.mockImplementationOnce(() => new Promise<Composed>((resolve) => { finish = resolve; }));
    const onSend = vi.fn();
    const view = render(element(null, onSend));
    await send();
    await act(async () => {
      finish({ question: QUESTION, rider: RIDER });
      await Promise.resolve();
    });
    view.rerender(element({ q: QUESTION, a: EMPTY_TURN }, onSend));
    expect(questionsShown()).toBe(1);
  });

  it("control: a failed upload removes the temporary turn and puts the question back in the composer", async () => {
    let finish!: (c: Composed) => void;
    composeMock.mockImplementationOnce(() => new Promise<Composed>((resolve) => { finish = resolve; }));
    const onSend = vi.fn();
    render(element(null, onSend));
    const input = await send();
    expect(questionsShown()).toBe(1);

    await act(async () => {
      finish({ question: QUESTION, failure: "Could not upload the photo." });
      await Promise.resolve();
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(questionsShown()).toBe(0);
    expect(input.value).toBe(QUESTION);
    await screen.findByText(/Could not upload the photo\./);
  });

  it("control: a plain text send (nothing attached) is unchanged — handed straight to the host", async () => {
    hasCarriedMock.mockReturnValue(false);
    const onSend = vi.fn();
    render(element(null, onSend));
    await send();
    expect(composeMock).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith(QUESTION);
  });
});
