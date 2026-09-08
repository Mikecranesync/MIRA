import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HomeComposer from "./HomeComposer";

/**
 * A-1 / B-1 of the outside-in acceptance suite: the first thing on the home
 * screen is a text box, and asking takes zero navigations.
 *
 * These assert the rendered surface, not the fetch. The network path is
 * covered by the route's own contract; what failed the recon was that no
 * composer existed on the landing screen at all.
 */
describe("HomeComposer — the composer is the home screen (A-1, B-1)", () => {
  const html = () => renderToStaticMarkup(<HomeComposer />);

  it("renders a text input on the landing screen", () => {
    expect(html()).toContain("<textarea");
    expect(html()).toContain('data-testid="home-composer"');
  });

  it("names the task rather than the system", () => {
    // "Command Board", "Namespace", "Proposal flywheel" are invented nouns the
    // recon flagged; the greeting must use words a technician already has.
    const out = html();
    expect(out).toContain("What are you working on?");
    expect(out).not.toContain("Command Board");
    expect(out).not.toContain("Namespace");
  });

  it("carries a concrete placeholder, not a generic prompt", () => {
    expect(html()).toContain("PowerFlex 525");
  });

  it("has an accessible name for the input", () => {
    expect(html()).toContain('aria-label="Ask MIRA a maintenance question"');
  });

  it("meets the 44px touch-target floor on both controls", () => {
    const out = html();
    // H-1 requires >=44px; the send button and the input both carry it.
    expect(out).toMatch(/min-height:44px/);
    expect(out).toMatch(/min-width:88px/);
  });

  it("says what it is scoped to, so it never implies plant context it lacks", () => {
    // The UNS gate governs asset-specific troubleshooting. This surface is
    // general-only, and must say so rather than let a technician assume MIRA
    // knows which machine they are standing at.
    expect(html()).toContain("Open a machine to ask about it specifically");
  });

  it("shows no answer and no error before anything is asked", () => {
    const out = html();
    expect(out).not.toContain('data-testid="home-composer-answer"');
    expect(out).not.toContain("role=\"status\"");
  });
});
