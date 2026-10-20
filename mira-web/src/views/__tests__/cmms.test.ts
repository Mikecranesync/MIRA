import { describe, expect, test } from "bun:test";
import { renderCmms, renderSamplePlaceholder } from "../cmms.js";

describe("renderCmms — sign-in only", () => {
  const html = renderCmms("https://factorylm.com/cmms");

  test("AC1: page shows ONE visible email input (+ hidden plan field) and one CTA", () => {
    const inputCount = (html.match(/<input\b/g) || []).length;
    expect(inputCount).toBe(2);
    const emailIds = (html.match(/id="cmms-email"/g) || []).length;
    expect(emailIds).toBe(1);
    expect(html).toContain('type="email"');
    expect(html).toContain('autocomplete="email"');
    expect(html).toContain("required");
  });

  test("AC1: single primary CTA labeled 'Send magic link'", () => {
    const submits = html.match(/<button[^>]*type="submit"/g) || [];
    expect(submits.length).toBe(1);
    expect(html).toContain("Send magic link");
    expect(html).toContain('id="fl-magic-submit"');
  });

  test("AC2: form posts to /api/magic-link", () => {
    expect(html).toContain("/api/magic-link");
    expect(html).toContain("method: 'POST'");
  });

  test("does not sell CMMS write-back, F005, or priced offers", () => {
    expect(html).toContain("It's not a CMMS");
    expect(html).not.toContain("Operating Layer");
    expect(html).not.toContain("CMMS write-back");
    expect(html).not.toContain("F005");
    expect(html).not.toContain("$499");
    expect(html).not.toContain("$500 Assessment");
  });

  test("AC6: sun-readable toggle present", () => {
    expect(html).toContain('id="fl-sun-toggle"');
    expect(html).toContain("Sun-readable");
    expect(html).toContain('<script src="/sun-toggle.js"></script>');
  });

  test("Form has aria-describedby pointing at error region", () => {
    expect(html).toMatch(/aria-describedby="fl-form-error"/);
    expect(html).toMatch(/id="fl-form-error"[^>]*role="alert"/);
  });

  test("Form has hidden but semantic label for screen readers", () => {
    expect(html).toMatch(/<label for="cmms-email">Work email<\/label>/);
  });

  test("Accessibility: exactly one H1", () => {
    const h1 = (html.match(/<h1\b/g) || []).length;
    expect(h1).toBe(1);
  });

  test("Accessibility: heading hierarchy has no skips", () => {
    const headings = Array.from(html.matchAll(/<h([1-6])\b/g)).map((m) =>
      Number(m[1])
    );
    let prev = 0;
    for (const level of headings) {
      if (prev !== 0) expect(level - prev).toBeLessThanOrEqual(1);
      prev = Math.max(prev, level);
    }
    expect(headings[0]).toBe(1);
  });

  test("SEO: title + canonical + description", () => {
    expect(html).toContain("<title>Sign in — FactoryLM</title>");
    expect(html).toContain('<link rel="canonical" href="https://factorylm.com/cmms">');
    expect(html).toMatch(/<meta name="description" content="Sign in to FactoryLM/);
  });

  test("Tokens + components stylesheets are linked via head()", () => {
    expect(html).toContain('href="/_tokens.css"');
    expect(html).toContain('href="/_components.css"');
  });

  test("PostHog data-cta tags on CTAs", () => {
    expect(html).toContain('data-cta="cmms-magic-link-submit"');
    expect(html).toContain('data-cta="cmms-nav-pricing"');
  });
});

describe("renderSamplePlaceholder — Phase-0 /sample destination", () => {
  const html = renderSamplePlaceholder();

  test("Tells user they're signed in", () => {
    expect(html).toContain("You're signed in.");
  });

  test("Has primary CTA to upload first manual", () => {
    expect(html).toContain("Upload your first manual");
    expect(html).toMatch(/href="\/activated"[^>]*class="fl-btn fl-btn-primary"/);
  });

  test("Has secondary back-to-home CTA", () => {
    expect(html).toContain("Back to home");
    expect(html).toMatch(/href="\/"[^>]*class="fl-btn fl-btn-ghost"/);
  });

  test("Does not claim OCR or citations", () => {
    expect(html).not.toContain("OCR");
    expect(html).not.toContain("citations");
  });

  test("SEO: title set; canonical points at /sample", () => {
    expect(html).toContain("Your sample workspace — FactoryLM");
    expect(html).toContain('<link rel="canonical" href="https://factorylm.com/sample">');
  });
});
