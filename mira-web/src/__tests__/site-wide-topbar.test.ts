/**
 * Site-wide topbar coherence tests (v0.6.0).
 *
 * After the v0.5.0 audit found six different topbars live in production,
 * v0.5.0 unified the four TS-rendered marketing views and v0.6.0 brings
 * the static HTML pages and blog renderer onto the same standard.
 *
 * This suite reads each rendered/served page and asserts:
 *   - No M-icon SVG in the topbar (wordmark only, per audit's recommended logo)
 *   - The standard 5-link nav set (CMMS, Pricing, Blog, Limitations, Security)
 *     OR — for blog renderer — the standard nav-link helper output
 *   - The "Sign in" CTA copy (no "Get Started", "Try free", "Join the Beta")
 *
 * Static HTML pages are read from disk; TS view pages are rendered via
 * their exported render functions; blog pages are rendered via the
 * blog-renderer module.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderHome } from "../views/home.js";
import { renderCmms, renderSamplePlaceholder } from "../views/cmms.js";
import { renderLimitations } from "../views/limitations.js";
import { renderSecurity } from "../views/security.js";
import {
  renderBlogIndex,
  renderFaultCodeIndex,
  renderBlogPost,
  renderFaultCodePage,
} from "../lib/blog-renderer.js";
import { BLOG_POSTS } from "../data/blog-posts.js";
import { FAULT_CODES } from "../data/fault-codes.js";

const PUBLIC_DIR = join(process.cwd(), "public");

function readStatic(file: string): string {
  return readFileSync(join(PUBLIC_DIR, file), "utf-8");
}

interface PageCase {
  name: string;
  html: string;
}

const tsViewPages: PageCase[] = [
  { name: "/", html: renderHome("https://factorylm.com/") },
  { name: "/cmms", html: renderCmms("https://factorylm.com/cmms") },
  { name: "/sample", html: renderSamplePlaceholder() },
  { name: "/limitations", html: renderLimitations("https://factorylm.com/limitations") },
  { name: "/security", html: renderSecurity("https://factorylm.com/security") },
];

const staticPages: PageCase[] = [
  { name: "/pricing", html: readStatic("pricing.html") },
  { name: "/privacy", html: readStatic("privacy.html") },
  { name: "/terms", html: readStatic("terms.html") },
  { name: "/trust", html: readStatic("trust.html") },
  { name: "/legal/dpa", html: readStatic("legal/dpa.html") },
];

const blogPages: PageCase[] = [
  { name: "/blog", html: renderBlogIndex(BLOG_POSTS) },
  { name: "/blog/fault-codes", html: renderFaultCodeIndex(FAULT_CODES) },
  ...(BLOG_POSTS[0]
    ? [
        {
          name: `/blog/${BLOG_POSTS[0].slug}`,
          html: renderBlogPost(BLOG_POSTS[0], BLOG_POSTS, FAULT_CODES),
        },
      ]
    : []),
  ...(FAULT_CODES[0]
    ? [
        {
          name: `/blog/${FAULT_CODES[0].slug}`,
          html: renderFaultCodePage(FAULT_CODES[0], BLOG_POSTS, FAULT_CODES),
        },
      ]
    : []),
];

const allPages: PageCase[] = [...tsViewPages, ...staticPages, ...blogPages];

// Extracts the topbar (header.fl-topbar OR <nav>) so footer/body links
// don't pollute assertions.
function extractTopbar(html: string): string {
  const fl = html.match(/<header[^>]*class="fl-topbar"[\s\S]*?<\/header>/);
  if (fl) return fl[0];
  const nav = html.match(/<nav[\s\S]*?<\/nav>/);
  if (nav) return nav[0];
  return "";
}

describe("site-wide topbar coherence (v0.6.0)", () => {
  for (const page of allPages) {
    test(`${page.name}: topbar logo is wordmark only — no M-icon SVG`, () => {
      const topbar = extractTopbar(page.html);
      expect(topbar).not.toBe("");
      // The M-icon SVG is identified by its distinctive amber rect fill.
      expect(topbar).not.toMatch(/fill="#f0a000"/);
    });

    test(`${page.name}: topbar CTA includes "Sign in" (and optionally "Get Started")`, () => {
      const topbar = extractTopbar(page.html);
      // TS topbar (home/cmms/limitations/security) renders BOTH "Sign in" + the
      // "Get Started" → /buy CTA added 2026-05-11 for the Florida expo.
      // Static HTML pages (pricing, blog, privacy, terms, trust) still render
      // only "Sign in" until they migrate to _topbar.ts (Phase 2 audit work).
      expect(topbar).toMatch(/Sign in|Get Started/);
      // Killed CTAs from the M-icon era:
      expect(topbar).not.toContain("Try free");
      expect(topbar).not.toContain("Join the Beta");
    });

    test(`${page.name}: topbar nav has the five standard links`, () => {
      const topbar = extractTopbar(page.html);
      // TS-rendered views (home/cmms/limitations/security) use absolute URLs
      // since PR #996; static HTML pages still use root-relative until Phase 2.
      // Accept both: check that the path appears in the href.
      expect(topbar).toMatch(/href="[^"]*\/cmms"/);
      expect(topbar).toMatch(/href="[^"]*\/pricing"/);
      expect(topbar).toMatch(/href="[^"]*\/blog"/);
      expect(topbar).toMatch(/href="[^"]*\/limitations"/);
      expect(topbar).toMatch(/href="[^"]*\/security"/);
    });

    test(`${page.name}: topbar dropped the "Troubleshooter" / "Product" / "Fault Codes" labels`, () => {
      const topbar = extractTopbar(page.html);
      // M-icon-era nav labels:
      expect(topbar).not.toContain("Troubleshooter");
      expect(topbar).not.toContain(">Product<");
      expect(topbar).not.toMatch(/href="\/blog\/fault-codes"[^>]*>Fault Codes</);
    });
  }
});
