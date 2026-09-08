/**
 * Slice D (#3650) — colour = state, accent = action (.claude/rules/ui-style.md).
 * Stylesheet + theme contracts from the Codex look-vs-plan review of 1.1.7 / Slice C.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
function render(...args: Parameters<typeof renderHarness>): HarnessView {
  const view = renderHarness(...args);
  views.push(view);
  return view;
}

afterEach(() => { views.splice(0).forEach((view) => view.cleanup()); });

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

describe("density and typesetting (Slice D-2)", () => {
  it("navigation rows use the base scale with a tighter indent", () => {
    expect(shell).toMatch(/\n\.fl-tree__row\s*\{[^}]*font-size:\s*var\(--fl-workspace-fs\)/);
    expect(shell).toMatch(/\n\.fl-tree__children\s*\{\s*padding-inline-start:\s*var\(--fl-workspace-space-2\)/);
  });

  it("a citation is a two-line card with the locator as small metadata and mono only for its code", () => {
    expect(rule(conversation, ".fl-source")).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\)/);
    expect(rule(conversation, ".fl-source__locator")).toMatch(/font-size:\s*var\(--fl-workspace-fs-xs\)/);
    expect(rule(conversation, ".fl-source__locator")).not.toMatch(/--fl-workspace-mono/);
    expect(rule(conversation, ".fl-source__locator code")).toMatch(/--fl-workspace-mono/);
  });

  it("the attachment sheet has a mobile handle and a close control", () => {
    const mobile = conversation.slice(conversation.indexOf("@media (max-width: 48rem)"));
    expect(mobile).toMatch(/\.fl-attachment-menu__handle\s*\{[^}]*display:\s*block/s);
    expect(conversation).toMatch(/\.fl-attachment-menu__close\s*\{/);
  });
});

describe("Slice D re-review fixes", () => {
  it("tree metadata is a fixed column so a selected row truncates identically in both themes", () => {
    expect(rule(shell, ".fl-tree__meta")).toMatch(/inline-size:\s*3\.75rem/);
  });

  it("the citation kind label is not monospaced", () => {
    expect(rule(conversation, ".fl-source__kind")).not.toMatch(/--fl-workspace-mono/);
  });

  it("the run lifecycle label carries the status class in the rendered DOM", () => {
    // The CSS rule alone is not proof the markup binds to it (devops note on the C revert).
    const view = render({ surface: "web", fixture: "work-run" });
    const label = view.container.querySelector('[aria-label="Diagnostic Run"] .fl-run__status');
    expect(label).not.toBeNull();
    expect(label?.textContent).toMatch(/steps/);
  });

  it("the run lifecycle label reads in state colour", () => {
    expect(conversation).toMatch(/\.fl-run\[data-run-status="running"\] \.fl-run__status,\s*\.fl-run\[data-run-status="completed"\] \.fl-run__status\s*\{[^}]*--fl-workspace-ok-ink/s);
    expect(conversation).toMatch(/\.fl-run\[data-run-status="blocked"\] \.fl-run__status\s*\{[^}]*--fl-workspace-fault-ink/s);
  });

  it("the mobile header title uses the header ink explicitly", () => {
    const mobile = shell.slice(shell.indexOf("@media (max-width: 48rem)"));
    expect(mobile).toMatch(/\.fl-shell__header h1\s*\{[^}]*color:\s*var\(--fl-workspace-header-ink\)/s);
  });
});

describe("ui-style rule 1 — never hardcode a colour outside the token files", () => {
  it("shell.css, conversation.css and workspace.css contain no raw hex/rgb/hsl literals", () => {
    for (const [name, css] of [["shell.css", shell], ["conversation.css", conversation], ["workspace.css", workspace]] as const) {
      const literals = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi) ?? [];
      expect(literals, `${name}: ${literals.join(", ")}`).toEqual([]);
    }
  });
});
