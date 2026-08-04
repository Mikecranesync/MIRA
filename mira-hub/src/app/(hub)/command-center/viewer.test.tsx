/**
 * Coverage for the Command Center Viewer's "Open Live View" handoff (#2274 / #2264).
 *
 * The bug: the live-view link was rendered unconditionally, so when the display
 * was unreachable (`node.live === false`) the Hub opened an empty/broken tab.
 * The fix renders a disabled button (no navigable link) with a warning when the
 * display is down, and the real link only when it is up.
 *
 * Rendered with react-dom/server `renderToStaticMarkup` so it runs in the hub's
 * node vitest environment (no jsdom / RTL dependency). We assert on the emitted
 * HTML string.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Viewer } from "./page";

// Minimal CCNode with a configured, live-capable display. `live` is toggled per
// test to exercise the reachable / unreachable branches.
function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    name: "Filler CV-101",
    kind: "equipment",
    unsPath: "enterprise.plant.line1.cv_101",
    filesCount: 0,
    status: null,
    counts: { children: 0, proposalsPending: 0, proposalsVerified: 0 },
    hasLiveDisplay: true,
    displayId: "disp-42",
    displayType: "ignition-perspective",
    displayLabel: "CV-101 HMI",
    tagFreshness: "live",
    live: true,
    children: [],
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("Command Center Viewer — Open Live View handoff (#2274)", () => {
  it("display live: renders a real link with the correct href, _blank, and noopener noreferrer", () => {
    const html = renderToStaticMarkup(<Viewer node={makeNode({ live: true })} />);

    // A navigable anchor to the per-display proxy path.
    expect(html).toContain("<a");
    expect(html).toMatch(/href="[^"]*\/api\/command-center\/display\/disp-42"/);
    expect(html).toContain('target="_blank"');
    // Security: new-tab handoff must not leak window.opener / referrer.
    expect(html).toContain("noopener");
    expect(html).toContain("noreferrer");
    // No disabled button and no "unreachable" warning in the live branch.
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("currently unreachable");
    // Live copy invites the click.
    expect(html).toContain("Click below to view the screen");
  });

  it("display down: renders a disabled button, no navigable link, and a warning", () => {
    const html = renderToStaticMarkup(<Viewer node={makeNode({ live: false })} />);

    // Disabled button, not an anchor — nothing to navigate to.
    expect(html).toContain("<button");
    expect(html).toContain("disabled");
    expect(html).toContain('type="button"');
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("/api/command-center/display/");
    // The actionable warning is shown...
    expect(html).toContain("Display is currently unreachable");
    // ...and it is programmatically associated with the disabled button (a11y).
    expect(html).toContain('aria-describedby="cc-display-unreachable-warning"');
    expect(html).toContain('id="cc-display-unreachable-warning"');
    // Down copy drops the "click below" invitation.
    expect(html).not.toContain("Click below to view the screen");
  });
});
