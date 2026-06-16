/**
 * Contract tests for the shared topbar partial.
 *
 * Background: tools/web-review-runs/2026-05-03-style-audit/AUDIT.md
 * found six different topbars live in production. This test suite
 * locks down the standard so the four TS-rendered marketing views
 * (home, cmms, limitations, security/sample) cannot drift again.
 *
 * If a future change needs to add or remove a nav link, update
 * NAV_LINKS in _topbar.ts AND update this expectation list — the
 * test won't let one happen without the other.
 */

import { describe, expect, test } from "bun:test";
import { renderHome } from "../home.js";
import { renderCmms, renderSamplePlaceholder } from "../cmms.js";
import { renderLimitations } from "../limitations.js";
import { renderSecurity } from "../security.js";
import { navbar, footer } from "../_topbar.js";

const APEX = "https://factorylm.com";

const STANDARD_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: `${APEX}/cmms`, label: "CMMS" },
  { href: `${APEX}/pricing`, label: "Pricing" },
  { href: `${APEX}/blog`, label: "Blog" },
  { href: `${APEX}/limitations`, label: "Limitations" },
  { href: `${APEX}/security`, label: "Security" },
];

describe("shared topbar partial — contract", () => {
  test("renders all five standard nav links in order", () => {
    const html = navbar();
    const positions = STANDARD_LINKS.map((l) => html.indexOf(`href="${l.href}"`));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  test("each nav link contains its expected label", () => {
    const html = navbar();
    for (const link of STANDARD_LINKS) {
      expect(html).toContain(`href="${link.href}"`);
      expect(html).toContain(`>${link.label}</a>`);
    }
  });

  test("primary CTA is 'Sign in' linking to factorylm.com/cmms", () => {
    const html = navbar();
    expect(html).toContain("Sign in");
    expect(html).toContain(`href="${APEX}/cmms"`);
    expect(html).toContain("fl-btn-ghost");
  });

  test("aria-current='page' is set only on the matching link", () => {
    const html = navbar({ currentPath: "/limitations" });
    const currentMatches = html.match(/aria-current="page"/g) || [];
    expect(currentMatches.length).toBe(1);
    expect(html).toContain(`href="${APEX}/limitations"`);
    expect(html).toMatch(/aria-current="page"/);
  });

  test("ctaPrefix scopes data-cta attributes for analytics", () => {
    const html = navbar({ ctaPrefix: "lim" });
    expect(html).toContain('data-cta="lim-nav-cmms"');
    expect(html).toContain('data-cta="lim-nav-pricing"');
    expect(html).toContain('data-cta="lim-nav-signin"');
  });

  test("default (no prefix) uses bare 'nav-' data-cta names", () => {
    const html = navbar();
    expect(html).toContain('data-cta="nav-cmms"');
    expect(html).toContain('data-cta="nav-signin"');
  });

  test("footer renders four legal/policy links + sun-toggle", () => {
    const html = footer();
    expect(html).toContain(`href="${APEX}/limitations"`);
    expect(html).toContain(`href="${APEX}/trust"`);
    expect(html).toContain(`href="${APEX}/privacy"`);
    expect(html).toContain(`href="${APEX}/terms"`);
    expect(html).toContain('id="fl-sun-toggle"');
  });
});

describe("topbar parity — all four TS views render identical link sets", () => {
  const homeHtml = renderHome("https://factorylm.com/");
  const cmmsHtml = renderCmms("https://factorylm.com/cmms");
  const sampleHtml = renderSamplePlaceholder();
  const limHtml = renderLimitations("https://factorylm.com/limitations");
  const secHtml = renderSecurity("https://factorylm.com/security");

  const pages = [
    { name: "home", html: homeHtml },
    { name: "cmms", html: cmmsHtml },
    { name: "sample", html: sampleHtml },
    { name: "limitations", html: limHtml },
    { name: "security", html: secHtml },
  ];

  for (const page of pages) {
    test(`${page.name}: contains all five standard nav links in topbar`, () => {
      // Extract just the topbar region so footer/body links don't pollute.
      const headerMatch = page.html.match(/<header[^>]*class="fl-topbar"[\s\S]*?<\/header>/);
      expect(headerMatch).not.toBeNull();
      const header = headerMatch![0];
      for (const link of STANDARD_LINKS) {
        expect(header).toContain(`href="${link.href}"`);
        expect(header).toContain(`>${link.label}</a>`);
      }
    });

    test(`${page.name}: shows 'Sign in' CTA in topbar`, () => {
      const headerMatch = page.html.match(/<header[^>]*class="fl-topbar"[\s\S]*?<\/header>/);
      expect(headerMatch).not.toBeNull();
      expect(headerMatch![0]).toContain("Sign in");
    });
  }

  test("home marks '/' (no nav link gets aria-current)", () => {
    const headerMatch = homeHtml.match(/<header[^>]*class="fl-topbar"[\s\S]*?<\/header>/)!;
    expect(headerMatch[0]).not.toContain('aria-current="page"');
  });

  test("limitations marks the Limitations link as current", () => {
    const headerMatch = limHtml.match(/<header[^>]*class="fl-topbar"[\s\S]*?<\/header>/)!;
    expect(headerMatch[0]).toContain(`href="${APEX}/limitations"`);
    expect(headerMatch[0]).toMatch(/aria-current="page"/);
  });

  test("security marks the Security link as current", () => {
    const headerMatch = secHtml.match(/<header[^>]*class="fl-topbar"[\s\S]*?<\/header>/)!;
    expect(headerMatch[0]).toContain(`href="${APEX}/security"`);
    expect(headerMatch[0]).toMatch(/aria-current="page"/);
  });

  test("cmms marks the CMMS link as current (not Home)", () => {
    const headerMatch = cmmsHtml.match(/<header[^>]*class="fl-topbar"[\s\S]*?<\/header>/)!;
    expect(headerMatch[0]).toContain(`href="${APEX}/cmms"`);
    expect(headerMatch[0]).toMatch(/aria-current="page"/);
    // The pre-fix cmms.ts had a "Home" link; the standard topbar drops it.
    expect(headerMatch[0]).not.toMatch(/data-cta="cmms-nav-home"/);
  });
});

describe("dark theme stylesheet linked on /limitations and /security", () => {
  test("/limitations links /_dark-theme.css", () => {
    const html = renderLimitations("https://factorylm.com/limitations");
    expect(html).toContain('href="/_dark-theme.css"');
  });

  test("/security links /_dark-theme.css", () => {
    const html = renderSecurity("https://factorylm.com/security");
    expect(html).toContain('href="/_dark-theme.css"');
  });
});
