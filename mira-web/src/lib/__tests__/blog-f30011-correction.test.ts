import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FAULT_CODES } from "../../data/fault-codes.js";
import { blogRedirectPath, BLOG_PERMANENT_REDIRECTS } from "../../data/blog-redirects.js";
import { renderFaultCodePage } from "../blog-renderer.js";
import { renderMarkdown, visibleText } from "../markdown.js";
import { buildSitemapXml } from "../sitemap.js";
import { BLOG_POSTS } from "../../data/blog-posts.js";
import { app } from "../../server.js";

const OLD_SLUG = "siemens-f30011-heatsink-overtemp";
const NEW_SLUG = "siemens-g120c-f30011-line-phase-failure";
const APPROVED_BODY = readFileSync(
  join(import.meta.dir, "../../data/fault-code-bodies/siemens-g120c-f30011-line-phase-failure.md"),
  "utf8",
);

const TITLE = "SINAMICS G120C F30011: line phase failure in the main circuit";
const DESCRIPTION =
  "On SINAMICS G120C, F30011 is Power unit: Line phase failure in main circuit, caused by excessive DC link voltage ripple. Heatsink overtemperature is F30004.";

describe("Siemens G120C F30011 correction", () => {
  const entry = FAULT_CODES.find((fc) => fc.slug === NEW_SLUG);

  test("the published entry uses the approved title, description, slug, and exact body", () => {
    expect(entry).toBeDefined();
    expect(entry!.title).toBe(TITLE);
    expect(entry!.description).toBe(DESCRIPTION);
    expect(entry!.metaDescription).toBe(DESCRIPTION);
    expect(entry!.body).toBe(APPROVED_BODY);
    expect(entry!.body!.startsWith(`# ${TITLE}\n`)).toBe(true);
    expect(FAULT_CODES.some((fc) => fc.slug === OLD_SLUG)).toBe(false);
  });

  test("no remaining hard-coded reference to the old slug except the 301 map", () => {
    expect(BLOG_PERMANENT_REDIRECTS[OLD_SLUG]).toBe(NEW_SLUG);
    expect(blogRedirectPath(OLD_SLUG)).toBe(`/blog/${NEW_SLUG}`);
    expect(blogRedirectPath(NEW_SLUG)).toBeNull();
    const related = FAULT_CODES.flatMap((fc) => fc.relatedCodes);
    expect(related).toContain(NEW_SLUG);
    expect(related).not.toContain(OLD_SLUG);
    const relatedFromPosts = BLOG_POSTS.flatMap((p) => p.relatedFaultCodes);
    expect(relatedFromPosts).toContain(NEW_SLUG);
    expect(relatedFromPosts).not.toContain(OLD_SLUG);
    const overtemp = BLOG_POSTS.flatMap((p) =>
      p.sections.flatMap((s) => s.items ?? []),
    ).find((item) => item.startsWith("Overtemperature"));
    expect(overtemp).toBeDefined();
    expect(overtemp!).not.toContain("F30011");
  });

  test("the rendered article body is the approved markdown, word for word", () => {
    const html = renderFaultCodePage(entry!, FAULT_CODES);
    const start = html.indexOf('<article class="article-wrap">');
    const end = html.indexOf("</article>");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const article = html.slice(start, end);
    const breadcrumbEnd = article.indexOf("</div>");
    const bodyHtml = article.slice(breadcrumbEnd + "</div>".length).trim();
    expect(bodyHtml).toBe(renderMarkdown(APPROVED_BODY));
    expect(visibleText(bodyHtml)).toBe(visibleText(renderMarkdown(APPROVED_BODY)));
    expect(html).not.toContain("What This Fault Means");
    expect(html).not.toContain("Still stuck? Ask Mira.");
    expect(html).not.toContain("Power Module Overtemperature");
    expect(html).toContain(TITLE);
    expect(html).toContain(DESCRIPTION);
  });

  test("sitemap lists the new slug and drops the old one", () => {
    const xml = buildSitemapXml("https://factorylm.com", "2026-11-26", BLOG_POSTS, FAULT_CODES);
    expect(xml).toContain(`<loc>https://factorylm.com/blog/${NEW_SLUG}</loc>`);
    expect(xml).not.toContain(`<loc>https://factorylm.com/blog/${OLD_SLUG}</loc>`);
    expect(xml).toContain("<lastmod>2026-11-25</lastmod>");
  });

  test("GET /blog/<old-slug> is a 301 to the new slug; the new slug serves the correction", async () => {
    const moved = await app.request(`/blog/${OLD_SLUG}`, { redirect: "manual" });
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe(`/blog/${NEW_SLUG}`);

    const page = await app.request(`/blog/${NEW_SLUG}`, { redirect: "manual" });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(TITLE);
    expect(html).toContain("Line phase failure in main circuit");
    expect(html).not.toContain("Power Module Overtemperature");
  });
});
