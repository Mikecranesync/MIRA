/**
 * #5068: a long manual URL in the "possible manual" status line made the whole thread wider than a
 * phone screen. The geometry proof is apps/factorylm-ui-lab/e2e/phone-overflow.browser.ts (real
 * Chromium at 412/360px); these pins keep the rule that fixes it, and its reach, from regressing.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const conversationCss = readFileSync(new URL("../conversation.css", import.meta.url), "utf8");
const partsSource = readFileSync(new URL("../parts.tsx", import.meta.url), "utf8");
/** The declarations of the first rule whose selector is exactly `selector`. */
const rule = (css: string, selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? null;

describe("#5068 long identifiers wrap inside the conversation", () => {
  it("every conversation part may shrink and break a long token anywhere", () => {
    const part = rule(conversationCss, ".fl-part");
    expect(part).not.toBeNull();
    // `anywhere` (not `break-word`) is the value that lowers min-content width, which is what
    // stops one token from widening the grid track the whole thread sits in.
    expect(part!).toMatch(/overflow-wrap:\s*anywhere/);
    expect(part!).toMatch(/min-inline-size:\s*0/);
  });
  it("the status line and answer text both carry .fl-part, so the rule reaches them", () => {
    const status = partsSource.slice(partsSource.indexOf("function ManualSearchStatusPart"));
    expect(status).toMatch(/className="fl-part fl-status"/);
    expect(partsSource).toMatch(/className=\{?["`]fl-part fl-part--text/);
  });
  it("control: nothing re-enables nowrap or break-normal on parts", () => {
    expect(conversationCss).not.toMatch(/\.fl-(part|status)[^{]*\{[^}]*(white-space:\s*nowrap|overflow-wrap:\s*normal)/);
  });
});
