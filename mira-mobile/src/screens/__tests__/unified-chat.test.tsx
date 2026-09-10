// @vitest-environment jsdom
// The unified FactoryLM shell renders THIS notebook's real turns and routes
// every action back to the screen-owned handlers (send, stop, citation viewer,
// attach flows). Run: cd mira-mobile && npx vitest run src/screens/__tests__/unified-chat
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UnifiedChat } from "../UnifiedChat";
import type { NotebookServerTurn } from "../../api/resources";
import { _resetTransientLayersForTest, closeTopTransientLayer } from "../../lib/transient-layer";
// jsdom ships no ResizeObserver or Element.scrollTo; the assistant-ui thread
// viewport (ADR-0037) uses both to keep the scroll pinned as content grows.
// The Android WebView has had them since Chrome 64 — test-environment shim only.
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

const CITATION = { citationId: "c1", sourceTitle: "G120 Operating Instructions", page: 418, quote: "Check the supply.", docId: "doc-1", fileId: null };

const TURN: NotebookServerTurn = {
  id: "row-1",
  question: "Why does F30001 trip?",
  answerStatus: "answered",
  answerText: "Check the supply first [1].",
  evidence: [CITATION],
  basis: "documents",
};

// A hard stop is not a graded answer: the adapter suppresses citation/basis
// chrome on this turn (FLEET-003), and the shell must render it as an alert.
const SAFETY_TURN: NotebookServerTurn = {
  id: "row-2",
  question: "How do I bypass the interlock?",
  answerStatus: "answered",
  answerText: "Stop.",
  evidence: [CITATION, { kind: "safety_notice", trigger: "bypass the interlock" }],
  basis: "documents",
};

function handlers() {
  return {
    onSend: vi.fn(),
    onStop: vi.fn(),
    onCitation: vi.fn(),
    onAttachPhoto: vi.fn(),
    onAttachFile: vi.fn(),
    onRetry: vi.fn(),
  };
}

const META = {
  notebookId: "nb-1",
  title: "Drive A",
  asset: { id: "asset-1", name: "Siemens G120" },
  identityConfirmed: true,
};

afterEach(() => {
  cleanup();
  _resetTransientLayersForTest();
});

describe("UnifiedChat", () => {
  it("renders the persisted turn through the shared shell with citation, basis, and safety parts", () => {
    const h = handlers();
    render(<UnifiedChat turns={[TURN, SAFETY_TURN]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={h} meta={META} />);

    expect(screen.getByRole("region", { name: "Conversation" })).toBeTruthy();
    expect(screen.getByText("Why does F30001 trip?")).toBeTruthy();
    const parts = Array.from(document.querySelectorAll<HTMLElement>('[data-turn-id="row-1-a"] [data-part-type]')).map((el) => el.dataset.partType);
    expect(parts).toContain("source");
    expect(parts).toContain("evidence_basis");
    const safetyParts = Array.from(document.querySelectorAll<HTMLElement>('[data-turn-id="row-2-a"] [data-part-type]')).map((el) => el.dataset.partType);
    expect(safetyParts).toContain("safety_notice");
    expect(safetyParts).not.toContain("source");
    expect(safetyParts).not.toContain("evidence_basis");
    expect(screen.getByRole("alert").textContent).toMatch(/stop/i);
    expect(document.querySelector(".fl-chip")?.textContent).toContain("Siemens G120");
    expect(document.querySelector(".fl-shell")?.getAttribute("data-navigation-visible")).toBe("false");
  });

  it("sends through the screen's send path and opens citations in the screen's viewer", () => {
    const h = handlers();
    render(<UnifiedChat turns={[TURN]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={h} meta={META} />);

    const box = screen.getByRole("textbox", { name: "Ask MIRA" }) as HTMLTextAreaElement;
    fireEvent.input(box, { target: { value: "What about braking?" } });
    fireEvent.submit(screen.getByRole("form", { name: "Composer" }));
    expect(h.onSend).toHaveBeenCalledWith("What about braking?");
    expect(box.value).toBe("");

    fireEvent.click(document.querySelector('button[data-part-type="source"]') as HTMLButtonElement);
    expect(h.onCitation).toHaveBeenCalledWith(expect.objectContaining({ citationId: "c1", sourceTitle: "G120 Operating Instructions", page: 418 }));
    expect(screen.queryByRole("dialog", { name: "Source viewer" })).toBeNull();
  });

  it("routes attach controls to the existing flows and exposes Stop while busy", () => {
    const h = handlers();
    const { rerender } = render(<UnifiedChat turns={[TURN]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={h} meta={META} />);
    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    fireEvent.click(screen.getByRole("button", { name: "Photo" }));
    expect(h.onAttachPhoto).toHaveBeenCalledTimes(1);

    rerender(<UnifiedChat turns={[TURN]} liveTurns={[]} pending={{ q: "next", a: { answer: "", citations: [], status: "streaming" } }} busy={true} canStop={true} canRetry={false} chatError={null} handlers={h} meta={META} />);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(h.onStop).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("[data-turn-id]").length).toBe(4);
  });

  it("registers an open shell layer with the app's BACK stack and closes it on BACK", () => {
    const h = handlers();
    render(<UnifiedChat turns={[TURN]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={h} meta={META} />);
    expect(closeTopTransientLayer()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(document.querySelector(".fl-shell")?.getAttribute("data-navigation-visible")).toBe("true");
    act(() => {
      expect(closeTopTransientLayer()).toBe(true);
    });
    expect(document.querySelector(".fl-shell")?.getAttribute("data-navigation-visible")).toBe("false");
    expect(closeTopTransientLayer()).toBe(false);
  });

  it("shows and clears honest screen-owned failure copy", () => {
    const h = handlers();
    const { rerender } = render(
      <UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError="The photo didn't upload — try again." handlers={h} meta={META} />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/photo didn't upload/i);
    rerender(
      <UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop={false} canRetry={false} chatError={null} handlers={h} meta={META} />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
