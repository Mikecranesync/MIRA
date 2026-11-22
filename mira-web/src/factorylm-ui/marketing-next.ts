/** Bounded public adapter. Existing auth, API, policy and blog routes are preserved. */
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
  webp: "image/webp", jpg: "image/jpeg", xml: "application/xml; charset=utf-8", txt: "text/plain; charset=utf-8",
};

/** Whether this adapter owns the path under the current rollout flags. */
function inScope(pathname: string): boolean {
  const freePolicy = ["/free-technicians", "/free-technicians/", "/free-technicians.html"].includes(pathname);
  const policyAsset = pathname.startsWith("/factorylm-next-assets/");
  if (freePolicy || policyAsset) return true;
  return process.env.MIRA_FREE_TECHNICIANS === "true" && process.env.FACTORYLM_MARKETING_NEXT === "true";
}

/** The marketing site never answers on the Hub's own host (Codex F38): nginx
 * proxies a few app-host paths such as /pricing to this service, and a relative
 * redirect there would land in the Hub. Classified by Host ONLY: every ingress
 * that reaches this service sets `proxy_set_header Host $host` from the server
 * block it matched, while X-Forwarded-Host can arrive from the client (#5775). */
function onHubHost(url: URL, headers?: Headers): boolean {
  const host = (headers?.get("host") || url.host).toLowerCase();
  return host === new URL(hubOrigin()).host.toLowerCase();
}

/** The adapter's own alias redirect (same-origin, 302, no-store), or null. The
 * server calls this BEFORE generic trailing-slash normalization, which would
 * otherwise send a cacheable 301 to a trusted (production) host (Codex F33). */
export async function marketingAliasRedirect(method: string, requestUrl: string, headers?: Headers): Promise<Response | null> {
  if (!["GET", "HEAD"].includes(method)) return null;
  const url = new URL(requestUrl);
  if (onHubHost(url, headers)) return null;
  // Codex F33: a slash variant of an adapter-owned alias or route is normalized
  // HERE, and scoped by its normalized path, so it never reaches the generic 301.
  const bare = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const slashVariant = bare !== url.pathname && bare !== "";
  if (!inScope(url.pathname) && !(slashVariant && inScope(bare))) return null;
  const { manifest: map } = await manifest();
  const target = map.redirects[url.pathname]
    ?? (slashVariant ? map.redirects[bare] ?? (Object.hasOwn(map.routes, bare) ? bare : undefined) : undefined);
  return target ? new Response(null, { status: 302, headers: { Location: target + url.search, "Cache-Control": "no-store" } }) : null;
}

/** IndexNow ownership key (public by design: https://www.indexnow.org/documentation). */
export const INDEXNOW_KEY = "5f78aeeffc5661a1811fb08975c2c8e4";
const INDEXNOW_KEY_PATH = "/" + INDEXNOW_KEY + ".txt";
/** Legacy pages the new site retired; dropped from the legacy /sitemap.xml while it is on. */
const RETIRED_FROM_SITEMAP = new Set(["/pricing", "/cmms", "/assess", "/buy"]);

/** The legacy sitemap, minus retired pages, plus every page this adapter serves.
 * The legacy generator (blog + fault-code pages) stays the source of the rest. */
export function rewriteLegacySitemap(xml: string, routes: string[], origin: string, lastmods: Record<string, string>): string {
  // Case- and trailing-slash-insensitive, so /CMMS or /cmms/ cannot slip past the retired set.
  const pathOf = (loc: string) => {
    let path: string;
    try { path = new URL(loc).pathname; } catch { path = loc; }
    return (path.length > 1 ? path.replace(/\/+$/, "") : path).toLowerCase();
  };
  const seen = new Set<string>();
  const kept = xml.replace(/\s*<url>[\s\S]*?<\/url>/g, (block) => {
    const loc = block.match(/<loc>([^<]*)<\/loc>/)?.[1] ?? "";
    const path = pathOf(loc);
    if (RETIRED_FROM_SITEMAP.has(path) || seen.has(path)) return "";
    seen.add(path);
    return block;
  });
  const added = routes.filter((route) => !seen.has(route))
    .map((route) => `\n  <url>\n    <loc>${origin}${route}</loc>${lastmods[route] ? `\n    <lastmod>${lastmods[route]}</lastmod>` : ""}\n  </url>`).join("");
  return kept.replace("</urlset>", added + "\n</urlset>");
}

export function createFactorylmMarketingRouter() {
  const router = new Hono();
  router.use("*", async (c, next) => {
    if (!["GET", "HEAD"].includes(c.req.method)) return next();
    const url = new URL(c.req.url);
    const alias = await marketingAliasRedirect(c.req.method, c.req.url, c.req.raw.headers);
    if (alias) return alias;
    if (onHubHost(url, c.req.raw.headers) || !inScope(url.pathname)) return next();
    const { manifest: map, identity } = await manifest();
    if (url.pathname === "/sitemap.xml") {
      await next();
      const legacy = c.res;
      if (legacy.status !== 200 || !(legacy.headers.get("content-type") ?? "").includes("xml")) return;
      const routes = Object.keys(map.routes).filter((route) => route !== "/404");
      // lastmod is the edit date recorded in the checked sitemap-site.xml, never the request date.
      const own = (await readFile(new URL("site/sitemap-site.xml", directory), "utf8"))
        .matchAll(/<loc>https:\/\/factorylm\.com([^<]*)<\/loc><lastmod>([^<]*)<\/lastmod>/g);
      const lastmods = Object.fromEntries([...own].map((m) => [m[1], m[2]]));
      const xml = rewriteLegacySitemap(await legacy.text(), routes, "https://factorylm.com", lastmods);
      c.res = new Response(c.req.method === "HEAD" ? null : xml, {
        status: 200,
        headers: { "Content-Type": "application/xml; charset=utf-8", "X-FactoryLM-Site": "next-" + identity },
      });
      return;
    }
    let file = map.routes[url.pathname];
    if (url.pathname.startsWith("/factorylm-next-assets/")) {
      const candidate = url.pathname.slice(1);
      file = Object.hasOwn(map.files, candidate) ? candidate : "404.html";
    } else if (["/robots.txt", "/sitemap-site.xml", "/llms.txt", "/llms-full.txt", INDEXNOW_KEY_PATH].includes(url.pathname)) {
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
