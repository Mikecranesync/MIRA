/**
 * The `public` surface is a real interactive product preview (#3811).
 *
 * Before this, `publicDemo` was declared on the profile and read by nothing, so
 * `surface="public"` rendered byte-identically to `surface="web"` — the landing
 * surface existed in the type system and in the lab dropdown, not in behaviour.
 *
 * These tests exercise the product decision, so it can regress loudly:
 *
 *   - it is the SAME shell (no second landing architecture)
 *   - sample data is named as sample data, always
 *   - the composer stays fully usable
 *   - gated capabilities CONVERT; they never silently vanish
 *   - with no host to convert to, the shell states the limit rather than
 *     rendering a button that goes nowhere
 *   - the thread control is reset semantics, not history semantics
 *   - other surfaces are untouched
 */
import { afterEach, describe, expect, it } from "bun:test";

import { renderHarness, type HarnessView } from "./harness";
import type { ConversionIntent } from "@factorylm/interaction";

const views: HarnessView[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.cleanup()); });

function render(...args: Parameters<typeof renderHarness>): HarnessView {
  const view = renderHarness(...args);
  views.push(view);
  return view;
}

/** A host that records what it was asked to convert to. */
function convertingHost() {
  const intents: ConversionIntent[] = [];
  return { intents, hooks: { onConvert: (intent: ConversionIntent) => { intents.push(intent); } } };
}

const notice = (view: HarnessView) => view.container.querySelector('[aria-label="Demo notice"]');

describe("public surface — same shell", () => {
  it("renders the canonical shell landmarks, not a bespoke landing chrome", () => {
    const view = render({ surface: "public", fixture: "grounded-answer" });
    expect(view.container.querySelector(".fl-shell")).not.toBeNull();
    expect(view.container.querySelector("main")).not.toBeNull();
    expect(view.container.querySelector('[aria-label="FactoryLM navigation"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Composer"]')).not.toBeNull();
  });

  it("marks the surface so styling can differ without forking the component tree", () => {
    const view = render({ surface: "public", fixture: "grounded-answer" });
    expect(view.container.querySelector(".fl-shell")?.getAttribute("data-surface")).toBe("public");
  });
});

describe("public surface — sample data is declared", () => {
  it("always shows the sample-data notice", () => {
    const view = render({ surface: "public", fixture: "grounded-answer" });
    const el = notice(view);
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("Sample data");
  });

  it("says the answers cite samples rather than the visitor's equipment", () => {
    // The specific claim matters: a cited answer about a machine the visitor does
    // not own is false grounding unless the surface says whose machine it is.
    const view = render({ surface: "public", fixture: "grounded-answer" });
    expect(notice(view)?.textContent).toContain("not your equipment");
  });

  it("states that nothing is saved", () => {
    const view = render({ surface: "public", fixture: "grounded-answer" });
    expect(notice(view)?.textContent).toContain("Nothing here is saved");
  });

  it("does NOT show the notice on any other surface", () => {
    for (const surface of ["web", "mobile", "hub"] as const) {
      const view = render({ surface, fixture: "grounded-answer" });
      expect(notice(view)).toBeNull();
    }
  });
});

describe("public surface — the composer keeps working", () => {
  it("accepts a typed demo question and enables Send", () => {
    const view = render({ surface: "public", fixture: "grounded-answer" });
    const box = view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]');
    expect(box).not.toBeNull();
    view.type(box!, "Why is the conveyor tripping on overload?");
    expect(view.outputs().draft).toBe("Why is the conveyor tripping on overload?");
    expect(view.buttonNamed("Send")?.disabled).toBe(false);
  });
});

describe("public surface — gated capabilities convert, never vanish", () => {
  it("still offers the attachment control, so the capability is discoverable", () => {
    // Hiding it would teach the visitor the product cannot attach files at all.
    const view = render({ surface: "public", fixture: "grounded-answer" });
    expect(view.buttonNamed("Add attachment")).not.toBeNull();
  });

  it("opens a conversion panel instead of photo / file / camera / scan", () => {
    const { hooks } = convertingHost();
    const view = render({ surface: "public", fixture: "grounded-answer", hooks });
    view.click(view.buttonNamed("Add attachment")!);

    const menu = view.container.querySelector('[aria-label="Attachment menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.getAttribute("data-demo-conversion")).toBe("true");
    expect(view.buttonNamed("Try with your equipment")).not.toBeNull();
    // The real capability buttons must not be reachable anonymously: a visitor's
    // own file is private tenant data, and a scan fabricates a machine context.
    for (const label of ["Photo", "File", "Camera", "Scan machine"]) {
      expect(view.buttonNamed(label)).toBeNull();
    }
  });

  it("reports the conversion intent to the host", () => {
    const { intents, hooks } = convertingHost();
    const view = render({ surface: "public", fixture: "grounded-answer", hooks });
    view.click(view.buttonNamed("Add attachment")!);
    view.click(view.buttonNamed("Try with your equipment")!);
    expect(intents).toContain("try-your-equipment");
  });

  it("converts Projects rather than showing a dead 'not available' control", () => {
    const { intents, hooks } = convertingHost();
    const view = render({ surface: "public", fixture: "project-tree", hooks });
    const create = view.buttonNamed("Create workspace to save Projects");
    expect(create).not.toBeNull();
    view.click(create!);
    expect(intents).toContain("create-workspace");
  });

  it("offers sign-in and workspace creation from the notice", () => {
    const { intents, hooks } = convertingHost();
    const view = render({ surface: "public", fixture: "grounded-answer", hooks });
    view.click(view.buttonNamed("Sign in")!);
    view.click(view.buttonNamed("Create workspace")!);
    expect(intents).toEqual(expect.arrayContaining(["sign-in", "create-workspace"]));
  });
});

describe("public surface — no host to convert to", () => {
  it("states the limit instead of rendering buttons that go nowhere", () => {
    // Same discipline the shell already applies to onNewChat/onCreateProject.
    const view = render({ surface: "public", fixture: "grounded-answer" });
    expect(view.buttonNamed("Sign in")).toBeNull();
    expect(notice(view)?.textContent).toContain("not wired up");
  });
});

describe("public surface — reset semantics, not history semantics", () => {
  it("names the thread control 'Start over'", () => {
    const view = render({ surface: "public", fixture: "grounded-answer" });
    expect(view.buttonNamed("Start over")).not.toBeNull();
    expect(view.buttonNamed("New chat")).toBeNull();
  });

  it("keeps 'New chat' on every other surface", () => {
    for (const surface of ["web", "mobile", "hub"] as const) {
      const view = render({ surface, fixture: "grounded-answer" });
      expect(view.buttonNamed("New chat")).not.toBeNull();
      expect(view.buttonNamed("Start over")).toBeNull();
    }
  });
});

describe("public surface — enterprise depth stays off", () => {
  it("renders no Inspector", () => {
    // publicDemo and enterpriseInspector are independent flags; this pins that
    // turning the demo on never leaks the Hub's enterprise panel.
    const view = render({ surface: "public", fixture: "grounded-answer" });
    expect(view.container.querySelector('[aria-label="Inspector"]')).toBeNull();
  });
});
