import { describe, expect, test } from "bun:test";
import { renderHome } from "../home.js";

// Re-baselined 2026-06-13 for the assessment-led "Maintenance Knowledge
// Layer" homepage. The prior assertions described a superseded "AI
// Workspace / Projects" design (Asset/Crew/Investigation cards, ChatGPT
// Projects compare, $97/$497 pricing) and had been failing for some time.
// This suite now locks the live page + the assessment-led CTA spine.

describe("renderHome — assessment-led homepage", () => {
  const html = renderHome("https://factorylm.com/");

  test("hero: H1 'FactoryLM', concrete-outcome H2, 'no CMMS rebuild' H3", () => {
    expect(html).toContain('id="fl-hero-h1"');
    expect(html).toMatch(/<h1[^>]*>FactoryLM<\/h1>/);
    expect(html).toMatch(
      /<h2[^>]*>Cited troubleshooting answers from your manuals, assets, and fault history\.<\/h2>/
    );
    expect(html).toMatch(/<h3[^>]*>Without rebuilding your CMMS\.<\/h3>/);
    // Namespace positioning kept as support copy, not the headline.
    expect(html).toContain("Maintenance Intelligence Namespace");
  });

  test("hero CTAs: primary = Book $500 Assessment (/buy); secondary = sample MIRA answer (/quickstart)", () => {
    expect(html).toMatch(
      /<a href="\/buy"[^>]*class="fl-btn fl-btn-primary"[^>]*data-cta="hero-assessment"[^>]*>Book \$500 Assessment<\/a>/
    );
    expect(html).toMatch(
      /<a href="https:\/\/app\.factorylm\.com\/quickstart"[^>]*class="fl-btn fl-btn-ghost"[^>]*data-cta="hero-demo"[^>]*>Try a sample MIRA answer<\/a>/
    );
    // Sign-in is for existing customers only, demoted to the foot line.
    expect(html).toContain('data-cta="hero-signin"');
  });

  test("trust band with eyebrow + 8 OEM logos", () => {
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

  test("3-card offer row — Assessment / Pilot / Operating Layer", () => {
    expect(html).toContain('class="fl-project-row"');
    expect(html).toContain('aria-label="Assessment"');
    expect(html).toContain('aria-label="Pilot"');
    expect(html).toContain('aria-label="Operating Layer"');
  });

  test("single compareBlock — generic AI vs MIRA on a namespace", () => {
    expect(html).toContain('class="fl-compare"');
    expect(html).toContain("Generic AI");
    expect(html).toContain("PowerFlex 755");
    expect(html).toContain("F005");
    const compareCount = (html.match(/class="fl-compare"/g) || []).length;
    expect(compareCount).toBe(1);
  });

  test("how-it-works strip — linear scan→bind→map→ask→cite→draft", () => {
    expect(html).toContain('id="fl-how-h"');
    expect(html).toContain("How it works.");
    expect(html).toContain("Scan assets");
    expect(html).toContain("MIRA cites the source");
    expect(html).toContain("Draft PMs");
  });

  test("cartoon row — three feature demos with mount IDs the script targets", () => {
    expect(html).toContain('id="fl-cartoons-h"');
    expect(html).toContain("What we structure during a pilot.");
    expect(html).toContain('id="cartoon-fd"');
    expect(html).toContain('id="cartoon-cmms"');
    expect(html).toContain('id="cartoon-vv"');
    expect(html).toContain('class="cartoon-demo"');
    expect(html).toContain('<script src="/feature-cartoons.js" defer></script>');
  });

  test("feature strip — 4 state badges + stop card", () => {
    expect(html).toContain('class="fl-state fl-state-indexed"');
    expect(html).toContain('class="fl-state fl-state-partial"');
    expect(html).toContain('class="fl-state fl-state-failed"');
    expect(html).toContain('class="fl-state fl-state-superseded"');
    expect(html).toContain('class="fl-stop-card"');
    expect(html).toContain('role="alert"');
  });

  test("buyer-fit section — Built for / Not the right fit", () => {
    expect(html).toContain('id="fl-fit-h"');
    expect(html).toContain("Who it's for.");
    expect(html).toContain("Built for");
    expect(html).toContain("Not the right fit");
    expect(html).toContain("standalone CMMS replacement");
  });

  test("pricing teaser leads with the $500 assessment → /buy", () => {
    expect(html).toContain("fl-pricing-teaser");
    expect(html).toContain("$500 assessment");
    expect(html).toMatch(/href="\/buy"[^>]*data-cta="pricing-teaser-primary"/);
  });

  test("footer with /limitations, /trust, /privacy, /terms", () => {
    expect(html).toContain('data-cta="footer-limitations"');
    expect(html).toMatch(/href="[^"]*\/trust"/);
    expect(html).toMatch(/href="[^"]*\/privacy"/);
    expect(html).toMatch(/href="[^"]*\/terms"/);
  });

  test("sun-readable toggle is visible in DOM", () => {
    expect(html).toContain('id="fl-sun-toggle"');
    expect(html).toContain('class="fl-sun-toggle"');
    expect(html).toContain("Sun-readable");
    expect(html).toContain('<script src="/sun-toggle.js"></script>');
  });

  test("every CTA carries a data-cta attribute (PostHog tracking)", () => {
    const ctaAttrs = html.match(/data-cta="[^"]+"/g) ?? [];
    expect(ctaAttrs.length).toBeGreaterThanOrEqual(8);
    expect(html).toContain('data-cta="hero-assessment"');
    expect(html).toContain('data-cta="hero-demo"');
    expect(html).toContain('data-cta="nav-cmms"');
    expect(html).toContain('data-cta="footer-privacy"');
  });

  test("JSON-LD includes Organization, WebSite, and Person (Mike Harper)", () => {
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
      "<title>FactoryLM — Maintenance Digital Transformation</title>"
    );
    expect(html).toMatch(/<meta name="description" content="[^"]+"/);
    expect(html).toContain('<link rel="canonical" href="https://factorylm.com/">');
  });

  test("token, component, and dark-theme stylesheets are linked", () => {
    expect(html).toContain('href="/_tokens.css"');
    expect(html).toContain('href="/_components.css"');
    expect(html).toContain('href="/_dark-theme.css"');
  });

  test("Document is well-formed HTML5", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toMatch(/<\/html>\s*$/);
  });
});
