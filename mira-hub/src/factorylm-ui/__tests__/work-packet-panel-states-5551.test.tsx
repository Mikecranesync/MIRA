/**
 * #5551 whole-panel states (availability injected as the first useState): an unsupported maker never
 * shows the work-order form or Build; supported CAT Pumps shows the form but no demo controls.
 * Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-panel-states-5551
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ availability: {} as Record<string, unknown>, calls: 0 }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => actual.useState(state.calls++ === 0 ? state.availability : initial) };
});
const menu = vi.hoisted(() => ({ registered: [] as unknown[] }));
vi.mock("../notebook-actions-menu", () => ({
  useMenuItem: (item: unknown) => { menu.registered.push(item); return { inMenu: false, focusMore: () => {} }; },
}));
import { WorkPacketPanel } from "../WorkPacketPanel";

const ID = "52890000-0000-4000-8000-000000000551";
function avail(manufacturer: string, blocking: unknown) {
  return {
    enabled: true, documents: [], documentsState: "read",
    identity: { manufacturer, model: "X1", status: "user_confirmed", catalogNumber: null }, blocking,
  };
}
beforeEach(() => { state.calls = 0; menu.registered.length = 0; });

describe("#5551 unsupported maker", () => {
  beforeEach(() => { state.availability = avail("Siemens", { reason: "manufacturer_not_supported", message: "x" }); });

  it("registers no Prepare job menu item and draws no pill", () => {
    const html = renderToStaticMarkup(<WorkPacketPanel notebookId={ID} />);
    expect(menu.registered.at(-1)).toBeNull();
    expect(html).not.toContain('data-testid="wp-open"');
  });
  it("a direct link shows the plain reason and Close — no work-order form, Build or demo controls", () => {
    const html = renderToStaticMarkup(<WorkPacketPanel notebookId={ID} openOnArrival />);
    expect(html).toContain("Job packets aren&#x27;t available for Siemens equipment yet.");
    expect(html).toContain('data-testid="wp-close"');
    for (const gone of ["wp-workorder", "wp-build", "wp-load-synthetic", "wp-typed-confirm", "wp-nameplate-input"]) expect(html).not.toContain(gone);
    expect(html).not.toMatch(/own documents|Use that manufacturer/i);
  });
  it("opting in to demo controls does not bring the dead-end form back for Siemens", () => {
    expect(renderToStaticMarkup(<WorkPacketPanel notebookId={ID} openOnArrival allowSyntheticDemo />)).not.toContain("wp-load-synthetic");
  });
});

describe("#5551 supported CAT Pumps (control)", () => {
  beforeEach(() => { state.availability = avail("CAT Pumps", null); });

  it("registers the menu item and shows the work-order form without demo controls", () => {
    const html = renderToStaticMarkup(<WorkPacketPanel notebookId={ID} openOnArrival />);
    expect(menu.registered.at(-1)).toMatchObject({ id: "work-packet", label: "Prepare job" });
    expect(html).toContain('data-testid="wp-build"');
    expect(html).not.toContain("wp-load-synthetic");
    expect(html).not.toContain("Synthetic / demo");
    expect(html).not.toContain("wp-unsupported");
  });
  it("explicit internal opt-in shows the demo controls", () => {
    expect(renderToStaticMarkup(<WorkPacketPanel notebookId={ID} openOnArrival allowSyntheticDemo />)).toContain('data-testid="wp-load-synthetic"');
  });
});
