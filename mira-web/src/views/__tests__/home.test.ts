import { describe, expect, test } from "bun:test";
import { renderHome } from "../home.js";
import { TALK_TO_MIKE_HREF } from "../_topbar.js";

describe("renderHome — approved-claims homepage", () => {
  const html = renderHome("https://factorylm.com/");

  test("hero: H1 FactoryLM, A5 H2/H3, A6 sub, Talk to Mike CTA", () => {
    expect(html).toContain('id="fl-hero-h1"');
    expect(html).toMatch(/<h1[^>]*>FactoryLM<\/h1>/);
    expect(html).toMatch(
      /<h2[^>]*>It's not a CMMS and doesn't replace yours\.<\/h2>/
    );
    expect(html).toMatch(/<h3[^>]*>There's nothing to switch\.<\/h3>/);
    expect(html).toContain("doesn't connect to PLCs");
    expect(html).toContain("doesn't write work orders");
    expect(html).toContain(TALK_TO_MIKE_HREF);
    expect(html).toContain('data-cta="hero-talk"');
    expect(html).toContain("Talk to Mike");
    expect(html).toContain('data-cta="hero-signin"');
  });

  test("keeps A7, A8, A9 and drops unapproved sections", () => {
    expect(html).toContain("For lockout, arc flash and confined space");
    expect(html).toContain("We've tested Rockwell and Festo manuals so far");
    expect(html).toContain("I'm Mike, I build FactoryLM, and I'm in Central Florida.");
    expect(html).not.toContain("68,000+");
    expect(html).not.toContain("F005");
    expect(html).not.toContain("Operating Layer");
    expect(html).not.toContain("Book $500");
    expect(html).not.toContain("feature-cartoons.js");
  });

  test("buyer-fit section — Built for / Not the right fit", () => {
    expect(html).toContain('id="fl-fit-h"');
    expect(html).toContain("Who it's for.");
    expect(html).toContain("Built for");
    expect(html).toContain("Not the right fit");
    expect(html).toContain("It's not a CMMS and doesn't replace yours.");
  });

  test("footer with /limitations, /trust, /privacy, /terms, /status", () => {
    expect(html).toContain('data-cta="footer-limitations"');
    expect(html).toMatch(/href="[^"]*\/trust"/);
    expect(html).toMatch(/href="[^"]*\/privacy"/);
    expect(html).toMatch(/href="[^"]*\/terms"/);
    expect(html).toMatch(/href="[^"]*\/status"/);
  });

  test("sun-readable toggle is visible in DOM", () => {
    expect(html).toContain('id="fl-sun-toggle"');
    expect(html).toContain("Sun-readable");
    expect(html).toContain('<script src="/sun-toggle.js"></script>');
  });

  test("every CTA carries a data-cta attribute", () => {
    const ctaAttrs = html.match(/data-cta="[^"]+"/g) ?? [];
    expect(ctaAttrs.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain('data-cta="hero-talk"');
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
    expect(JSON.stringify(parsed)).not.toMatch(/"price":\s*"(499|500|2000)"/);
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

  test("SEO: title, meta description, canonical", () => {
    expect(html).toContain("<title>FactoryLM</title>");
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
