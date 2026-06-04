/**
 * Pure sitemap XML builder.
 *
 * Extracted from server.ts so the URL set + per-page <lastmod> logic is unit
 * testable without importing the server module (which runs schema migration
 * and the drip scheduler on import).
 *
 * Per-page <lastmod>:
 *   - static/marketing pages → the site build/deploy date (`today`)
 *   - blog posts            → `updated ?? date`
 *   - fault codes           → `updated ?? today`
 * This replaces the previous behaviour of stamping every URL with the render
 * date, which made every page look "modified today" on each crawl.
 */

import type { BlogPost } from "../data/blog-posts.js";
import type { FaultCode } from "../data/fault-codes.js";

type ChangeFreq = "weekly" | "monthly" | "yearly";

interface SitemapPage {
  loc: string;
  priority: string;
  freq: ChangeFreq;
  lastmod: string;
}

/** Hand-maintained, non-content pages. New data-driven pages flow in via the
 *  blogPosts / faultCodes args — only this list needs editing by hand. */
const STATIC_PAGES: { loc: string; priority: string; freq: ChangeFreq }[] = [
  { loc: "/", priority: "1.0", freq: "weekly" },
  { loc: "/cmms", priority: "1.0", freq: "weekly" },
  { loc: "/pricing", priority: "0.9", freq: "weekly" },
  { loc: "/blog", priority: "0.9", freq: "weekly" },
  { loc: "/blog/fault-codes", priority: "0.8", freq: "weekly" },
  { loc: "/assess", priority: "0.7", freq: "monthly" },
  { loc: "/buy", priority: "0.6", freq: "monthly" },
  { loc: "/limitations", priority: "0.5", freq: "monthly" },
  { loc: "/security", priority: "0.5", freq: "monthly" },
  { loc: "/trust", priority: "0.4", freq: "monthly" },
  { loc: "/privacy", priority: "0.3", freq: "yearly" },
  { loc: "/terms", priority: "0.3", freq: "yearly" },
  { loc: "/legal/dpa", priority: "0.3", freq: "yearly" },
];

export function buildSitemapXml(
  baseUrl: string,
  today: string,
  blogPosts: BlogPost[],
  faultCodes: FaultCode[],
): string {
  const pages: SitemapPage[] = [
    ...STATIC_PAGES.map((p) => ({ ...p, lastmod: today })),
    ...blogPosts.map((p) => ({
      loc: `/blog/${p.slug}`,
      priority: "0.8",
      freq: "monthly" as const,
      lastmod: p.updated ?? p.date ?? today,
    })),
    ...faultCodes.map((fc) => ({
      loc: `/blog/${fc.slug}`,
      priority: "0.7",
      freq: "monthly" as const,
      lastmod: fc.updated ?? today,
    })),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (p) => `  <url>
    <loc>${baseUrl}${p.loc}</loc>
    <lastmod>${p.lastmod}</lastmod>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>`;
}
