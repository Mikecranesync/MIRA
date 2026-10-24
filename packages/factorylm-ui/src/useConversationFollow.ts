import { useEffect, useRef } from "react";
import type { InteractionThread } from "@factorylm/interaction";

/** Follow the conversation across nested viewports and document-scrolling hosts.
 * A scroll away pauses answer following; opening a thread or sending re-arms it.
 */
export function useConversationFollow<T extends HTMLElement = HTMLElement>(thread: InteractionThread, sendRevision = 0) {
  const rootRef = useRef<T>(null);
  const following = useRef(true);
  const positions = useRef(new WeakMap<HTMLElement, number>());
  const previous = useRef<{ id: string; sendRevision: number } | null>(null);

  useEffect(() => {
    const onScroll = (event: Event) => {
      const root = rootRef.current;
      const target = event.target === document
        ? document.scrollingElement ?? document.documentElement
        : event.target;
      if (!root || !(target instanceof HTMLElement)) return;
      if (target !== document.documentElement && target !== document.body &&
          !target.contains(root) && !root.contains(target)) return;
      // Ignore non-scrolling elements and unrelated nested cards/PDF viewers.
      if (target.scrollHeight <= target.clientHeight ||
          (root.contains(target) && target !== root && !target.classList.contains("fl-thread__viewport"))) return;
      const previousTop = positions.current.get(target);
      positions.current.set(target, target.scrollTop);
      let atLatest: boolean;
      const latest = root.querySelectorAll<HTMLElement>("[data-turn-id]");
      const rect = latest.item(latest.length - 1)?.getBoundingClientRect();
      if (rect && rect.height > 0) {
        // The latest turn stops ABOVE the composer, not at the document end.
        // Test its actual clipping ancestors rather than the page's bottom gap.
        let bottom = window.innerHeight;
        for (let node: HTMLElement | null = latest.item(latest.length - 1)?.parentElement; node; node = node.parentElement) {
          if (node !== document.body && node !== document.documentElement &&
              /auto|scroll|hidden/.test(getComputedStyle(node).overflowY)) {
            bottom = Math.min(bottom, node.getBoundingClientRect().bottom);
          }
        }
        const composer = root.closest(".fl-shell")?.querySelector(".fl-composer")?.getBoundingClientRect();
        if (composer && composer.top > 0 && composer.top < bottom) bottom = composer.top;
        atLatest = rect.bottom <= bottom + 32 && rect.bottom > 0;
      } else {
        atLatest = target.scrollHeight - target.clientHeight - target.scrollTop <= 32;
      }
      // Content growth and browser anchoring also emit scroll events. Only an
      // upward movement away from latest pauses following, not those events.
      if (atLatest) following.current = true;
      else if (previousTop !== undefined && target.scrollTop < previousTop - 1) following.current = false;
    };
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  useEffect(() => {
    const old = previous.current;
    const changedThread = !old || old.id !== thread.id;
    const sent = !changedThread && old.sendRevision !== sendRevision;
    previous.current = { id: thread.id, sendRevision };
    if (changedThread || sent) following.current = true;
    if (changedThread) positions.current = new WeakMap();
    const last = thread.turns.at(-1);
    if (!last) return;
    let frame = 0;
    let attempts = 0;
    let observed: HTMLElement | undefined;
    let composerObserved: HTMLElement | undefined;
    const resize = new ResizeObserver(() => schedule());
    const follow = () => {
      const node = rootRef.current?.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(last.id)}"]`);
      if (node) {
        if (observed !== node) { if (observed) resize.unobserve(observed); resize.observe(node); observed = node; }
        // The composer grows with pending attachments, send errors and the
        // sync banner (#4620's --fl-composer-block-size), which can clip the
        // latest turn without the turn, the thread or the window changing
        // size (#4710). It is outside the mutation-observed subtree, so it
        // needs its own resize watch. Re-query every call, like the turn node
        // above: a remount (route/shell swap) would otherwise leave this
        // watching a detached element until the next turn/thread change (#4714).
        const composer = rootRef.current?.closest<HTMLElement>(".fl-shell")?.querySelector<HTMLElement>(".fl-composer") ?? undefined;
        if (composer !== composerObserved) {
          if (composerObserved) resize.unobserve(composerObserved);
          if (composer) resize.observe(composer);
          composerObserved = composer;
        }
        if (following.current) {
          node.scrollIntoView({ block: "end", behavior: "instant" });
          // Seed even when already at latest: no browser scroll event is then
          // emitted, but the first PageUp/scrollbar movement must still pause.
          for (let parent: HTMLElement | null = node.parentElement; parent; parent = parent.parentElement) {
            positions.current.set(parent, parent.scrollTop);
          }
        }
      }
      else if (++attempts < 10) frame = requestAnimationFrame(follow);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(follow);
    };
    // assistant-ui commits its converted message after the shell state changes.
    // Observe actual content commits too, including growth of the same turn ID.
    const observer = new MutationObserver(schedule);
    if (rootRef.current) observer.observe(rootRef.current, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    schedule();
    return () => {
      observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [thread.id, thread.turns, sendRevision]);
  return rootRef;
}
