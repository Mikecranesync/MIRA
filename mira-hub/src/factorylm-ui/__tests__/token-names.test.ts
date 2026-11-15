/**
 * Every `var(--fl-*)` the Hub adapter uses without a fallback must be a token the
 * shared theme defines. An undefined name makes the declaration invalid, so the
 * browser falls back to the inherited colour: on the tablet the Job sheet pill and
 * the Jobs panel took the Hub's light text onto a white panel (`--fl-text` was
 * never a theme token; primary text is `--fl-ink`).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ADAPTER = fileURLToPath(new URL("..", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const THEME_SOURCES = ["packages/factorylm-theme/src", "packages/factorylm-ui/src"];

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : files(p, ext);
    return ext.test(e.name) ? [p] : [];
  });
}

const defined = new Set(
  THEME_SOURCES.flatMap((d) => files(join(REPO, d), /\.css$/))
    .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/(--fl-[a-z0-9-]+)\s*:/g)].map((m) => m[1])),
);

describe("Hub adapter colour tokens", () => {
  it("finds the theme tokens", () => {
    expect(defined.has("--fl-ink")).toBe(true);
    expect(defined.has("--fl-surface")).toBe(true);
  });

  it("uses only tokens the theme defines when no fallback is given", () => {
    const undefinedUses = files(ADAPTER, /\.tsx?$/).flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/var\((--fl-[a-z0-9-]+)\)/g)]
        .filter((m) => !defined.has(m[1]))
        .map((m) => `${f.slice(ADAPTER.length)}: ${m[1]}`),
    );
    expect(undefinedUses).toEqual([]);
  });
});
