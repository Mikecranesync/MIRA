/**
 * #3707 — the Hub's token copy is generated from the theme package and must
 * (1) never drift from it, (2) contain nothing but custom properties on
 * `:root` (so loading it globally cannot restyle the Hub), and (3) declare
 * every `--fl-*` name the V3 surface consumes. The runtime side of this
 * contract is tests/e2e/tokens-loaded.spec.ts.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../..");
const COPY = readFileSync(resolve(here, "tokens.css"), "utf8");
const SOURCE = readFileSync(resolve(REPO, "packages/factorylm-theme/src/tokens.css"), "utf8");
const HEADER =
  "/* GENERATED — do not edit. Source: packages/factorylm-theme/src/tokens.css\n" +
  " * Regenerate: python tools/design/sync_hub_tokens.py\n" +
  " * Drift guard: mira-hub/src/factorylm-ui/tokens.test.ts (#3707) */\n";

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const declared = (css: string) =>
  new Set(Array.from(stripComments(css).matchAll(/(--fl-[a-z0-9-]+)\s*:/g), (m) => m[1]));

describe("Hub token copy (generated from packages/factorylm-theme)", () => {
  it("is exactly the generator header plus the theme source — no drift, no hand edits", () => {
    expect(COPY).toBe(HEADER + SOURCE);
  });

  it("contains only :root custom-property declarations, so loading it globally restyles nothing", () => {
    const body = stripComments(COPY);
    const selectors = Array.from(body.matchAll(/^\s*([^{}\n]+)\{/gm), (m) => m[1].trim());
    expect(selectors).toEqual([":root"]);
    const declarations = Array.from(body.matchAll(/^\s*([a-zA-Z-]+[a-zA-Z0-9-]*)\s*:/gm), (m) => m[1]);
    expect(declarations.length).toBeGreaterThan(50);
    expect(declarations.filter((d) => !d.startsWith("--fl-"))).toEqual([]);
  });

  it("declares every --fl-* name the V3 surface consumes", () => {
    const v3 = readFileSync(resolve(REPO, "mira-hub/src/app/v3/v3.css"), "utf8");
    const used = new Set(Array.from(v3.matchAll(/var\((--fl-[a-z0-9-]+)/g), (m) => m[1]));
    expect(used.size).toBeGreaterThan(0);
    const have = declared(COPY);
    expect(Array.from(used).filter((n) => !have.has(n))).toEqual([]);
  });
});
