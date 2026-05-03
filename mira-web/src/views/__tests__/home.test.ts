import { describe, expect, test } from "bun:test";
import { renderHome } from "../home.js";

describe("#SO-100 renderHome — homepage refactor acceptance", () => {
  const html = renderHome("https://factorylm.com/");

  test("AC1: hero L1 message — H1 'FactoryLM', H2 workspace tagline, H3 MIRA", () => {
    expect(html).toContain('id="fl-hero-h1"');
    expect(html).toMatch(/<h1[^>]*>FactoryLM<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>The AI workspace for industrial maintenance\.<\/h2>/);
    expect(html).toMatch(/Meet <strong>MIRA<\/strong>/);
    expect(html).toMatch(/Manuals, sensors, photos, work orders, investigations/);
  });

  test("AC1: primary CTA links to /cmms; secondary links to /pricing", () => {
    expect(html).toMatch(
      /<a href="\/cmms"[^>]*class="fl-btn fl-btn-primary"[^>]*data-cta="hero-primary"[^>]*>Start Free — magic link<\/a>/
    );
    expect(html).toMatch(
      /<a href="\/pricing"[^>]*class="fl-btn fl-btn-ghost"[^>]*data-cta="hero-secondary"[^>]*>See pricing →<\/a>/
    );
  });

  test("AC2: trust band with eyebrow + 8 OEM logos", () => {
    expect(html).toContain('class="fl-trust-band"');
    expect(html).toContain("68,000+ chunks of OEM documentation indexed");
    for (const oem of [
      "Allen-Bradley",
      "Siemens",
      "ABB",
      "Schneider Electric",
      "Yaskawa",
      "Mitsubishi",
      "Rockwell",
      "Honeywell",
    ]) {
      expect(html).toContain(`<li>${oem}</li>`);
    }
  });

  test("AC3: 3-card row for Asset / Crew / Investigation Projects", () => {
    expect(html).toContain('class="fl-project-row"');
    expect(html).toContain('aria-label="Asset Project"');
    expect(html).toContain('aria-label="Crew Project"');
    expect(html).toContain('aria-label="Investigation Project"');
  });

  test("AC4: single compareBlock — MIRA vs ChatGPT Projects", () => {
    expect(html).toContain('class="fl-compare"');
    expect(html).toContain("ChatGPT Projects");
    expect(html).toContain("MIRA");
    expect(html).toContain("PowerFlex 755");
    const compareCount = (html.match(/class="fl-compare"/g) || []).length;
    expect(compareCount).toBe(1);
  });

  test("AC5: feature strip — 4 state badges + stop card", () => {
    expect(html).toContain('class="fl-state fl-state-indexed"');
    expect(html).toContain('class="fl-state fl-state-partial"');
    expect(html).toContain('class="fl-state fl-state-failed"');
    expect(html).toContain('class="fl-state fl-state-superseded"');
    expect(html).toContain('class="fl-stop-card"');
    expect(html).toContain('role="alert"');
  });

  test("AC6: pricing teaser links to /pricing", () => {
    expect(html).toContain("fl-pricing-teaser");
    expect(html).toContain("$97/mo per plant");
    expect(html).toContain("$497/mo");
    expect(html).toMatch(/href="\/pricing"[^>]*data-cta="pricing-teaser-primary"/);
  });

  test("AC7: footer with /trust, /privacy, /terms (limitations disabled until page exists)", () => {
    // /limitations page not yet built — link uses href="#" with aria-disabled until the page exists
    expect(html).toContain('data-cta="footer-limitations"');
    expect(html).toContain('href="/trust"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });

  test("AC8: sun-readable toggle is visible in DOM", () => {
    expect(html).toContain('id="fl-sun-toggle"');
    expect(html).toContain('class="fl-sun-toggle"');
    expect(html).toContain("Sun-readable");
    expect(html).toContain('<script src="/sun-toggle.js"></script>');
  });

  test("AC9: every CTA carries a data-cta attribute (PostHog tracking)", () => {
    const ctaAttrs = html.match(/data-cta="[^"]+"/g) ?? [];
    expect(ctaAttrs.length).toBeGreaterThanOrEqual(8);
    expect(html).toContain('data-cta="hero-primary"');
    expect(html).toContain('data-cta="hero-secondary"');
    expect(html).toContain('data-cta="nav-cmms"');
    expect(html).toContain('data-cta="footer-privacy"');
  });

  test("AC9: posthog-init.js is referenced in head", () => {
    expect(html).toContain('<script src="/posthog-init.js"></script>');
  });

  test("AC10: JSON-LD includes Organization, WebSite, and Person (Mike Harper)", () => {
    const jsonLdMatch = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
    );
    expect(jsonLdMatch).not.toBeNull();
    const parsed = JSON.parse(jsonLdMatch![1]);
    expect(parsed["@context"]).toBe("https://schema.org");
    const types = parsed["@graph"].map((n: { "@type": string }) => n["@type"]);
    expect(types).toContain("Organization");
    expect(types).toContain("WebSite");
    const org = parsed["@graph"].find(
      (n: { "@type": string }) => n["@type"] === "Organization"
    );
    expect(org.founder["@type"]).toBe("Person");
    expect(org.founder.name).toBe("Mike Harper");
  });

  test("Accessibility: exactly one H1", () => {
    const h1Count = (html.match(/<h1\b/g) || []).length;
    expect(h1Count).toBe(1);
  });

  test("Accessibility: heading hierarchy has no skips on home", () => {
    const headings = Array.from(html.matchAll(/<h([1-6])\b/g)).map((m) =>
      Number(m[1])
    );
    let prev = 0;
    for (const level of headings) {
      if (prev !== 0) {
        expect(level - prev).toBeLessThanOrEqual(1);
      }
      prev = Math.max(prev, level);
    }
    expect(headings[0]).toBe(1);
  });

  test("SEO: title, meta description, canonical match spec", () => {
    expect(html).toContain(
      "<title>FactoryLM — AI Workspace for Industrial Maintenance</title>"
    );
    expect(html).toMatch(
      /<meta name="description" content="Manuals, sensors, photos, work orders[^"]+"/
    );
    expect(html).toContain('<link rel="canonical" href="https://factorylm.com/">');
  });

  test("Tokens + components stylesheets are linked", () => {
    expect(html).toContain('href="/_tokens.css"');
    expect(html).toContain('href="/_components.css"');
  });

  test("Document is well-formed HTML5", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toMatch(/<\/html>\s*$/);
  });
});
