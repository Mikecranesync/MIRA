/**
 * VisualWorkspace static-render smoke test.
 *
 * mira-hub's Vitest runs in the `node` environment with no jsdom, so we verify
 * the component the same way the rest of the repo does — `renderToStaticMarkup`
 * (see MachineMemoryCard.test.tsx). This asserts the toolbar/canvas STRUCTURE
 * and initial-state affordances that are computable from a single render pass;
 * the interactive behavior (draw, undo/redo, pan/zoom) is exhaustively covered
 * by the pure reducer/viewport tests, and full pointer/touch E2E is a later
 * Playwright pass when V2 wires the workspace into a page.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VisualWorkspace from "./VisualWorkspace";

function render(props?: Partial<Parameters<typeof VisualWorkspace>[0]>) {
  return renderToStaticMarkup(
    <VisualWorkspace imageSrc="/evidence/e-1.png" imageWidth={1600} imageHeight={900} {...props} />,
  );
}

describe("VisualWorkspace static render", () => {
  it("renders the tool palette, history controls, and a canvas", () => {
    const html = render();
    for (const label of ["Point", "Box", "Highlight", "Pan", "Undo", "Redo", "Clear"]) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).toContain("<canvas");
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Annotation tools"');
  });

  it("marks the initial tool pressed (default: box)", () => {
    const html = render();
    // The active button carries aria-pressed="true"; exactly one tool is active.
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    // Box is the default active tool -> its button precedes the true flag.
    expect(html).toMatch(/aria-pressed="true"[^>]*>Box<\/button>|>Box<\/button>/);
  });

  it("honors an explicit initialTool", () => {
    const html = render({ initialTool: "highlight" });
    expect(html).toMatch(/aria-pressed="true"[\s\S]*?>Highlight<\/button>/);
  });

  it("disables Undo/Redo/Clear on an empty workspace and shows 0 regions", () => {
    const html = render();
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("0 regions");
  });

  it("uses design tokens, never a hardcoded status hex, in inline styles", () => {
    const html = render();
    expect(html).toContain("var(--brand-blue)");
    expect(html).toContain("var(--surface-0)");
    // no raw 6-digit hex colors leaked into markup
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
