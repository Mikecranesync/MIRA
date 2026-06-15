import { describe, expect, test } from "bun:test";
import { renderCmms, renderSamplePlaceholder } from "../cmms.js";

describe("#SO-070 renderCmms — magic-link landing acceptance", () => {
  const html = renderCmms("https://factorylm.com/cmms");

  test("AC1: page shows ONE visible email input (+ hidden plan field) and one CTA", () => {
    // Exactly one user-facing input (the work email) plus a hidden `cmms-plan`
    // field that carries plan intent → total <input> count is 2.
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
    expect(html).toContain('method: \'POST\'');
  });

  test("AC5: 3-step 'Operating Layer is one component' strip with stateBadge markers", () => {
    expect(html).toContain('aria-labelledby="fl-steps-h"');
    expect(html).toContain("The Operating Layer is one component.");
    const stepCount = (html.match(/<li class="fl-step">/g) || []).length;
    expect(stepCount).toBe(3);
    expect(html).toContain("fl-state-indexed");
    expect(html).toContain("Asset hierarchy + nameplates");
    expect(html).toContain("CMMS write-back");
    expect(html).toContain("MIRA on the floor");
  });

  test("AC6: compareBlock — generic AI vs MIRA on a namespace is present", () => {
    expect(html).toContain('class="fl-compare"');
    expect(html).toContain("Generic AI");
    expect(html).toContain("MIRA");
    expect(html).toContain("PowerFlex 755");
  });

  test("AC6: sun-readable toggle present", () => {
    expect(html).toContain('id="fl-sun-toggle"');
    expect(html).toContain("Sun-readable");
    expect(html).toContain('<script src="/sun-toggle.js"></script>');
  });

  test("Reassurance copy: 'No credit card. No call. No demo.'", () => {
    expect(html).toContain("No credit card. No call. No demo.");
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

  test("SEO: title + canonical + description match spec", () => {
    expect(html).toContain(
      "<title>Maintenance Operating Layer — FactoryLM</title>"
    );
    expect(html).toContain('<link rel="canonical" href="https://factorylm.com/cmms">');
    expect(html).toMatch(/<meta name="description" content="Sign in to the Operating Layer/);
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

describe("#SO-070 renderSamplePlaceholder — Phase-0 /sample destination", () => {
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

  test("Mentions Phase 1 sample workspace truthfully", () => {
    expect(html).toContain("Phase 1 ships");
    expect(html).toContain("upload your first manual");
  });

  test("SEO: title set; canonical points at /sample", () => {
    expect(html).toContain("Your sample workspace — FactoryLM");
    expect(html).toContain('<link rel="canonical" href="https://factorylm.com/sample">');
  });
});
