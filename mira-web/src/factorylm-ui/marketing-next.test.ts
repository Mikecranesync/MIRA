import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { Hono } from "hono";
import { createFactorylmMarketingRouter, INDEXNOW_KEY } from "./marketing-next";

const priorFlag = process.env.FACTORYLM_MARKETING_NEXT;
const priorHub = process.env.PLG_HUB_URL;
const priorFree = process.env.MIRA_FREE_TECHNICIANS;
beforeEach(() => { process.env.MIRA_FREE_TECHNICIANS = "true"; });
afterEach(() => {
  if (priorFlag === undefined) delete process.env.FACTORYLM_MARKETING_NEXT;
  else process.env.FACTORYLM_MARKETING_NEXT = priorFlag;
  if (priorHub === undefined) delete process.env.PLG_HUB_URL;
  else process.env.PLG_HUB_URL = priorHub;
  if (priorFree === undefined) delete process.env.MIRA_FREE_TECHNICIANS;
  else process.env.MIRA_FREE_TECHNICIANS = priorFree;
});

function app() {
  return new Hono().route("/", createFactorylmMarketingRouter()).all("*", (c) =>
    c.json({ upstream: true, path: c.req.path, method: c.req.method }));
}

describe("next FactoryLM public adapter", () => {
  test("does not publish the free offer while the free-access rollout is disabled", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    process.env.MIRA_FREE_TECHNICIANS = "false";
    expect(await (await app().request("/")).json()).toMatchObject({ upstream: true });
  });
  test("default off preserves the current website", async () => {
    delete process.env.FACTORYLM_MARKETING_NEXT;
    const response = await app().request("/");
    expect(await response.json()).toMatchObject({ upstream: true });
    expect(response.headers.get("x-factorylm-site")).toBeNull();
  });

  test("serves the checked marketing page with real account handoff and no preview signup", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    delete process.env.PLG_HUB_URL;
    const response = await app().request("/");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-factorylm-site")).toMatch(/^next-[a-f0-9]{16}$/);
    expect(html).toContain('href="https://app.factorylm.com/signup/"');
    expect(html).toContain("Free for technicians");
    expect(html).not.toContain("data-preview-form");
    expect(html).not.toContain("data-preview-bar");
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(html)));
  });

  test("staging signup/login go only to the configured staging app and cannot be indexed", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    process.env.PLG_HUB_URL = "https://app-staging.factorylm.com";
    const response = await app().request("/start");
    const html = await response.text();
    expect(html).toContain("https://app-staging.factorylm.com/signup/");
    expect(html).toContain("https://app-staging.factorylm.com/login/");
    expect(html).not.toContain("https://app.factorylm.com/signup/");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(html)));
  });

  test("HEAD returns the same page length and no body", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const server = app();
    const get = await server.request("/mira");
    const head = await server.request("/mira", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(get.headers.get("content-length"));
    expect(await head.text()).toBe("");
  });

  test("legacy redirects preserve campaign query strings", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const response = await app().request("/pricing?utm_source=maintenance");
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBe("/demo?utm_source=maintenance");
  });

  test.each(["/api/health", "/api/stripe/webhook", "/privacy", "/terms", "/security", "/trust", "/status", "/cmms", "/signup", "/sitemap.xml", "/blog", "/blog/", "/blog/fault-codes"])("leaves %s with its existing handler", async (path) => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const response = await app().request(path);
    expect(await response.json()).toMatchObject({ upstream: true, path });
  });

  test("free policy is canonical and available before marketing activation, without changing legacy terms", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "false";
    process.env.MIRA_FREE_TECHNICIANS = "false";
    const response = await app().request("/free-technicians");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('href="https://factorylm.com/terms"');
    expect((await app().request("/factorylm-next-assets/next.css")).status).toBe(200);
    expect(await (await app().request("/terms")).json()).toMatchObject({ upstream: true });
  });
  test("new database-backed blog articles remain discoverable through the existing index", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const server = new Hono().route("/", createFactorylmMarketingRouter()).get("/blog", c => c.html('<a href="/blog/fresh-published-article">Fresh database article</a>'));
    expect(await (await server.request("/blog")).text()).toContain("fresh-published-article");
  });
  test("calendar availability is external and works under the existing CSP", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const html = await (await app().request("/demo")).text();
    expect(html).not.toContain("<iframe");
    expect(html).toContain('href="https://calendly.com/mike-cranesync/30min"');
  });

  test("POST remains POST and reaches the existing API handler", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const response = await app().request("/api/stripe/webhook", { method: "POST", body: "test-event" });
    expect(await response.json()).toMatchObject({ upstream: true, method: "POST" });
  });

  test("exposes only allowlisted assets and serves a real 404 for missing ones", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const response = await app().request("/factorylm-next-assets/site.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    const missing = await app().request("/factorylm-next-assets/private-notes.json");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("This page isn’t on the floor");
  });

  test("AI-assistant summaries come from the new site while it is on, and the old ones when it is off", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    for (const path of ["/llms.txt", "/llms-full.txt"]) {
      const response = await app().request(path);
      const text = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(text).toContain("Free for individual technicians");
      expect(text).toContain("https://app.factorylm.com/signup/");
      expect(text).not.toContain("factorylm.com/cmms");
    }
    process.env.FACTORYLM_MARKETING_NEXT = "false";
    expect(await (await app().request("/llms.txt")).json()).toMatchObject({ upstream: true });
  });

  test.each(["/", "/mira", "/about", "/start", "/demo", "/limitations", "/free-technicians"])("%s has search-length tags, a JPEG preview and valid structured data", async (path) => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const html = await (await app().request(path)).text();
    const decode = (s: string) => s.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
    const title = decode(html.match(/<title>(.*?)<\/title>/)![1]);
    const description = decode(html.match(/<meta name="description" content="([^"]*)">/)![1]);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(description.length).toBeGreaterThanOrEqual(120);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(html).toContain('<meta property="og:image" content="https://factorylm.com/factorylm-next-assets/assets/og-image.jpg">');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
    expect(blocks).toHaveLength(1);
    const graph = JSON.parse(blocks[0][1])["@graph"] as { "@type": string }[];
    expect(graph.map((node) => node["@type"])).toEqual(expect.arrayContaining(["Organization", "WebSite"]));
    const image = await app().request("/factorylm-next-assets/assets/og-image.jpg");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/jpeg");
  });

  test("the legacy sitemap drops retired pages and lists every new page, only while the new site is on", async () => {
    const legacy = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
      + ["/", "/cmms", "/pricing", "/blog", "/blog/fault-codes", "/assess", "/buy", "/limitations", "/drive-commander/siemens-g120/faults/F7011"]
        .map((path) => `\n  <url>\n    <loc>https://factorylm.com${path}</loc>\n  </url>`).join("") + "\n</urlset>\n";
    const server = new Hono().route("/", createFactorylmMarketingRouter())
      .get("/sitemap.xml", () => new Response(legacy, { headers: { "Content-Type": "application/xml; charset=utf-8" } }));
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const response = await server.request("/sitemap.xml");
    const xml = await response.text();
    const locs = [...xml.matchAll(/<loc>https:\/\/factorylm\.com([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("xml");
    for (const gone of ["/pricing", "/cmms", "/assess", "/buy", "/404"]) expect(locs).not.toContain(gone);
    for (const kept of ["/", "/blog", "/blog/fault-codes", "/limitations", "/drive-commander/siemens-g120/faults/F7011"]) expect(locs).toContain(kept);
    for (const added of ["/mira", "/about", "/start", "/demo", "/free-technicians"]) expect(locs).toContain(added);
    expect(new Set(locs).size).toBe(locs.length);
    expect(xml.trim().endsWith("</urlset>")).toBe(true);
    // Codex cheap-lane finding: added pages carry their recorded edit date, not the request date.
    expect(xml).toContain("<loc>https://factorylm.com/mira</loc>\n    <lastmod>2026-11-22</lastmod>");
    setSystemTime(new Date("2031-06-15T12:00:00Z"));
    try {
      expect(await (await server.request("/sitemap.xml")).text()).not.toContain("2031-06-15");
    } finally { setSystemTime(); }
    process.env.FACTORYLM_MARKETING_NEXT = "false";
    expect(await (await server.request("/sitemap.xml")).text()).toBe(legacy);
  });

  test.each(["/assess", "/buy", "/assess/"])("retired offer page %s goes to the demo page", async (path) => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const response = await app().request(path);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/demo");
  });

  test("serves the IndexNow ownership key at its documented path", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const response = await app().request(`/${INDEXNOW_KEY}.txt`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEXNOW_KEY);
  });

  test("disabling the flag immediately restores upstream rendering", async () => {
    const server = app();
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    expect((await server.request("/")).headers.has("x-factorylm-site")).toBe(true);
    process.env.FACTORYLM_MARKETING_NEXT = "false";
    expect(await (await server.request("/")).json()).toMatchObject({ upstream: true });
  });
});
