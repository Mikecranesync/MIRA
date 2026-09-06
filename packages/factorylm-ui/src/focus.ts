/*
 * Commodity-before-custom escalation note (.claude/rules/commodity-before-custom.md)
 * — this file is a hand-rolled focus trap + focus-return, ~60 lines, which the
 * rule flags as commodity mechanics. Alternatives evaluated 2026-09-06:
 * react-focus-lock (MIT), focus-trap-react (MIT), @radix-ui/react-dialog (MIT).
 * Deferred, not rejected: the shared package must stay dependency-light for the
 * Hub, mobile (Capacitor WebView) and public-web hosts, and the swap changes the
 * overlay DOM the lab e2e contract asserts on. Tracked as a follow-up issue on
 * the FLM-UI-4000 initiative; until then the trap is covered by the focus and
 * BACK-precedence tests in __tests__/mobile-behavior.test.tsx.
 */
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

/**
 * Keeps Tab / Shift+Tab inside `root`. Returns true when the event was
 * handled (focus moved and default prevented).
 */
export function trapTab(event: KeyboardEvent, root: HTMLElement): boolean {
  if (event.key !== "Tab") return false;
  const focusable = focusableWithin(root);
  if (focusable.length === 0) return false;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const inside = active !== null && root.contains(active);

  let target: HTMLElement | null = null;
  if (!inside) target = first;
  else if (event.shiftKey && active === first) target = last;
  else if (!event.shiftKey && active === last) target = first;
  if (!target) return false;

  event.preventDefault();
  target.focus();
  return true;
}

/**
 * When `active` turns on after mount, remembers the element that had focus,
 * moves focus into `root`; when it turns off, restores focus to that element.
 * A layer that is already active at mount never steals focus: there is no
 * opening control to return to.
 */
export function useFocusReturn(active: boolean, root: RefObject<HTMLElement | null>): void {
  const wasActive = useRef<boolean | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previous = wasActive.current;
    wasActive.current = active;
    if (previous === null) return;

    if (active && !previous) {
      const current = document.activeElement;
      opener.current = current instanceof HTMLElement ? current : null;
      const first = root.current ? focusableWithin(root.current)[0] : undefined;
      first?.focus();
      return;
    }

    if (!active && previous) {
      const target = opener.current;
      opener.current = null;
      if (target && target.isConnected) target.focus();
    }
  }, [active, root]);
}
