/**
 * #5332: the job sheet printed blank (or printed the app screen) whenever the
 * Work Packet panel was merely MOUNTED. Its print stylesheet hid `body *` on
 * paper unconditionally, so every other print copy on the page vanished. The
 * hide rules now apply only while the packet dialog is open.
 *
 * Run: npx vitest run src/factorylm-ui/work-packet-print-scope.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRINT_CSS } from "./WorkPacketPanel";

const SCOPE = 'body:has(dialog[data-testid="wp-dialog"][open])';

function printBlock(css: string): string {
  const start = css.indexOf("@media print {");
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("unterminated @media print");
}

/** Selector lists of every rule inside @media print that sets the given declaration. */
function selectorsSetting(block: string, decl: RegExp): string[][] {
  const inner = block.slice(block.indexOf("{") + 1, -1).replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[][] = [];
  for (const m of inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (decl.test(m[2])) out.push(m[1].split(",").map((s) => s.trim()));
  }
  return out;
}

describe("#5332 — the Work Packet print stylesheet only takes over the page while its dialog is open", () => {
  it("every print rule that hides content is scoped to the open packet dialog", () => {
    const hiding = selectorsSetting(printBlock(PRINT_CSS), /visibility\s*:\s*hidden/);
    expect(hiding.length).toBeGreaterThan(0);
    for (const list of hiding) for (const sel of list) expect(sel.startsWith(SCOPE)).toBe(true);
  });

  it("the re-show rules carry the same scope, so they never fight another print copy", () => {
    const showing = selectorsSetting(printBlock(PRINT_CSS), /visibility\s*:\s*visible/);
    expect(showing.flat().length).toBeGreaterThan(0);
    for (const sel of showing.flat()) expect(sel.startsWith(SCOPE)).toBe(true);
  });

  it("the scope names the dialog the panel actually renders, and only an OPEN one", () => {
    expect(SCOPE).toContain("[open]");
    const source = readFileSync(join(__dirname, "WorkPacketPanel.tsx"), "utf8");
    expect(source).toMatch(/<dialog[\s\S]{0,200}data-testid="wp-dialog"/);
  });
});
