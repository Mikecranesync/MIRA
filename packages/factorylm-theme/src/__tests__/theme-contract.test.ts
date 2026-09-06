import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { THEME_NAMES } from "@factorylm/theme";

const PACKAGE_ROOT = new URL("../../", import.meta.url);
const WORKSPACE_CSS = new URL("../workspace.css", import.meta.url);

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
    const requiredRoles = [
      "bg", "surface", "surface-hi", "header", "header-ink", "header-muted",
      "ink", "muted", "faint", "line", "line-strong", "accent", "accent-hover",
      "accent-tint", "accent-ink", "accent-line", "ok", "ok-tint", "ok-line",
      "ok-ink", "warn", "warn-tint", "warn-line", "fault", "fault-tint",
      "fault-line", "off", "font", "mono", "fs", "fs-sm", "fs-xs", "fs-body",
      "fs-title", "radius", "radius-sm", "radius-card", "radius-pill", "gap", "pad",
      "space-1", "space-2", "space-3", "space-4", "space-6", "space-8", "shadow",
      "shadow-pop",
    ];

    for (const role of requiredRoles) {
      expect(css).toContain(`--fl-workspace-${role}`);
    }
    expect(css).toContain(":root");
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('@import "./tokens.css"');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
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
