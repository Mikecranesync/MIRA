/**
 * Slice D (#3650) — colour = state, accent = action (.claude/rules/ui-style.md).
 * Stylesheet + theme contracts from the Codex look-vs-plan review of 1.1.7 / Slice C.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const conversation = readFileSync(new URL("../conversation.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../shell.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../../../factorylm-theme/src/tokens.css", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../../../factorylm-theme/src/workspace.css", import.meta.url), "utf8");
const rule = (css: string, selector: string) => {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`rule ${selector} not found`);
  return match[1];
};

describe("colour = state, accent = action", () => {
  it("the authorized-evidence pill wears the ok state tokens, not the accent", () => {
    const body = rule(conversation, ".fl-pill--primary");
    expect(body).toMatch(/--fl-workspace-ok-line/);
    expect(body).toMatch(/--fl-workspace-ok-tint/);
    expect(body).not.toMatch(/--fl-workspace-accent/);
  });

  it("a run card's border is state-coloured (ok when running/completed, fault when blocked), never accent", () => {
    expect(rule(conversation, ".fl-run")).not.toMatch(/--fl-workspace-accent/);
    expect(conversation).toMatch(/\.fl-run\[data-run-status="running"\],\s*\.fl-run\[data-run-status="completed"\]\s*\{[^}]*--fl-workspace-ok-line/s);
    expect(conversation).toMatch(/\.fl-run\[data-run-status="blocked"\]\s*\{[^}]*--fl-workspace-fault-line/s);
  });

  it("a completed plan step is an ok-state check, not an accent check", () => {
    const body = rule(conversation, '.fl-step[data-step-status="completed"] .fl-step__check');
    expect(body).toMatch(/--fl-workspace-ok-line/);
    expect(body).not.toMatch(/--fl-workspace-accent/);
  });
});

describe("scrim depth and dark accent", () => {
  it("modal layers use a dedicated modal scrim, lighter than the live-media scrim, and dark mode uses a dark neutral overlay", () => {
    expect(tokens).toMatch(/--fl-modal-scrim:\s*rgba\(17, 24, 39, 0\.45\)/);
    expect(tokens).toMatch(/--fl-dark-scrim:\s*rgba\(0, 0, 0, 0\.55\)/);
    expect(workspace).toMatch(/--fl-workspace-scrim:\s*var\(--fl-modal-scrim\)/);
  });

  it("the dark workspace accent is its own token, not the public datasheet orange", () => {
    const dark = workspace.slice(workspace.indexOf('[data-theme="dark"]'));
    expect(dark).toMatch(/--fl-workspace-accent:\s*var\(--fl-dark-workspace-accent\)/);
    expect(dark).not.toMatch(/--fl-workspace-accent:\s*var\(--fl-dark-accent\)/);
    expect(tokens).toMatch(/--fl-dark-workspace-accent:\s*#8b8cf6/i);
  });

  it("the New chat reason no longer overlaps its control (no negative margin)", () => {
    expect(rule(shell, ".fl-shell__hint")).not.toMatch(/calc\(-1/);
  });
});
