import { describe, expect, test } from "bun:test";
import { renderHome } from "../home.js";

describe("renderHome — product-aligned homepage", () => {
  const html = renderHome("https://factorylm.com/");

  test("hero leads with the two standalone products", () => {
    expect(html).toContain('id="fl-hero-h1"');
    expect(html).toContain("Understand drive faults and electrical prints faster.");
    expect(html).toContain("<strong>PrintSense</strong>");
    expect(html).toContain("<strong>Drive Commander</strong>");
    expect(html).not.toContain("Book $500 Assessment");
  });

  test("hero CTAs open PrintSense and Drive Commander", () => {
    expect(html).toMatch(
      /href="\/printsense"[^>]*data-cta="hero-printsense"[^>]*>Open PrintSense<\/a>/
    );
    expect(html).toMatch(
      /href="\/drive-commander\/siemens-g120"[^>]*data-cta="hero-drive-commander"[^>]*>Open Drive Commander<\/a>/
    );
  });

  test("product cards make PrintSense and Drive Commander co-equal front doors", () => {
    expect(html).toContain('aria-label="PrintSense"');
    expect(html).toContain('aria-label="Drive Commander"');
    expect(html).toContain("Send a print page, photo set, or package.");
    expect(html).toContain("$29/month or $197/year");
  });

  test("PrintSense promise includes continued chat and honest uncertainty", () => {
    expect(html).toContain("Continuing conversation about the same machine");
    expect(html).toContain("Unreadable or uncertain areas declared instead of guessed");
    expect(html).toContain("Self-serve entry through Telegram today");
  });

  test("FactoryLM and MIRA are the expansion path, not the primary offer", () => {
    expect(html).toContain("Solve one problem first. Expand only when it earns trust.");
    expect(html).toContain("PrintSense or Drive Commander");
    expect(html).toContain("MIRA");
    expect(html).toContain("FactoryLM platform");
    expect(html).toContain("An assessment is optional sales assistance");
  });

  test("trust band retains OEM coverage", () => {
    expect(html).toContain('class="fl-trust-band"');
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

  test("all visible actions carry data-cta analytics attributes", () => {
    const ctaAttrs = html.match(/data-cta="[^"]+"/g) ?? [];
    expect(ctaAttrs.length).toBeGreaterThanOrEqual(12);
    expect(html).toContain('data-cta="hero-printsense"');
    expect(html).toContain('data-cta="hero-drive-commander"');
    expect(html).toContain('data-cta="nav-printsense"');
    expect(html).toContain('data-cta="nav-drive-commander"');
    expect(html).toContain('data-cta="footer-privacy"');
  });

  test("JSON-LD describes both standalone products and the company", () => {
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
    );
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    const names = parsed["@graph"].map((node: { name?: string }) => node.name);
    expect(names).toContain("FactoryLM");
    expect(names).toContain("PrintSense");
    expect(names).toContain("Drive Commander");
  });

  test("SEO describes the current product hierarchy", () => {
    expect(html).toContain("<title>FactoryLM — PrintSense and Drive Commander</title>");
    expect(html).toContain(
      "Chat with electrical prints using PrintSense, or get cited drive fault and parameter answers with Drive Commander."
    );
    expect(html).toContain('<link rel="canonical" href="https://factorylm.com/">');
  });

  test("accessibility and shared chrome remain intact", () => {
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toContain('id="fl-sun-toggle"');
    expect(html).toContain('<script src="/sun-toggle.js"></script>');
    expect(html).toContain('href="/_tokens.css"');
    expect(html).toContain('href="/_components.css"');
    expect(html).toContain('href="/_dark-theme.css"');
  });

  test("document is well-formed HTML5", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toMatch(/<\/html>\s*$/);
  });
});
