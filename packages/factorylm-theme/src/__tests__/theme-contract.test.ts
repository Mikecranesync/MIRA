import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { THEME_NAMES } from "@factorylm/theme";

const PACKAGE_ROOT = new URL("../../", import.meta.url);
const WORKSPACE_CSS = new URL("../workspace.css", import.meta.url);
const requiredRoles = [
  "bg", "surface", "surface-hi", "header", "header-ink", "header-muted",
  "ink", "muted", "faint", "line", "line-strong", "accent", "accent-hover",
  "accent-tint", "accent-ink", "accent-line", "ok", "ok-tint", "ok-line",
  "ok-ink", "warn", "warn-tint", "warn-line", "warn-ink", "fault", "fault-tint",
  "fault-line", "fault-ink", "off", "off-tint", "off-line", "off-ink", "font", "mono",
  "fs", "fs-sm", "fs-xs", "fs-body", "fs-title", "radius", "radius-sm", "radius-card",
  "radius-pill", "gap", "pad", "space-1", "space-2", "space-3", "space-4", "space-6",
  "space-8", "shadow", "shadow-pop",
] as const;

function declarationsFor(css: string, selector: string): ReadonlyMap<string, string> {
  const match = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  expect(match).not.toBeNull();

  return new Map(
    match![1]
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const [name, value] = declaration.split(":").map((part) => part.trim());
        return [name, value] as const;
      }),
  );
}

function canonicalVariables(css: string): ReadonlySet<string> {
  return new Set([...css.matchAll(/(--fl-[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
}

describe("FactoryLM theme package contract", () => {
  it("keeps the package token copy byte-identical to the canonical source", () => {
    const packaged = readFileSync(new URL("../tokens.css", import.meta.url));
    const canonical = readFileSync(
      new URL("../../../../docs/design/factorylm-tokens.css", import.meta.url),
    );

    expect(packaged.equals(canonical)).toBe(true);
  });

  it("defines semantic workspace aliases for both themes without color literals", () => {
    const css = readFileSync(WORKSPACE_CSS, "utf8");
    const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const canonical = canonicalVariables(readFileSync(new URL("../tokens.css", import.meta.url), "utf8"));
    const expectedNames = requiredRoles.map((role) => `--fl-workspace-${role}`).sort();

    for (const declarations of [
      declarationsFor(uncommented, ":root"),
      declarationsFor(uncommented, '\\[data-theme="dark"\\]'),
    ]) {
      expect([...declarations.keys()].sort()).toEqual(expectedNames);
      for (const value of declarations.values()) {
        expect(value).toMatch(/^var\(--fl-[a-z0-9-]+\)$/);
        expect(canonical.has(value.slice(4, -1))).toBe(true);
      }
    }
    expect(css).toContain('@import "./tokens.css"');
    expect(uncommented).not.toMatch(
      /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(|\bcolor\(/i,
    );
  });

  it("exposes only the TypeScript and stylesheet package entrypoints", () => {
    const manifest = JSON.parse(readFileSync(new URL("package.json", PACKAGE_ROOT), "utf8"));

    expect(manifest.exports).toEqual({
      ".": "./src/index.ts",
      "./tokens.css": "./src/tokens.css",
      "./workspace.css": "./src/workspace.css",
    });
  });

  it("exports an immutable light/dark theme registry", () => {
    expect(THEME_NAMES).toEqual(["light", "dark"]);
    expect(Object.isFrozen(THEME_NAMES)).toBe(true);
  });
});
