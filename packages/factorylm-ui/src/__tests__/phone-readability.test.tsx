/**
 * Phone readability fixes from the 2026-10-21 grumpy walk at 390px
 * (#4613, #4614, #4615, #4616). Desktop is untouched: every size change lives
 * inside the existing `max-width: 48rem` phone block.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

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
    expect(phone).toMatch(/\.fl-shell\s*\{[^}]*--fl-workspace-fs-body:\s*1rem/s);
    expect(phone).toMatch(/\.fl-shell\s*\{[^}]*--fl-workspace-fs-sm:\s*0\.875rem/s);
    expect(phone).toMatch(/\.fl-shell\s*\{[^}]*--fl-workspace-fs-xs:\s*0\.8125rem/s);
    // Control: the desktop rules outside the phone block do not override the scale.
    expect(shellCss.replace(phone, "")).not.toMatch(/--fl-workspace-fs-(body|sm|xs):/);
  });
});

describe("#4614 phone drawer width", () => {
  it("opens the drawer to ~85% of a phone screen, not 18rem", () => {
    const phone = phoneBlock(shellCss);
    expect(phone).toMatch(/\.fl-shell__sidebar\s*\{[^}]*inline-size:\s*min\(22rem,\s*85vw\)/s);
    expect(phone).not.toMatch(/inline-size:\s*min\(18rem/);
  });
});

describe("#4615 manual link tap target", () => {
  it("renders the manual link with a class that is a 44px tap target", () => {
    expect(partsSource).toMatch(/className="fl-manual-link"[^>]*>Open website to find the manual/);
    expect(conversationCss).toMatch(/\.fl-manual-link\s*\{[^}]*min-block-size:\s*max\(2\.75rem,\s*44px\)/s);
  });
});

describe("#4616 composer focus ring", () => {
  it("draws one focus ring on the composer row, not a second one on the textarea inside it", () => {
    expect(conversationCss).toMatch(/\.fl-composer__row:focus-within\s*\{[^}]*outline:\s*2px solid/s);
    expect(conversationCss).not.toMatch(/\.fl-composer__row textarea:focus-visible\s*\{[^}]*outline:\s*2px/s);
  });
});
