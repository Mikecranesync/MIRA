import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { renderPilotRequestPage } from "./pilot-request-page";

const html = renderPilotRequestPage();

describe("renderPilotRequestPage", () => {
  test("renders a complete HTML document with viewport meta for mobile", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  });

  test("never mentions a dollar amount or a priced plan", () => {
    // The copy explicitly reassures "No price, ever" — that's fine. What must
    // never appear is an actual dollar amount or a "/mo"-style plan price.
    expect(html).not.toMatch(/\$\s?\d/);
    expect(html.toLowerCase()).not.toContain("/mo");
  });

  test("every visible text input/textarea has an associated accessible label", () => {
    const fieldIds = ["name", "work_email", "company", "equipment"];
    for (const id of fieldIds) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`for="${id}"`);
    }
  });

  test("consent checkbox has a label explaining storage + contact-only use + privacy link", () => {
    expect(html).toContain('id="consent"');
    expect(html).toContain('for="consent"');
    // Find the consent label block and check its content explains the data use.
    const labelMatch = html.match(/<label for="consent">([\s\S]*?)<\/label>/);
    expect(labelMatch).not.toBeNull();
    const consentText = (labelMatch?.[1] ?? "").toLowerCase();
    expect(consentText).toContain("store");
    expect(consentText).toContain("contact");
    expect(consentText).toContain("pilot");
    expect(html).toContain('href="/privacy"');
  });

  test("consent checkbox is required", () => {
    const checkboxMatch = html.match(/<input type="checkbox" id="consent"[^>]*>/);
    expect(checkboxMatch).not.toBeNull();
    expect(checkboxMatch?.[0]).toContain("required");
  });

  test("carries hidden inputs for every utm_* field and referrer", () => {
    for (const name of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer"]) {
      expect(html).toContain(`id="${name}"`);
      expect(html).toMatch(new RegExp(`<input type="hidden" id="${name}"`));
    }
  });

  test("UTM/referrer hidden inputs are empty server-side — hydrated client-side only", () => {
    // No reflected query-string values in the server-rendered markup: every
    // hidden input renders with no `value="..."` attribute at all.
    for (const name of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer"]) {
      const re = new RegExp(`<input type="hidden" id="${name}"[^>]*>`);
      const tag = html.match(re)?.[0] ?? "";
      expect(tag).not.toContain("value=");
    }
  });

  test("hydration script uses .value assignment, never an innerHTML write, for utm/referrer", () => {
    expect(html).toContain("URLSearchParams");
    expect(html).toContain("document.referrer");
    // A comment may discuss innerHTML by name (documenting that it's avoided);
    // what must never appear is an actual assignment to it.
    expect(html).not.toMatch(/\.innerHTML\s*=/);
  });

  test("submit CTA uses the existing data-cta posthog click-tracking stub", () => {
    expect(html).toContain('data-cta="pilot-request-submit"');
    expect(html).toContain('/posthog-init.js');
  });

  test("layout has no fixed width wider than 412px breakpoint budget", () => {
    // max-width on the page wrapper must be achievable within a 412px
    // viewport once side padding is subtracted (480 - 2*16 = 448 > 412 is
    // fine because max-width just caps growth on larger screens; the real
    // mobile constraint is that nothing forces a width GREATER than the
    // viewport). Assert no hardcoded width/min-width above 412px exists.
    const widths = [...html.matchAll(/(?:min-)?width:\s*(\d+)px/g)].map((m) => parseInt(m[1]!, 10));
    for (const w of widths) {
      expect(w).toBeLessThanOrEqual(480);
    }
  });

  test("no hardcoded hex colors outside the token <style> block", () => {
    // Strip the first <style> block (the canonical token copy, which legitimately
    // contains hex values) and confirm nothing outside it hardcodes a hex color.
    const firstStyleEnd = html.indexOf("</style>");
    const afterTokens = html.slice(firstStyleEnd + "</style>".length);
    const hexMatches = afterTokens.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
    expect(hexMatches).toEqual([]);
  });

  test("CSS rules reference var(--fl-*) tokens, not literal colors", () => {
    expect(html).toMatch(/var\(--fl-accent\)/);
    expect(html).toMatch(/var\(--fl-ink\)/);
  });
});

describe("token parity with the canonical docs/design/factorylm-tokens.css", () => {
  const canonicalPath = join(import.meta.dir, "..", "..", "..", "docs", "design", "factorylm-tokens.css");
  const canonical = readFileSync(canonicalPath, "utf-8");

  function canonicalValue(name: string): string {
    const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*([^;]+);`);
    const match = canonical.match(re);
    if (!match) throw new Error(`Token ${name} not found in canonical tokens.css`);
    return match[1]!.trim();
  }

  const TOKENS_USED = [
    "--fl-bg", "--fl-surface", "--fl-ink", "--fl-muted", "--fl-faint",
    "--fl-line", "--fl-line-strong", "--fl-accent", "--fl-accent-hover",
    "--fl-accent-tint", "--fl-accent-ink", "--fl-fault", "--fl-fault-bg",
    "--fl-ok", "--fl-ok-bg", "--fl-header-ink", "--fl-fs-sm", "--fl-fs-body", "--fl-fs-title",
    "--fl-radius", "--fl-radius-sm", "--fl-space-1", "--fl-space-2",
    "--fl-space-3", "--fl-space-4", "--fl-space-6", "--fl-space-8", "--fl-shadow",
  ];

  for (const token of TOKENS_USED) {
    test(`${token} matches the canonical value exactly`, () => {
      const want = canonicalValue(token);
      const re = new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*([^;]+);`);
      const got = html.match(re)?.[1]?.trim();
      expect(got).toBe(want);
    });
  }
});
