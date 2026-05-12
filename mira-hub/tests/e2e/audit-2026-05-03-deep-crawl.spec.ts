/**
 * Adversarial deep-crawl audit of app.factorylm.com/hub — 2026-05-03.
 *
 * For each route × {desktop, mobile}:
 *   1. Navigate, capture page-level meta via the web-review DOM-eval payload.
 *   2. Listen to console + non-2xx network for the duration of the visit.
 *   3. Drill: enumerate visible clickables, click each (skipping mutating /
 *      navigating ones), ESC out of any modal that opens, repeat until the
 *      clickable set is exhausted (or DRILL_CAP per page).
 *   4. Screenshot the post-drill state.
 *   5. Write per-route findings JSON.
 *
 * Findings are aggregated by tools/web-review-runs/2026-05-03-hub-deep-audit/
 * aggregate.py.
 *
 * Forms with side effects are NEVER submitted — see DENY_TEXT_PATTERNS.
 */

import { test, expect, type Page, type ConsoleMessage, type Response } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com/hub";
const OUT_ROOT = path.join(__dirname, "../../test-results/audit-2026-05-03");
const FINDINGS_DIR = path.join(OUT_ROOT, "findings");
const SCREENSHOT_DIR = path.join(OUT_ROOT, "screenshots");
const DRILL_CAP = 30;

interface RouteSpec {
  path: string;
  section: string;
  /** If true, this route contains a form that mutates state — fill but never submit. */
  hasMutatingForm?: boolean;
}

const ROUTES: RouteSpec[] = [
  // Feed / dashboard
  { path: "/feed", section: "feed" },

  // Event log + intelligence
  { path: "/event-log", section: "intel" },
  { path: "/conversations", section: "intel" },
  { path: "/actions", section: "intel" },
  { path: "/alerts", section: "intel" },
  { path: "/knowledge", section: "intel" },

  // Core ops
  { path: "/assets", section: "core" },
  { path: "/workorders", section: "core" },
  { path: "/workorders/new", section: "core", hasMutatingForm: true },
  { path: "/requests", section: "core" },
  { path: "/requests/new", section: "core", hasMutatingForm: true },
  { path: "/parts", section: "core" },
  { path: "/documents", section: "core", hasMutatingForm: true }, // upload
  { path: "/schedule", section: "core" },

  // Integration / management
  { path: "/channels", section: "mgmt" },
  { path: "/integrations", section: "mgmt", hasMutatingForm: true },
  { path: "/cmms", section: "mgmt" },
  { path: "/team", section: "mgmt", hasMutatingForm: true },
  { path: "/usage", section: "mgmt" },

  // Admin
  { path: "/admin/users", section: "admin", hasMutatingForm: true },
  { path: "/admin/roles", section: "admin", hasMutatingForm: true },

  // Supplemental + flow pages
  { path: "/more", section: "misc" },
  { path: "/pending-approval", section: "misc" },
  { path: "/upgrade", section: "misc", hasMutatingForm: true }, // mailto + future Stripe
  { path: "/magic", section: "misc" },
];

/** Click-target text/aria patterns we refuse to click (mutating, destructive, or session-ending). */
const DENY_TEXT_PATTERNS: RegExp[] = [
  /\bsign\s*out\b/i,
  /\blog\s*out\b/i,
  /\blogout\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bsubmit\b/i,
  /\bsave\b/i,
  /\bcreate\b/i,
  /\bupload\b/i,
  /\bsend\b/i,
  /\binvite\b/i,
  /\bpublish\b/i,
  /\bdeploy\b/i,
  /\barchive\b/i,
  /\bdisable\b/i,
  /\bdisconnect\b/i,
  /\bunsubscribe\b/i,
  /\bcancel\s+subscription\b/i,
  /\bupgrade\s+to\b/i,
  /\bcheckout\b/i,
  /\bpay\s+now\b/i,
];

/** External-href patterns we refuse to follow (auth providers, payment, mailto, tel). */
const DENY_HREF_PATTERNS: RegExp[] = [
  /^mailto:/i,
  /^tel:/i,
  /accounts\.google\.com/i,
  /login\.microsoftonline\.com/i,
  /dropbox\.com\/oauth/i,
  /slack\.com\/oauth/i,
  /stripe\.com/i,
  /checkout\.stripe\.com/i,
];

/** DOM-eval payload from .claude/skills/web-review/SKILL.md (verbatim, plus minor TS-friendly tweaks). */
const DOM_EVAL_PAYLOAD = `() => {
  const r = {url: location.href};
  const imgs = [...document.querySelectorAll('img')];
  r.images_total = imgs.length;
  r.images_no_alt = imgs.filter(i => !i.hasAttribute('alt')).map(i => i.src).slice(0, 20);
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  r.h1_count = headings.filter(h => h.tagName === 'H1').length;
  const order = headings.map(h => +h.tagName.slice(1));
  r.heading_skips = order.map((n,i) => i>0 && n-order[i-1]>1 ? \`h\${order[i-1]}→h\${n}\` : null).filter(Boolean);
  r.meta = {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content,
    canonical: document.querySelector('link[rel="canonical"]')?.href,
    og_title: document.querySelector('meta[property="og:title"]')?.content,
    og_image: document.querySelector('meta[property="og:image"]')?.content,
    og_url: document.querySelector('meta[property="og:url"]')?.content,
    twitter_card: document.querySelector('meta[name="twitter:card"]')?.content,
    viewport: document.querySelector('meta[name="viewport"]')?.content,
    lang: document.documentElement.lang,
    favicon: document.querySelector('link[rel="icon"]')?.href,
  };
  r.deprecated_meta = ['apple-mobile-web-app-capable']
    .filter(name => document.querySelector(\`meta[name="\${name}"]\`) && !document.querySelector('meta[name="mobile-web-app-capable"]'));
  r.external_no_noopener = [...document.querySelectorAll('a[target="_blank"]')]
    .filter(a => !(a.rel||'').includes('noopener')).map(a => a.href).slice(0, 20);
  r.mixed_content = [...document.querySelectorAll('img,script,link,iframe')]
    .map(e => e.src||e.href).filter(u => u && u.startsWith('http://')).slice(0,10);
  r.tap_targets_too_small = [...document.querySelectorAll('a,button,input[type="button"],input[type="submit"]')]
    .filter(el => { const b = el.getBoundingClientRect(); return b.width>0 && b.height>0 && (b.width<44 || b.height<44); })
    .map(el => ({tag: el.tagName, text: (el.innerText||el.value||'').slice(0,40),
                 w: Math.round(el.getBoundingClientRect().width),
                 h: Math.round(el.getBoundingClientRect().height)})).slice(0,15);
  r.buttons_no_name = [...document.querySelectorAll('button')]
    .filter(b => !b.innerText.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length;
  r.forms = [...document.querySelectorAll('form')].map(f => ({
    action: f.action, method: f.method,
    inputs_unlabelled: [...f.querySelectorAll('input,textarea,select')].filter(i =>
      !i.labels?.length && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby')).length,
  }));
  r.jsonld_types = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => {
    try { const o = JSON.parse(s.textContent); return o['@type'] || (o['@graph']||[]).map(x=>x['@type']) || 'unknown'; }
    catch { return 'INVALID_JSON'; }
  });
  return r;
}`;

interface ConsoleEntry {
  type: string;
  text: string;
  location?: string;
}

interface NetworkEntry {
  url: string;
  status: number;
  method: string;
  resource_type: string;
}

interface ClickEntry {
  index: number;
  text: string;
  tag: string;
  href?: string;
  result: "ok" | "skipped-deny" | "skipped-nav" | "skipped-detached" | "error";
  error?: string;
}

interface RouteFindings {
  route: string;
  section: string;
  viewport: { width: number; height: number };
  visited_at: string;
  load_status?: number;
  redirected_to?: string;
  dom: Record<string, unknown>;
  console: ConsoleEntry[];
  network_errors: NetworkEntry[];
  clicks: ClickEntry[];
  drill_total: number;
  drill_capped: boolean;
  screenshot: string;
  error?: string;
}

function slugify(routePath: string): string {
  return routePath.replace(/^\/+|\/+$/g, "").replace(/\//g, "_") || "root";
}

function attachListeners(page: Page): { console: ConsoleEntry[]; network: NetworkEntry[] } {
  const consoleLog: ConsoleEntry[] = [];
  const network: NetworkEntry[] = [];

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "warning" || msg.type() === "error") {
      consoleLog.push({
        type: msg.type(),
        text: msg.text().slice(0, 500),
        location: `${msg.location().url}:${msg.location().lineNumber}`,
      });
    }
  });

  page.on("pageerror", (err) => {
    consoleLog.push({
      type: "pageerror",
      text: `${err.name}: ${err.message}`.slice(0, 500),
    });
  });

  page.on("response", (res: Response) => {
    const status = res.status();
    if (status >= 400 && status < 600) {
      // Filter out auth-redirect 401s on /api/auth probes — those are expected
      const url = res.url();
      if (status === 401 && /\/api\/auth\//.test(url)) return;
      network.push({
        url,
        status,
        method: res.request().method(),
        resource_type: res.request().resourceType(),
      });
    }
  });

  return { console: consoleLog, network };
}

function shouldDenyClick(text: string, href: string | null): boolean {
  const t = (text || "").trim().slice(0, 100);
  if (DENY_TEXT_PATTERNS.some((p) => p.test(t))) return true;
  if (href && DENY_HREF_PATTERNS.some((p) => p.test(href))) return true;
  return false;
}

async function drillClickables(
  page: Page,
  routePath: string,
  hasMutatingForm: boolean,
): Promise<{ clicks: ClickEntry[]; total: number; capped: boolean }> {
  const clicks: ClickEntry[] = [];
  // Snapshot the clickable set ONCE — clicking can re-render, but we don't want
  // to chase an ever-growing tree. 30/page is plenty for an audit signal.
  const handles = await page.locator(
    'a:visible, button:visible, [role="button"]:visible, [role="tab"]:visible, [role="menuitem"]:visible',
  ).all();

  const total = handles.length;
  const capped = total > DRILL_CAP;
  const subset = handles.slice(0, DRILL_CAP);

  for (let i = 0; i < subset.length; i++) {
    const handle = subset[i];
    let text = "";
    let href: string | null = null;
    let tag = "?";
    try {
      text = (await handle.innerText({ timeout: 1000 })).slice(0, 80);
      href = await handle.getAttribute("href");
      tag = await handle.evaluate((el) => el.tagName);
    } catch {
      clicks.push({ index: i, text: "", tag, result: "skipped-detached" });
      continue;
    }

    if (shouldDenyClick(text, href)) {
      clicks.push({ index: i, text, tag, href: href ?? undefined, result: "skipped-deny" });
      continue;
    }

    // Skip <a> with href that navigates off the current route — we'll hit those
    // routes explicitly in their own iteration. Same-route hash links are OK.
    if (href && href.startsWith("/") && !href.startsWith(`${routePath}#`) && !href.startsWith("#")) {
      clicks.push({ index: i, text, tag, href, result: "skipped-nav" });
      continue;
    }

    try {
      // For mutating-form pages, fill inputs but don't actually submit.
      if (hasMutatingForm && /submit|create|save/i.test(text)) {
        clicks.push({ index: i, text, tag, result: "skipped-deny" });
        continue;
      }
      await handle.click({ timeout: 2000, trial: false });
      // ESC out of any modal/dropdown that opened
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);
      clicks.push({ index: i, text, tag, href: href ?? undefined, result: "ok" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      clicks.push({
        index: i,
        text,
        tag,
        href: href ?? undefined,
        result: "error",
        error: msg.slice(0, 200),
      });
    }
  }

  return { clicks, total, capped };
}

async function auditRoute(page: Page, route: RouteSpec, viewportLabel: string): Promise<RouteFindings> {
  const slug = slugify(route.path);
  const screenshotPath = path.join(SCREENSHOT_DIR, `${slug}-${viewportLabel}.png`);
  const findings: RouteFindings = {
    route: route.path,
    section: route.section,
    viewport: page.viewportSize() ?? { width: 0, height: 0 },
    visited_at: new Date().toISOString(),
    dom: {},
    console: [],
    network_errors: [],
    clicks: [],
    drill_total: 0,
    drill_capped: false,
    screenshot: path.relative(OUT_ROOT, screenshotPath),
  };

  const listeners = attachListeners(page);

  let response: Response | null = null;
  try {
    response = await page.goto(`${HUB}${route.path}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    findings.load_status = response?.status();
    if (page.url() !== `${HUB}${route.path}` && page.url() !== `${HUB}${route.path}/`) {
      findings.redirected_to = page.url();
    }

    // Settle the page a bit (let client-side hydration finish)
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

    // Wrap in IIFE — page.evaluate(string) evaluates as expression, not call.
    findings.dom = (await page.evaluate(`(${DOM_EVAL_PAYLOAD})()`)) as Record<string, unknown>;

    const drill = await drillClickables(page, route.path, !!route.hasMutatingForm);
    findings.clicks = drill.clicks;
    findings.drill_total = drill.total;
    findings.drill_capped = drill.capped;

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
  } catch (e: unknown) {
    findings.error = e instanceof Error ? e.message : String(e);
  }

  // Snapshot the listener buffers (they keep filling otherwise)
  findings.console = [...listeners.console];
  findings.network_errors = [...listeners.network];

  return findings;
}

test.describe("hub deep-crawl audit 2026-05-03", () => {
  test.beforeAll(() => {
    fs.mkdirSync(FINDINGS_DIR, { recursive: true });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  for (const route of ROUTES) {
    test(`audit ${route.path}`, async ({ page }, testInfo) => {
      // Project name encodes the viewport — see playwright.config.ts
      const viewportLabel = testInfo.project.name === "audit-mobile" ? "mobile" : "desktop";
      const slug = slugify(route.path);

      const findings = await auditRoute(page, route, viewportLabel);

      const outPath = path.join(FINDINGS_DIR, `${slug}-${viewportLabel}.json`);
      fs.writeFileSync(outPath, JSON.stringify(findings, null, 2));

      // The test never fails — we collect, never gate. Aggregator promotes findings to issues.
      console.log(
        `[${viewportLabel}] ${route.path} → ${findings.console.length} console, ` +
          `${findings.network_errors.length} 4xx/5xx, ${findings.clicks.length} clicks`,
      );
      expect(findings.error, `route ${route.path} failed to load`).toBeUndefined();
    });
  }
});
