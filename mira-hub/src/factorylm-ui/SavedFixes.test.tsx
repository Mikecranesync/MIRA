/**
 * #5089: what the technician sees for the fixes saved on a project. Rendered statically (this
 * repo has no jsdom); the read itself is proven in saved-fixes-logic.test.ts against a fake fetch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SavedFixesView, type SavedFixesViewProps } from "./SavedFixes";
import type { SavedFix } from "./saved-fixes-logic";

const fix = (n: number, patch: Partial<SavedFix> = {}): SavedFix => ({
  id: `fix-${n}`,
  symptom: `Conveyor will not start ${n}`,
  faultCode: null,
  fix: `Replaced the belt tensioner ${n}`,
  createdAt: "2026-11-10T14:05:00.000Z",
  ...patch,
});

const render = (patch: Partial<SavedFixesViewProps>) =>
  renderToStaticMarkup(
    <SavedFixesView
      fixes={[fix(1)]} hasMore={false} loadingMore={false} moreError={null} open={false} assetConfirmed={true}
      locale="en-US" timeZone="America/New_York" onToggle={() => {}} onClose={() => {}} onMore={() => {}}
      {...patch}
    />,
  );

describe("SavedFixesView", () => {
  it("with no saved fix there is no button and no panel", () => {
    expect(render({ fixes: [] })).toBe("");
    expect(render({ fixes: [], open: true })).toBe("");
  });

  it("closed: one button that counts the fixes, and no panel", () => {
    const html = render({ fixes: [fix(1), fix(2)] });
    expect(html).toMatch(/<button[^>]*data-testid="saved-fixes-pill"[^>]*>Saved fixes \(2\)<\/button>/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("saved-fixes-panel");
  });

  it("open: each fix shows the problem, what fixed it and when it was saved", () => {
    const html = render({ open: true, fixes: [fix(1), fix(2, { faultCode: "F0004" })] });
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Saved fixes for this machine");
    expect(html).toContain("Conveyor will not start 1");
    expect(html).toContain("Replaced the belt tensioner 1");
    expect(html).toContain("Nov 10, 2026, 9:05 AM");
    expect(html).toContain("Fault code F0004");
    expect(html.match(/data-testid="saved-fix"/g)).toHaveLength(2);
    expect(html).toContain('aria-expanded="true"');
  });

  it("a fix without a fault code shows no fault-code line", () => {
    expect(render({ open: true })).not.toContain("Fault code");
  });

  it("an unbound project says the fixes belong to the project", () => {
    expect(render({ open: true, assetConfirmed: null })).toContain("Saved fixes in this project");
  });

  it("what the technician typed is shown as text, never as markup", () => {
    const html = render({ open: true, fixes: [fix(1, { fix: '<img src=x onerror="alert(1)">' })] });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("says plainly what a saved fix is and is not", () => {
    expect(render({ open: true })).toContain("Technician notes. They are not checked against the manual, and MIRA does not use them in its answers.");
  });

  it("more on the server: a Show more button; none when everything is shown", () => {
    expect(render({ open: true, hasMore: true })).toMatch(/<button[^>]*data-testid="saved-fixes-more"[^>]*>Show more<\/button>/);
    expect(render({ open: true, hasMore: false })).not.toContain("saved-fixes-more");
  });

  it("while more is loading the button is disabled, and a failed load says so", () => {
    expect(render({ open: true, hasMore: true, loadingMore: true })).toMatch(/<button[^>]*disabled=""[^>]*data-testid="saved-fixes-more"[^>]*>Loading…<\/button>/);
    expect(render({ open: true, hasMore: true, moreError: "More saved fixes could not be loaded." })).toContain('role="alert"');
  });

  it("uses the shared tokens only: no colour is written out", () => {
    const src = readFileSync(join(__dirname, "SavedFixes.tsx"), "utf8");
    // A hex colour inside a string or after a colon (issue numbers in comments are not colours).
    expect(src).not.toMatch(/["'`:]\s*#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});

describe("the host shows the list and refreshes it after a save", () => {
  const src = readFileSync(join(__dirname, "hub-host.tsx"), "utf8");

  it("mounts the list for the open project, in the actions column", () => {
    const column = src.slice(src.indexOf('data-testid="notebook-actions"'));
    expect(column).toMatch(/<SavedFixes\s[^>]*notebookId=\{selection\.notebookId\}[^>]*refresh=\{fixesSaved\}/);
  });

  // Seen on the running screen, not in a static render: the list first shared the bare project id
  // as its React key with the Living Sheet next to it, and React warned of two children with one key.
  it("no two neighbours in the actions column share the bare project id as their key", () => {
    const start = src.indexOf('data-testid="notebook-actions"');
    const column = src.slice(start, src.indexOf("\n      </div>", start));
    expect(column.match(/key=\{selection\.notebookId\}/g) ?? []).toHaveLength(1);
    expect(column).toContain("<SavedFixes key={`saved-fixes|${selection.notebookId}`}");
  });

  it("a successful save bumps the refresh counter", () => {
    const save = src.slice(src.indexOf("const onRecordFix = useCallback"), src.indexOf("}, [fixRequestIds, view.thread.turns]);"));
    expect(save).toMatch(/if \(res\.ok\) \{\s*setFixesSaved\(\(n\) => n \+ 1\);/);
  });
});
