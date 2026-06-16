import { describe, expect, it } from "bun:test";

import { buildSitemapXml } from "../sitemap.js";
import { BLOG_POSTS } from "../../data/blog-posts.js";
import { FAULT_CODES } from "../../data/fault-codes.js";

const BASE = "https://factorylm.com";
const TODAY = "2026-05-29";

describe("buildSitemapXml()", () => {
  const xml = buildSitemapXml(BASE, TODAY, BLOG_POSTS, FAULT_CODES);

  it("is well-formed urlset XML", () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("includes the key indexable marketing pages", () => {
    for (const path of ["/", "/cmms", "/pricing", "/blog", "/blog/fault-codes", "/assess", "/buy"]) {
      expect(xml).toContain(`<loc>${BASE}${path}</loc>`);
    }
  });

  it("includes every blog post and fault code", () => {
    for (const p of BLOG_POSTS) expect(xml).toContain(`<loc>${BASE}/blog/${p.slug}</loc>`);
    for (const fc of FAULT_CODES) expect(xml).toContain(`<loc>${BASE}/blog/${fc.slug}</loc>`);
  });

  it("emits one <url> per page with no duplicate locs", () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("uses a blog post's `date` for <lastmod> when `updated` is unset", () => {
    const post = BLOG_POSTS[0]!;
    const expected = post.updated ?? post.date ?? TODAY;
    const block = xml.match(
      new RegExp(`<loc>${BASE}/blog/${post.slug}</loc>\\s*<lastmod>([^<]+)</lastmod>`),
    );
    expect(block?.[1]).toBe(expected);
  });

  it("prefers an explicit `updated` date over the fallback", () => {
    const xml2 = buildSitemapXml(
      BASE,
      TODAY,
      [{ ...BLOG_POSTS[0]!, slug: "edited-post", date: "2026-01-01", updated: "2026-05-01" }],
      [],
    );
    expect(xml2).toMatch(
      new RegExp(`<loc>${BASE}/blog/edited-post</loc>\\s*<lastmod>2026-05-01</lastmod>`),
    );
  });
});
