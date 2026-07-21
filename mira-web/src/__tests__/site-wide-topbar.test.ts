/**
 * Site navigation migration contract.
 *
 * The product-alignment release moves the live buyer path to:
 *   PrintSense / Drive Commander / Pricing / Platform / Security.
 *
 * TS-rendered marketing pages and pricing are aligned in this slice. Older
 * legal/blog templates keep their existing safe navigation until their shared
 * renderer is migrated; this suite prevents either group from silently drifting.
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

const productAlignedPages: PageCase[] = [
  { name: "/", html: renderHome("https://factorylm.com/") },
  { name: "/cmms", html: renderCmms("https://factorylm.com/cmms") },
  { name: "/sample", html: renderSamplePlaceholder() },
  {
    name: "/limitations",
    html: renderLimitations("https://factorylm.com/limitations"),
  },
  { name: "/security", html: renderSecurity("https://factorylm.com/security") },
  { name: "/pricing", html: readStatic("pricing.html") },
];

const legacyTemplatePages: PageCase[] = [
  { name: "/privacy", html: readStatic("privacy.html") },
  { name: "/terms", html: readStatic("terms.html") },
  { name: "/trust", html: readStatic("trust.html") },
  { name: "/legal/dpa", html: readStatic("legal/dpa.html") },
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

function extractTopbar(html: string): string {
  const shared = html.match(/<header[^>]*class="fl-topbar"[\s\S]*?<\/header>/);
  if (shared) return shared[0];
  const nav = html.match(/<nav[\s\S]*?<\/nav>/);
  return nav?.[0] ?? "";
}

describe("site navigation — aligned buyer path", () => {
  for (const page of productAlignedPages) {
    test(`${page.name}: exposes both standalone products`, () => {
      const topbar = extractTopbar(page.html);
      expect(topbar).not.toBe("");
      expect(topbar).toMatch(/href="[^"]*\/printsense"/);
      expect(topbar).toMatch(/href="[^"]*\/drive-commander\/siemens-g120"/);
      expect(topbar).toMatch(/href="[^"]*\/pricing"/);
      expect(topbar).toMatch(/href="[^"]*\/cmms"/);
      expect(topbar).toMatch(/href="[^"]*\/security"/);
    });

    test(`${page.name}: assessment is not the primary CTA`, () => {
      const topbar = extractTopbar(page.html);
      expect(topbar).not.toContain("Book $500 Assessment");
      expect(topbar).not.toContain("not a self-serve SaaS");
      expect(topbar).not.toContain("Why not a self-serve SaaS");
    });

    test(`${page.name}: topbar uses the FactoryLM wordmark`, () => {
      const topbar = extractTopbar(page.html);
      expect(topbar).not.toBe("");
      expect(topbar).not.toMatch(/fill="#f0a000"/);
      expect(topbar).toContain("FactoryLM");
    });
  }
});

describe("site navigation — legacy template safety until migration", () => {
  for (const page of legacyTemplatePages) {
    test(`${page.name}: keeps a usable route back to product discovery`, () => {
      const topbar = extractTopbar(page.html);
      expect(topbar).not.toBe("");
      expect(topbar).toMatch(/href="[^"]*\/pricing"/);
      expect(topbar).toMatch(/href="[^"]*\/security"/);
    });

    test(`${page.name}: rejects dead historical CTA labels`, () => {
      const topbar = extractTopbar(page.html);
      expect(topbar).not.toContain("Try free");
      expect(topbar).not.toContain("Join the Beta");
      expect(topbar).not.toContain("Troubleshooter");
      expect(topbar).not.toMatch(/href="\/blog\/fault-codes"[^>]*>Fault Codes</);
    });
  }
});
