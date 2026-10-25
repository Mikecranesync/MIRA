/**
 * #4620: the clearance a followed sent turn keeps above the sticky composer is
 * the composer's measured height, not a fixed 8rem. The composer grows with
 * the sync banner, send errors, pending attachments and the safe-area inset.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { renderHarness, type HarnessView } from "./harness";

type Callback = (entries: unknown[]) => void;
const observers: { callback: Callback; targets: Element[]; disconnected: boolean }[] = [];
const OriginalRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

beforeEach(() => {
  observers.length = 0;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    private record: { callback: Callback; targets: Element[]; disconnected: boolean };
    constructor(callback: Callback) { this.record = { callback, targets: [], disconnected: false }; observers.push(this.record); }
    observe(target: Element) { this.record.targets.push(target); }
    disconnect() { this.record.disconnected = true; }
    unobserve() {}
  };
});

const views: HarnessView[] = [];
afterEach(() => {
  views.splice(0).forEach((view) => view.cleanup());
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = OriginalRO;
});

function composerObserver() {
  return observers.find((o) => o.targets.some((t) => t.classList.contains("fl-composer")));
}

describe("#4620 composer clearance follows the composer's real height", () => {
  it("publishes the measured composer height on the shell as --fl-composer-block-size", () => {
    const view = renderHarness({ surface: "mobile", fixture: "offline-sync", conversationSurface: "assistant" });
    views.push(view);
    const form = view.container.querySelector<HTMLElement>(".fl-composer")!;
    const shell = view.container.querySelector<HTMLElement>(".fl-shell")!;
    expect(form).not.toBeNull();
    const observer = composerObserver();
    expect(observer).toBeDefined();
    form.getBoundingClientRect = () => ({ height: 183.4 } as DOMRect);
    act(() => { observer!.callback([]); });
    expect(shell.style.getPropertyValue("--fl-composer-block-size")).toBe("184px");
    form.getBoundingClientRect = () => ({ height: 96 } as DOMRect);
    act(() => { observer!.callback([]); });
    expect(shell.style.getPropertyValue("--fl-composer-block-size")).toBe("96px");
  });

  it("stops observing when the composer goes away", () => {
    const view = renderHarness({ surface: "mobile", fixture: "grounded-answer", conversationSurface: "assistant" });
    const observer = composerObserver();
    expect(observer).toBeDefined();
    view.cleanup();
    expect(observer!.disconnected).toBe(true);
  });
});
