/**
 * #4632 New project setup: the presentational view, rendered statically. This repo has no
 * jsdom or testing-library, so the interaction paths (cancel, back, commit) are proven in
 * new-project-setup-logic.test.ts against a fake fetch; these tests pin what the technician sees.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NewProjectSetupView, type SetupActions } from "./NewProjectSetup";
import { initialSetupState, type SetupState } from "./new-project-setup-logic";

const actions: SetupActions = {
  retryMachines: vi.fn(), choose: vi.fn(), setName: vi.fn(), toggleDoc: vi.fn(), addPdfs: vi.fn(),
  removePdf: vi.fn(), next: vi.fn(), back: vi.fn(), commit: vi.fn(), openProject: vi.fn(), cancel: vi.fn(),
};
const machine = { id: "node-cv101", name: "CV-101 Discharge Conveyor", tag: "CV-101", unsPath: "enterprise.p.l4.cv101", manufacturer: null, model: null, location: "Line 4" };
const render = (patch: Partial<SetupState>) => renderToStaticMarkup(<NewProjectSetupView state={{ ...initialSetupState(), ...patch }} actions={actions} />);

/** The checkbox inside the label whose text contains `label`. */
function checkboxFor(html: string, label: string): string {
  const start = html.lastIndexOf("<label", html.indexOf(label));
  const end = html.indexOf("</label>", html.indexOf(label));
  expect(start).toBeGreaterThanOrEqual(0);
  const block = html.slice(start, end);
  const match = block.match(/<input[^>]*type="checkbox"[^>]*>/);
  expect(match).not.toBeNull();
  return match![0];
}

describe("manuals linked to the machine", () => {
  const linked = [{ key: "up-1", docId: "up-1", filename: "CV-101 manual.pdf", reason: null }];
  it("a CV-101-style machine with a linked manual is pre-checked on step 2", () => {
    const html = render({ step: 2, selected: { kind: "machine", machine }, linked, chosenDocIds: ["up-1"], workspace: [] });
    expect(checkboxFor(html, "CV-101 manual.pdf")).toContain('checked=""');
  });
  it("control: the same manual is not checked when the technician has not chosen it", () => {
    const html = render({ step: 2, selected: { kind: "machine", machine }, linked, chosenDocIds: [], workspace: [] });
    expect(checkboxFor(html, "CV-101 manual.pdf")).not.toContain("checked");
  });
  it("a manual with no attachable id is disabled and says why", () => {
    const html = render({ step: 2, selected: { kind: "machine", machine }, linked: [{ key: "file:x", docId: null, filename: "scan.pdf", reason: "Not searchable yet" }], workspace: [] });
    const box = checkboxFor(html, "scan.pdf");
    expect(box).toContain("disabled");
    expect(html).toContain("Not searchable yet");
  });
});

describe("duplicate machine refusal", () => {
  it("shows the existing project name and an Open action; Next stays disabled", () => {
    const html = render({ step: 1, selected: { kind: "machine", machine }, name: machine.name, duplicate: { notebookId: "nb-1", name: "CV-101 line" } });
    expect(html).toContain("This machine already has a project: CV-101 line");
    expect(html).toContain("Open that project");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Next<\/button>/);
  });
  it("control: no duplicate means no refusal and Next is enabled", () => {
    const html = render({ step: 1, selected: { kind: "machine", machine }, name: machine.name, duplicate: null });
    expect(html).not.toContain("already has a project");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Next<\/button>/);
  });
  it("a refusal at commit (created:false) offers Open existing", () => {
    const html = render({ step: 3, selected: { kind: "machine", machine }, refusal: { notebookId: "nb-old", message: "This machine already has a project: Old" } });
    expect(html).toContain("This machine already has a project: Old");
    expect(html).toContain("Open existing");
  });
});

describe("confirm readiness rows", () => {
  it("applicability is its own line, apart from readiness", () => {
    const html = render({
      step: 3, done: true, selected: { kind: "machine", machine },
      rows: [{ key: "d1", filename: "CV-101 manual.pdf", readiness: { tone: "ready", label: "Ready to search" }, applicability: "Added by you, not verified for this model", note: null }],
    });
    expect(html).toMatch(/<p[^>]*>Added by you, not verified for this model<\/p>/);
    expect(html).toContain("Ready to search");
  });
  it("a failed index is shown as Needs attention and never as Ready", () => {
    const html = render({
      step: 3, done: true, selected: { kind: "general" }, name: "G",
      rows: [{ key: "d2", filename: "bad.pdf", readiness: { tone: "attention", label: "Needs attention" }, applicability: "Applicability unknown", note: "Saved, but it couldn't be read for chat" }],
    });
    expect(html).toContain("Needs attention");
    expect(html).not.toContain("Ready to search");
  });
});

describe("controls", () => {
  it("Back is disabled while the write is running (no navigation mid-commit)", () => {
    const html = render({ step: 3, committing: true, selected: { kind: "general" }, name: "G" });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Back<\/button>/);
    expect(html).toContain("Creating…");
  });
  it("Create project is the only write control on step 3 before the click", () => {
    const html = render({ step: 3, selected: { kind: "general" }, name: "G" });
    expect(html).toContain("Create project");
    expect(html).toContain("Nothing is written until you press Create project.");
  });
});

