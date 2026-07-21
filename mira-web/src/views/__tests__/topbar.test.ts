/**
 * Contract tests for the shared FactoryLM marketing topbar.
 *
 * PrintSense and Drive Commander are the two standalone product links.
 * Platform is the MIRA / CMMS expansion path. Assessments stay in the footer.
 */

import { describe, expect, test } from "bun:test";
import { renderHome } from "../home.js";
import { renderCmms, renderSamplePlaceholder } from "../cmms.js";
import { renderLimitations } from "../limitations.js";
import { renderSecurity } from "../security.js";
import { navbar, footer } from "../_topbar.js";

const APEX = "https://factorylm.com";

const STANDARD_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: `${APEX}/printsense`, label: "PrintSense" },
  {
    href: `${APEX}/drive-commander/siemens-g120`,
    label: "Drive Commander",
  },
  { href: `${APEX}/pricing`, label: "Pricing" },
  { href: `${APEX}/cmms`, label: "Platform" },
  { href: `${APEX}/security`, label: "Security" },
];

describe("shared topbar partial — product alignment contract", () => {
  test("renders the five standard nav links in order", () => {
    const html = navbar();
    const positions = STANDARD_LINKS.map((link) =>
      html.indexOf(`href="${link.href}"`)
    );
    for (let index = 1; index < positions.length; index++) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1]);
    }
  });

  test("each nav link contains its expected label", () => {
    const html = navbar();
    for (const link of STANDARD_LINKS) {
      expect(html).toContain(`href="${link.href}"`);
      expect(html).toContain(`>${link.label}</a>`);
    }
  });

  test("topbar keeps sign-in and makes PrintSense the primary product CTA", () => {
    const html = navbar();
    expect(html).toContain("Sign in");
    expect(html).toContain("Try PrintSense");
    expect(html).toContain(`href="${APEX}/printsense"`);
    expect(html).not.toContain("Book $500 Assessment");
  });

  test("aria-current='page' is set only on the matching link", () => {
    const html = navbar({ currentPath: "/printsense" });
    const currentMatches = html.match(/aria-current="page"/g) || [];
    expect(currentMatches.length).toBe(1);
    expect(html).toMatch(
      /href="https:\/\/factorylm\.com\/printsense"[^>]*aria-current="page"/
    );
  });

  test("ctaPrefix scopes analytics names for the new product links", () => {
    const html = navbar({ ctaPrefix: "lim" });
    expect(html).toContain('data-cta="lim-nav-printsense"');
    expect(html).toContain('data-cta="lim-nav-drive-commander"');
    expect(html).toContain('data-cta="lim-nav-platform"');
    expect(html).toContain('data-cta="lim-nav-signin"');
    expect(html).toContain('data-cta="lim-nav-try-printsense"');
  });

  test("footer keeps legal links and demotes the assessment to an option", () => {
    const html = footer();
    expect(html).toContain(`href="${APEX}/printsense"`);
    expect(html).toContain(`href="${APEX}/drive-commander/siemens-g120"`);
    expect(html).toContain("Optional assessment");
    expect(html).toContain(`href="${APEX}/limitations"`);
    expect(html).toContain(`href="${APEX}/trust"`);
    expect(html).toContain(`href="${APEX}/privacy"`);
    expect(html).toContain(`href="${APEX}/terms"`);
    expect(html).toContain('id="fl-sun-toggle"');
  });
});

describe("topbar parity — all TS marketing views render the aligned links", () => {
  const pages = [
    { name: "home", html: renderHome("https://factorylm.com/") },
    { name: "cmms", html: renderCmms("https://factorylm.com/cmms") },
    { name: "sample", html: renderSamplePlaceholder() },
    {
      name: "limitations",
      html: renderLimitations("https://factorylm.com/limitations"),
    },
    { name: "security", html: renderSecurity("https://factorylm.com/security") },
  ];

  for (const page of pages) {
    test(`${page.name}: contains all product-aligned nav links`, () => {
      const headerMatch = page.html.match(
        /<header[^>]*class="fl-topbar"[\s\S]*?<\/header>/
      );
      expect(headerMatch).not.toBeNull();
      const header = headerMatch![0];
      for (const link of STANDARD_LINKS) {
        expect(header).toContain(`href="${link.href}"`);
        expect(header).toContain(`>${link.label}</a>`);
      }
      expect(header).toContain("Try PrintSense");
      expect(header).not.toContain("Book $500 Assessment");
    });
  }

  test("home marks no nav link as current", () => {
    const html = renderHome("https://factorylm.com/");
    const header = html.match(
      /<header[^>]*class="fl-topbar"[\s\S]*?<\/header>/
    )![0];
    expect(header).not.toContain('aria-current="page"');
  });

  test("security marks the Security link as current", () => {
    const html = renderSecurity("https://factorylm.com/security");
    const header = html.match(
      /<header[^>]*class="fl-topbar"[\s\S]*?<\/header>/
    )![0];
    expect(header).toMatch(
      /href="https:\/\/factorylm\.com\/security"[^>]*aria-current="page"/
    );
  });

  test("cmms marks Platform current because /cmms is the expansion surface", () => {
    const html = renderCmms("https://factorylm.com/cmms");
    const header = html.match(
      /<header[^>]*class="fl-topbar"[\s\S]*?<\/header>/
    )![0];
    expect(header).toMatch(
      /href="https:\/\/factorylm\.com\/cmms"[^>]*aria-current="page"[^>]*>Platform<\/a>/
    );
  });
});

describe("dark theme stylesheet linked on /limitations and /security", () => {
  test("/limitations links /_dark-theme.css", () => {
    expect(renderLimitations("https://factorylm.com/limitations")).toContain(
      'href="/_dark-theme.css"'
    );
  });

  test("/security links /_dark-theme.css", () => {
    expect(renderSecurity("https://factorylm.com/security")).toContain(
      'href="/_dark-theme.css"'
    );
  });
});
