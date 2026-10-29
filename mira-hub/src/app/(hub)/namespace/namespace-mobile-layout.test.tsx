import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NamespacePage from "./page";

// #4880 defect 3: at 412px the 280px tree panel stayed beside the content
// panel, squeezing Ask MIRA into a ~132px column (measured in a real browser:
// content panel 132px wide, answer bubble 71px). Below the md breakpoint the
// split pane must stack, and the tree may only be fixed-width from md up.
// jsdom cannot lay out, so this pins the rendered responsive classes; the
// browser measurement lives in the PR evidence.

function classesOf(html: string, testId: string): string[] {
  const m = html.match(new RegExp(`<div[^>]*class="([^"]*)"[^>]*data-testid="${testId}"`));
  expect(m, `element with data-testid=${testId} rendered`).not.toBeNull();
  return m![1].split(/\s+/);
}

function splitPaneClasses(html: string): string[] {
  // The split pane is the direct wrapper that opens right before the tree panel.
  const m = html.match(/<div class="([^"]*)"><div[^>]*data-testid="namespace-tree-panel"/);
  expect(m, "split-pane wrapper rendered").not.toBeNull();
  return m![1].split(/\s+/);
}

describe("namespace page — phone-width layout (#4880 defect 3)", () => {
  const html = renderToStaticMarkup(<NamespacePage />);

  it("the tree panel is not a fixed 280px column below md", () => {
    const tree = classesOf(html, "namespace-tree-panel");
    expect(tree).not.toContain("w-[280px]");
    expect(tree).toContain("w-full");
    expect(tree).toContain("md:w-[280px]");
  });

  it("the split pane stacks on phones and goes side by side from md", () => {
    const pane = splitPaneClasses(html);
    expect(pane).toContain("flex-col");
    expect(pane).toContain("md:flex-row");
  });

  it("control: the content panel stays the flexible, shrinkable column", () => {
    const content = classesOf(html, "namespace-content-panel");
    expect(content).toContain("flex-1");
    expect(content).toContain("min-w-0");
  });
});
