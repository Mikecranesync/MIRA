/**
 * #4693: web /v3 had no account, sign-out or help anywhere (151 controls on a
 * Pixel, none of them). The drawer footer now names the signed-in account and
 * offers Sign out, like the mobile host. Rendered with renderToStaticMarkup —
 * the hub's node vitest pattern (see ScopePicker.notice.test.tsx).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HubAccountFooter } from "./HubAccountFooter";

const html = (email: string | null, signingOut = false) =>
  renderToStaticMarkup(<HubAccountFooter email={email} signingOut={signingOut} onSignOut={() => {}} />);

describe("HubAccountFooter", () => {
  it("names the signed-in account and offers an enabled Sign out", () => {
    const out = html("tech@example.com");
    expect(out).toContain("tech@example.com");
    expect(out).toMatch(/<button type="button">Sign out<\/button>/);
  });

  it("while signing out, the button says so and cannot be pressed twice", () => {
    const out = html("tech@example.com", true);
    expect(out).toMatch(/<button type="button" disabled="">Signing out…<\/button>/);
    expect(out).not.toContain(">Sign out<");
  });

  it("control: with no email known, Sign out is still offered and no empty account line renders", () => {
    const out = html(null);
    expect(out).toContain(">Sign out<");
    expect(out).not.toContain("fl-card__meta");
  });
});
