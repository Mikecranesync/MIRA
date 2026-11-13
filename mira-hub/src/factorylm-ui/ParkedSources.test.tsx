/** #5456: the "Sources not in use" box. Static render (no jsdom here). */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ParkedSourcesView } from "./ParkedSources";
import type { ParkedRow } from "./parked-sources";

const row = (patch: Partial<ParkedRow>): ParkedRow => ({ docId: "d-1", name: "manual.pdf", fileId: "f-1", label: "Not searchable: not turned on", fix: "use", needsApproval: true, ...patch });
const render = (rows: ParkedRow[], extra: { turnedOn?: string[]; busy?: string[]; failed?: Record<string, string> } = {}) =>
  renderToStaticMarkup(<ParkedSourcesView rows={rows} turnedOn={extra.turnedOn ?? []} busy={new Set(extra.busy ?? [])} failed={extra.failed ?? {}} onUse={vi.fn()} />);

describe("#5456 Sources not in use", () => {
  it("renders nothing when every source is in use", () => {
    expect(render([])).toBe("");
  });
  it("is a named region the chat's word 'Sources' describes", () => {
    const html = render([row({})]);
    expect(html).toContain('aria-label="Sources not in use"');
    expect(html).toContain(">Sources not in use</p>");
  });
  it("a usable manual gets one button, named for the file, and a way to open it first", () => {
    const html = render([row({})]);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-label="Use manual.pdf for answers"[^>]*>Use this manual<\/button>/);
    expect(html).toMatch(/<a[^>]*href="[^"]*\/api\/namespace\/files\/f-1\/"[^>]*aria-label="Open manual.pdf"[^>]*>Open<\/a>/);
    expect(html).toContain("Not searchable: not turned on");
  });
  it("a partial manual has NO button: the step is the full manual", () => {
    const html = render([row({ fix: "full_manual", label: "Saved, switched off — partial manual" })]);
    expect(html).not.toContain("<button");
    expect(html).toContain("only part of a manual");
    expect(html).toContain("Add the full manual to this project");
  });
  it("a document whose text isn't readable has no button, and no promise that it will be", () => {
    const html = render([row({ fix: "wait" })]);
    expect(html).not.toContain("<button");
    expect(html).toContain("its text isn&#x27;t readable in this project");
    expect(html).not.toMatch(/\byet\b/);
  });
  it("a row with a write in the air is disabled and says so", () => {
    const html = render([row({})], { busy: ["d-1"] });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Turning on…<\/button>/);
  });
  it("a failure is an alert on its own row", () => {
    const html = render([row({}), row({ docId: "d-2", name: "other.pdf" })], { failed: { "d-2": "Couldn't turn this manual on." } });
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).toContain("Couldn&#x27;t turn this manual on.");
  });
  it("confirms a manual that was turned on, with no heading when nothing is left", () => {
    const html = render([], { turnedOn: ["manual.pdf"] });
    expect(html).toContain("manual.pdf is now used for answers in this project.");
    expect(html).not.toContain(">Sources not in use</p>");
  });
  it("no file to open, no Open link", () => {
    expect(render([row({ fileId: null })])).not.toContain("<a ");
  });
});
