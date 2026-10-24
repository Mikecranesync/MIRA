/** #4680: preserve intentional reading position while following new content. */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getFixture } from "@factorylm/interaction";
import { renderHarness, type HarnessView } from "./harness";
const base = getFixture("grounded-answer").thread;
const turn = (id: string, role: "user" | "assistant", text = "Diagnostic answer") => ({
  ...base.turns[0], id, role, parts: [{ type: "text" as const, text }],
});
const frames = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
};
for (const surface of ["classic", "assistant"] as const) {
  describe(`#4680 ${surface} conversation follow`, () => {
    let view: HarnessView | undefined;
    let position = 0;
    let height = 2000;
    const scrolled: string[] = [];
    const originalScroll = Element.prototype.scrollIntoView;
    const originals = new Map<string, PropertyDescriptor | undefined>();
    beforeEach(() => {
      position = 0; height = 2000; scrolled.length = 0;
      for (const [key, get] of Object.entries({ scrollHeight: (): number => height, clientHeight: (): number => 600, scrollTop: (): number => position })) {
        originals.set(key, Object.getOwnPropertyDescriptor(document.documentElement, key));
        Object.defineProperty(document.documentElement, key, { configurable: true, get });
      }
      originals.set("scrollingElement", Object.getOwnPropertyDescriptor(document, "scrollingElement"));
      Object.defineProperty(document, "scrollingElement", { configurable: true, get: () => document.documentElement });
      Element.prototype.scrollIntoView = function () {
        const id = this.getAttribute("data-turn-id");
        if (id) scrolled.push(id);
        position = height - 600;
        document.dispatchEvent(new Event("scroll"));
      };
    });
    afterEach(() => {
      view?.cleanup(); view = undefined;
      Element.prototype.scrollIntoView = originalScroll;
      for (const [key, descriptor] of originals) {
        const target = key === "scrollingElement" ? document : document.documentElement;
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else Reflect.deleteProperty(target, key);
      }
      originals.clear();
    });
    async function setup(empty = false) {
      view = renderHarness({ surface: "web", fixture: "grounded-answer", conversationSurface: surface,
        transformFixture: (fixture) => ({ ...fixture, thread: { ...fixture.thread, turns: empty ? [] : base.turns } }),
      });
      await frames();
    }
    function scrollTo(top: number) {
      position = top;
      document.dispatchEvent(new Event("scroll"));
    }
    function hydrate(turns: typeof base.turns, id = base.id) {
      view!.dispatch({ type: "hydrate", data: { thread: { ...base, id, turns } } });
    }
    it("opens populated conversations at latest", async () => {
      await setup(); expect(scrolled).toContain(base.turns.at(-1)!.id);
    });
    it("opens switched threads at latest", async () => {
      await setup(); scrollTo(0); scrolled.length = 0;
      hydrate([turn("other-question", "user"), turn("other-answer", "assistant")], "other-thread");
      await frames(); expect(scrolled).toContain("other-answer");
    });
    it("follows a sent user turn even after reading older messages", async () => {
      await setup(); scrollTo(0); scrolled.length = 0;
      hydrate([...base.turns, turn("sent-question", "user")]);
      await frames(); expect(scrolled).toContain("sent-question");
    });
    it("follows a batched user and assistant append after reading older messages", async () => {
      await setup(); scrollTo(0); scrolled.length = 0;
      hydrate([...base.turns, turn("sent-question", "user"), turn("new-answer", "assistant")]);
      await frames(); expect(scrolled).toContain("new-answer");
    });
    it("follows an appended answer when reading latest", async () => {
      await setup(); scrollTo(height - 600); scrolled.length = 0; height += 400;
      hydrate([...base.turns, turn("new-answer", "assistant")]);
      await frames(); expect(scrolled).toContain("new-answer");
    });
    it("follows same-turn streamed content", async () => {
      await setup(); hydrate([...base.turns, turn("stream-answer", "assistant", "First chunk")]); await frames();
      scrollTo(height - 600); scrolled.length = 0; height += 400;
      hydrate([...base.turns, turn("stream-answer", "assistant", "First chunk, now continued")]);
      await frames(); expect(scrolled).toContain("stream-answer");
    });
    it("does not yank a reader deliberately scrolled up", async () => {
      await setup(); scrollTo(100); scrolled.length = 0;
      hydrate([...base.turns, turn("unread-answer", "assistant")]);
      await frames(); expect(scrolled).toEqual([]); expect(position).toBe(100);
    });
    it("honors the first upward scroll even when initial follow emits no scroll event", async () => {
      Element.prototype.scrollIntoView = function () {
        const id = this.getAttribute("data-turn-id");
        if (id) scrolled.push(id);
        position = height - 600;
      };
      await setup();
      scrollTo(100); scrolled.length = 0;
      hydrate([...base.turns, turn("first-away-answer", "assistant")]);
      await frames(); expect(scrolled).toEqual([]); expect(position).toBe(100);
    });
    it("does not yank older content when the same answer streams", async () => {
      await setup();
      hydrate([...base.turns, turn("stream-answer", "assistant", "First chunk")]); await frames();
      scrollTo(100); scrolled.length = 0;
      hydrate([...base.turns, turn("stream-answer", "assistant", "First chunk plus continuation")]);
      await frames(); expect(scrolled).toEqual([]); expect(position).toBe(100);
    });
    it("honors deliberate scrolling in a constrained conversation container", async () => {
      await setup();
      const container = view!.container.querySelector<HTMLElement>(".fl-thread__viewport, .fl-conversation")!;
      let containerTop = 1400;
      container.style.overflowY = "auto";
      Object.defineProperties(container, {
        scrollHeight: { configurable: true, get: () => 2000 },
        clientHeight: { configurable: true, get: () => 600 },
        scrollTop: { configurable: true, get: () => containerTop },
      });
      container.dispatchEvent(new Event("scroll"));
      containerTop = 100;
      container.dispatchEvent(new Event("scroll"));
      scrolled.length = 0;
      hydrate([...base.turns, turn("container-answer", "assistant")]);
      await frames(); expect(scrolled).toEqual([]); expect(containerTop).toBe(100);
    });
    it("resumes follow after returning to bottom", async () => {
      await setup(); scrollTo(100);
      hydrate([...base.turns, turn("answer", "assistant", "First chunk")]); await frames();
      scrollTo(height - 600); scrolled.length = 0; height += 400;
      hydrate([...base.turns, turn("answer", "assistant", "First chunk plus continuation")]);
      await frames(); expect(scrolled).toContain("answer");
    });
    it("leaves empty threads alone", async () => {
      await setup(true); expect(scrolled).toEqual([]);
    });
  });
}
