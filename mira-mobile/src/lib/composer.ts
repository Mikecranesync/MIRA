// Composer mechanics (CMPS-1 / CMPS-2), kept pure so the key contract and the
// retry body are unit-testable without a DOM.
//
// Key contract (hardware keyboards; the on-screen keyboard uses
// enterKeyHint="send" and never reaches onKeyDown with a real Enter):
//   Enter            → send
//   Shift+Enter      → newline (default textarea behavior)
//   Enter while IME composing (isComposing / keyCode 229) → newline-ish: the
//                      IME owns Enter to commit the candidate; never send.

export type ComposerKeyAction = "send" | "default";

export function composerKeyAction(e: {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): ComposerKeyAction {
  if (e.key !== "Enter") return "default";
  if (e.isComposing || e.keyCode === 229) return "default";
  if (e.shiftKey) return "default";
  return "send";
}

/** 1–6 rows. `field-sizing: content` (app.css) does this natively where the
 *  WebView supports it; this is the scrollHeight fallback for the rest. */
export const COMPOSER_MAX_ROWS = 6;

export function autoGrow(el: HTMLTextAreaElement, lineHeightPx: number): void {
  if ("fieldSizing" in el.style) return; // native auto-size — leave height alone
  el.style.height = "auto";
  const max = lineHeightPx * COMPOSER_MAX_ROWS;
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
}

/** The exact request the composer sent, kept so a Retry re-sends it
 *  byte-identically (same question, same scope, same mode, same history —
 *  NOT recomputed from state that may have moved on). */
export interface PendingSend {
  question: string;
  scope: string[];
  mode: "general" | undefined;
  history: { role: "user" | "assistant"; content: string }[];
}
