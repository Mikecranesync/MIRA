/**
 * Phone readability fixes from the 2026-10-21 grumpy walk at 390px
 * (#4613, #4614, #4615, #4616). Desktop is untouched: every size change lives
 * inside the existing `max-width: 48rem` phone block.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getFixture } from "@factorylm/interaction";
import { readFileSync } from "node:fs";
import { renderHarness, type HarnessView } from "./harness";

const shellCss = readFileSync(new URL("../shell.css", import.meta.url), "utf8");
const conversationCss = readFileSync(new URL("../conversation.css", import.meta.url), "utf8");
const partsSource = readFileSync(new URL("../parts.tsx", import.meta.url), "utf8");

/** The body of the first `@media (max-width: 48rem)` block in a stylesheet. */
function phoneBlock(css: string): string {
  const start = css.indexOf("@media (max-width: 48rem)");
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") { depth -= 1; if (depth === 0) return css.slice(start, i + 1); }
  }
  throw new Error("unterminated phone block");
}

describe("#4613 phone type scale", () => {
  it("raises body to 16px and labels/chips to at least 13px on phones only", () => {
    const phone = phoneBlock(shellCss);
    expect(phone).toMatch(/\.fl-shell\s*\{[^}]*--fl-workspace-fs-body:\s*16px/s);
    expect(phone).toMatch(/\.fl-shell\s*\{[^}]*--fl-workspace-fs-sm:\s*14px/s);
    expect(phone).toMatch(/\.fl-shell\s*\{[^}]*--fl-workspace-fs-xs:\s*13px/s);
    // Absolute px, never rem: the Hub sets a 14px root, so 1rem rendered body text at
    // 14px on staging, smaller than the 15px it replaced (staging check of 13d4608d1).
    expect(phone).not.toMatch(/--fl-workspace-fs-(body|sm|xs):\s*[0-9.]+rem/);
    // Control: the desktop rules outside the phone block do not override the scale.
    expect(shellCss.replace(phone, "")).not.toMatch(/--fl-workspace-fs-(body|sm|xs):/);
  });
});

describe("#4614 phone drawer width", () => {
  it("opens the drawer to ~85% of a phone screen, not 18rem", () => {
    const phone = phoneBlock(shellCss);
    expect(phone).toMatch(/\.fl-shell__sidebar\s*\{[^}]*inline-size:\s*min\(352px,\s*85vw\)/s);
    expect(phone).not.toMatch(/inline-size:\s*min\(18rem/);
  });
});

describe("#4562 sidebar search height", () => {
  it("makes the search box a 44px control like its neighbours", () => {
    expect(shellCss).toMatch(/\.fl-shell__search\s*\{[^}]*min-block-size:\s*max\(2\.75rem,\s*44px\)/s);
  });
});

describe("#4564 grounding pill legibility", () => {
  it("sets the pill at the secondary size in primary ink, not the label size in muted grey", () => {
    const pill = conversationCss.match(/\.fl-pill\s*\{([^}]*)\}/s)?.[1] ?? "";
    expect(pill).toMatch(/font-size:\s*var\(--fl-workspace-fs-sm\)/);
    expect(pill).toMatch(/color:\s*var\(--fl-workspace-ink\)/);
    expect(pill).not.toMatch(/--fl-workspace-muted/);
  });
});

describe("#4615 manual link tap target", () => {
  it("renders the manual link with a class that is a 44px tap target", () => {
    expect(partsSource).toMatch(/className="fl-manual-link"[^>]*>Open website to find the manual/);
    expect(conversationCss).toMatch(/\.fl-manual-link\s*\{[^}]*min-block-size:\s*max\(2\.75rem,\s*44px\)/s);
  });
});

describe("#4616 / #4621 composer focus ring", () => {
  const supportsBlock = (() => {
    const start = conversationCss.indexOf("@supports selector(:has(*))");
    if (start < 0) return "";
    let depth = 0;
    for (let i = conversationCss.indexOf("{", start); i < conversationCss.length; i += 1) {
      if (conversationCss[i] === "{") depth += 1;
      if (conversationCss[i] === "}") { depth -= 1; if (depth === 0) return conversationCss.slice(start, i + 1); }
    }
    return "";
  })();

  it("rings the row only while the textarea itself has focus, never for a focused button (#4621)", () => {
    expect(supportsBlock).toMatch(/\.fl-composer__row:has\(textarea:focus-visible\)\s*\{[^}]*outline:\s*2px solid/s);
    expect(supportsBlock).toMatch(/\.fl-composer__row textarea:focus-visible\s*\{[^}]*outline:\s*none/s);
    expect(conversationCss).not.toMatch(/\.fl-composer__row:focus-within\s*\{[^}]*outline/s);
  });

  it("keeps the textarea's own ring where :has() is unsupported (control: focus is never invisible)", () => {
    const outside = conversationCss.replace(supportsBlock, "");
    expect(outside).toMatch(/\.fl-composer__row textarea:focus-visible\s*\{[^}]*outline:\s*2px solid/s);
  });
});

/*
 * #4616 follow-on-send. In a real browser the thread viewport grows to its
 * content and the DOCUMENT scrolls (lab, 390x844: html scrollHeight 1736 vs
 * 844; .fl-thread__viewport scrollHeight == clientHeight), so assistant-ui's
 * viewport autoscroll has nothing to move. The thread therefore brings a newly
 * sent technician turn into view itself, through every scrolling ancestor.
 */
describe("#4616 follow the technician's new turn", () => {
  const views: HarnessView[] = [];
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  beforeEach(() => {
    scrolled.length = 0;
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.getAttribute("data-turn-id") ?? ""); };
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
    views.splice(0).forEach((view) => view.cleanup());
  });

  function setup() {
    const view = renderHarness({ surface: "web", fixture: "grounded-answer", conversationSurface: "assistant" });
    views.push(view);
    return view;
  }
  const base = getFixture("grounded-answer").thread;
  const userTurn = (id: string) => ({ ...base.turns[0], id, role: "user" as const, parts: [{ type: "text" as const, text: "What does F30001 mean?" }] });
  const assistantTurn = (id: string) => ({ ...base.turns[0], id, role: "assistant" as const, parts: [{ type: "text" as const, text: "Overcurrent." }] });

  it("stops the followed turn above the sticky composer", () => {
    expect(conversationCss).toMatch(/\.fl-turn--aui\s*\{[^}]*scroll-margin-block-end:\s*calc\(var\(--fl-composer-block-size,\s*8rem\)/s);
  });

  it("does not scroll on first render (control)", async () => {
    setup();
    await frames();
    expect(scrolled).toEqual([]);
  });

  const frames = async (n = 12) => { for (let i = 0; i < n; i += 1) await new Promise((r) => requestAnimationFrame(() => r(null))); };

  it("scrolls the new user turn into view when one is appended to the same thread", async () => {
    const view = setup();
    view.dispatch({ type: "hydrate", data: { thread: { ...base, turns: [...base.turns, userTurn("turn-sent-1")] } } });
    await frames();
    expect(scrolled).toContain("turn-sent-1");
  });

  it("does not yank the reader when only an assistant turn is appended (control)", async () => {
    const view = setup();
    view.dispatch({ type: "hydrate", data: { thread: { ...base, turns: [...base.turns, assistantTurn("turn-answer-1")] } } });
    await frames();
    expect(scrolled).toEqual([]);
  });

  it("does not treat opening a different thread as a send (control)", async () => {
    const view = setup();
    view.dispatch({ type: "hydrate", data: { thread: { ...base, id: "thread-other", turns: [userTurn("turn-other-1")] } } });
    await frames();
    expect(scrolled).toEqual([]);
  });
});
