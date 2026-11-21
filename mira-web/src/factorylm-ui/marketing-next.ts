/** Bounded public adapter. No auth, API, policies or article routes are replaced. */
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { hubOrigin, hubUrl, PRODUCTION_HUB_ORIGIN } from "../capabilities/hub-origin.js";

interface MarketingManifest {
  routes: Record<string, string>;
  redirects: Record<string, string>;
  files: Record<string, string>;
}

const directory = new URL("./marketing-next/", import.meta.url);
let loaded: Promise<{ manifest: MarketingManifest; identity: string }> | undefined;
function manifest() {
  return loaded ??= readFile(new URL("manifest.json", directory), "utf8").then((source) => ({
    manifest: JSON.parse(source) as MarketingManifest,
    identity: createHash("sha256").update(source).digest("hex").slice(0, 16),
  }));
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8", svg: "image/svg+xml",
  webp: "image/webp", xml: "application/xml; charset=utf-8", txt: "text/plain; charset=utf-8",
};

export function createFactorylmMarketingRouter() {
  const router = new Hono();
  router.use("*", async (c, next) => {
    if (process.env.FACTORYLM_MARKETING_NEXT !== "true" || process.env.MIRA_FREE_TECHNICIANS !== "true" || !["GET", "HEAD"].includes(c.req.method)) return next();
    const url = new URL(c.req.url);
    const { manifest: map, identity } = await manifest();
    if (map.redirects[url.pathname]) return c.redirect(map.redirects[url.pathname] + url.search, 301);
    let file = map.routes[url.pathname];
    if (url.pathname.startsWith("/factorylm-next-assets/")) {
      const candidate = url.pathname.slice(1);
      file = Object.hasOwn(map.files, candidate) ? candidate : "404.html";
    } else if (["/robots.txt", "/sitemap-site.xml"].includes(url.pathname)) {
      file = url.pathname.slice(1);
    }
    if (!file) return next();
    // Only filenames in the checked generated manifest can reach the filesystem.
    if (!Object.hasOwn(map.files, file) || file.includes("..") || file.startsWith("/")) return c.notFound();
    const bytes = await readFile(new URL("site/" + file, directory));
    const html = file.endsWith(".html");
    const staging = hubOrigin() !== PRODUCTION_HUB_ORIGIN;
    const body = html ? bytes.toString("utf8")
      .replaceAll(PRODUCTION_HUB_ORIGIN + "/signup/", hubUrl("/signup/"))
      .replaceAll(PRODUCTION_HUB_ORIGIN + "/login/", hubUrl("/login/")) : bytes;
    const headers = {
      "Content-Type": MIME[file.split(".").at(-1)!] ?? "application/octet-stream",
      "Content-Length": String(Buffer.byteLength(body)),
      "Cache-Control": file.startsWith("factorylm-next-assets/") ? "public, max-age=300, must-revalidate" : "no-cache",
      "X-FactoryLM-Site": "next-" + identity,
    };
    if (staging) Object.assign(headers, { "X-Robots-Tag": "noindex, nofollow" });
    return new Response(c.req.method === "HEAD" ? null : body, { status: file === "404.html" ? 404 : 200, headers });
  });
  return router;
}
