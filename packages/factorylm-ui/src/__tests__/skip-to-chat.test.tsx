import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { act } from "react";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
beforeEach(() => {
  (window as unknown as { happyDOM: { setViewport(viewport: { width: number }): void } }).happyDOM.setViewport({ width: 1280 });
});
afterEach(() => {
  mock.restore();
  views.splice(0).forEach((view) => view.cleanup());
  (window as unknown as { happyDOM: { setViewport(viewport: { width: number }): void } }).happyDOM.setViewport({ width: 1280 });
});

for (const conversationSurface of ["classic", "assistant"] as const) {
  describe(`${conversationSurface}: Skip to chat (#4796)`, () => {
    it("routes only the first plain body Tab, leaving modified, prevented and focused-control events alone", () => {
      const view = renderHarness({ surface: "web", fixture: "grounded-answer", conversationSurface });
      views.push(view);
      const skip = view.buttonNamed("Skip to chat")!;
      const input = view.container.querySelector<HTMLTextAreaElement>('.fl-composer textarea')!;
      // Happy DOM has no layout; expose only the skip button as a visible
      // document control. Actual browser geometry remains covered by the spec.
      skip.style.visibility = "visible";
      spyOn(skip, "getClientRects").mockReturnValue([new DOMRect(0, 0, 44, 44)] as unknown as DOMRectList);
      act(() => input.focus());
      const focusedTab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      act(() => input.dispatchEvent(focusedTab));
      expect(focusedTab.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(input);
      act(() => input.blur());

      for (const init of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, {}]) {
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, ...init });
        const childOwned = Object.keys(init).length === 0;
        if (childOwned) event.preventDefault();
        act(() => document.body.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(childOwned);
        expect(document.activeElement).toBe(document.body);
      }

      const firstTab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      act(() => document.body.dispatchEvent(firstTab));
      expect(firstTab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(skip);
      expect(document.activeElement).not.toBe(input);
      act(() => skip.blur());
      const secondTab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      act(() => document.body.dispatchEvent(secondTab));
      expect(secondTab.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(document.body);
    });

    it("leaves an earlier visible host control authoritative for the document's first Tab", () => {
      const hostControl = document.createElement("button");
      hostControl.textContent = "Host navigation";
      hostControl.style.visibility = "visible";
      document.body.prepend(hostControl);
      try {
        const view = renderHarness({ surface: "web", fixture: "grounded-answer", conversationSurface });
        views.push(view);
        const skip = view.buttonNamed("Skip to chat")!;
        skip.style.visibility = "visible";
        const rects = [new DOMRect(0, 0, 44, 44)] as unknown as DOMRectList;
        spyOn(hostControl, "getClientRects").mockReturnValue(rects);
        spyOn(skip, "getClientRects").mockReturnValue(rects);
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });

        act(() => document.body.dispatchEvent(event));

        expect(event.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(document.body);
      } finally {
        hostControl.remove();
      }
    });

    it("is the first shell button, focuses only its own composer on activation, and preserves the draft and context", () => {
      const first = renderHarness({ surface: "web", fixture: "project-tree", conversationSurface });
      const second = renderHarness({ surface: "web", fixture: "grounded-answer", conversationSurface });
      views.push(first, second);
      const firstInput = first.container.querySelector<HTMLTextAreaElement>('.fl-composer textarea')!;
      const input = second.container.querySelector<HTMLTextAreaElement>('.fl-composer textarea')!;
      expect(document.activeElement).not.toBe(firstInput);
      expect(document.activeElement).not.toBe(input);
      const skip = second.buttonNamed("Skip to chat");
      expect(skip).not.toBeNull();
      expect(second.container.querySelector(".fl-shell button")).toBe(skip);
      expect(skip!.disabled).toBe(false);
      second.type(input, "  Keep the exact question\nand spacing  ");
      const context = second.activeContext();
      const turns = second.outputs().turnCount;
      act(() => firstInput.focus());
      const focus = spyOn(input, "focus");

      second.click(skip!);

      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      focus.mockRestore();
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("  Keep the exact question\nand spacing  ");
      expect(second.outputs().draft).toBe("  Keep the exact question\nand spacing  ");
      expect(second.activeContext()).toEqual(context);
      expect(second.outputs().turnCount).toBe(turns);
    });

    it("disables the bypass for shell overlays and permits a static desktop inspector", () => {
      const view = renderHarness({ surface: "hub", fixture: "enterprise-inspector", conversationSurface });
      views.push(view);
      const skip = view.buttonNamed("Skip to chat");
      expect(skip).not.toBeNull();
      view.dispatch({ type: "set-inspector-visible", visible: true });
      expect(view.container.querySelector('[aria-label="Inspector"]')).not.toBeNull();
      expect(view.container.querySelector('.fl-scrim')).toBeNull();
      expect(skip!.disabled).toBe(false);
      view.click(skip!);
      expect(document.activeElement).toBe(view.container.querySelector('.fl-composer textarea'));

      view.dispatch({ type: "set-inspector-visible", visible: false });
      view.dispatch({ type: "set-attachment-menu-visible", visible: true });
      expect(skip!.disabled).toBe(true);
      const menuFocus = document.activeElement;
      view.click(skip!);
      expect(document.activeElement).toBe(menuFocus);
      view.dispatch({ type: "set-attachment-menu-visible", visible: false });
      const citation = view.container.querySelector('button[data-part-type="source"]');
      expect(citation).not.toBeNull();
      view.click(citation!);
      expect(skip!.disabled).toBe(true);
      view.dispatch({ type: "select-source", sourceId: null });
      act(() => {
        (window as unknown as { happyDOM: { setViewport(viewport: { width: number }): void } }).happyDOM.setViewport({ width: 390 });
      });
      expect(view.container.querySelector('.fl-scrim[data-layer="navigation"]')).not.toBeNull();
      expect(skip!.disabled).toBe(true);
      view.dispatch({ type: "set-navigation-visible", visible: false });
      expect(skip!.disabled).toBe(false);
      view.dispatch({ type: "set-inspector-visible", visible: true });
      expect(view.container.querySelector('[aria-label="Inspector"]')).not.toBeNull();
      expect(view.container.querySelector('.fl-scrim[data-layer="inspector"]')).not.toBeNull();
      expect(skip!.disabled).toBe(true);
    });

    it("does not steal focus from a native modal dialog", () => {
      const view = renderHarness({ surface: "web", fixture: "grounded-answer", conversationSurface });
      views.push(view);
      const skip = view.buttonNamed("Skip to chat");
      expect(skip).not.toBeNull();
      const dialog = document.createElement("dialog");
      const close = document.createElement("button");
      dialog.append(close);
      document.body.append(dialog);
      try {
        act(() => { dialog.showModal(); close.focus(); });
        view.click(skip!);
        expect(document.activeElement).toBe(close);
      } finally {
        dialog.close();
        dialog.remove();
      }
    });
  });
}
