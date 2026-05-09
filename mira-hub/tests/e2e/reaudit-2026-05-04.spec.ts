/**
 * Re-audit 2026-05-04 — interaction crawl
 *
 * QA pass on 2026-05-03 fixes (PRs #939/#940/#942/#943/#944/#947 + d881bb9 nginx).
 * For each in-scope URL:
 *   1) Capture a full-page screenshot of the loaded state
 *   2) Enumerate every clickable element (button / link / role=button / summary /
 *      aria-haspopup / input[type=submit])
 *   3) Click each one (capped at 50/page), capture URL change + console errors +
 *      network failures + a screenshot of the resulting state
 *   4) Return to baseline URL between clicks
 *
 * Skips destructive labels (delete/sign out/cancel subscription/log out) and
 * cross-origin links (different host).
 *
 * Artifacts land under ../tools/web-review-runs/2026-05-04-reaudit/.
 *
 * Run:
 *   cd mira-hub
 *   bunx playwright test reaudit-2026-05-04 --project=chromium --reporter=list
 */

import { test, expect, Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OUT_ROOT = path.resolve(__dirname, "../../../tools/web-review-runs/2026-05-04-reaudit");

type Route = {
  host: "factorylm.com" | "app.factorylm.com";
  path: string;
  slug: string;
  mobile?: boolean;
};

const ROUTES: Route[] = [
  // Apex (factorylm.com) — funnel pages where the 2026-05-03 fixes landed
  { host: "factorylm.com", path: "/", slug: "apex-home", mobile: true },
  { host: "factorylm.com", path: "/cmms", slug: "apex-cmms", mobile: true },
  { host: "factorylm.com", path: "/activated", slug: "apex-activated", mobile: true },
  { host: "factorylm.com", path: "/pricing", slug: "apex-pricing", mobile: true },
  { host: "factorylm.com", path: "/blog", slug: "apex-blog", mobile: true },
  { host: "factorylm.com", path: "/blog/fault-codes", slug: "apex-blog-fault-codes" },
  { host: "factorylm.com", path: "/limitations", slug: "apex-limitations" },
  { host: "factorylm.com", path: "/security", slug: "apex-security" },
  // App subdomain — verify d881bb9 routing
  { host: "app.factorylm.com", path: "/", slug: "app-root" },
  { host: "app.factorylm.com", path: "/sample", slug: "app-sample" },
  { host: "app.factorylm.com", path: "/activated", slug: "app-activated" },
  { host: "app.factorylm.com", path: "/pricing", slug: "app-pricing" },
];

const DESTRUCTIVE_RE = /\b(delete|remove|cancel.*subscription|sign[-\s]?out|log[-\s]?out|deactivate)\b/i;
const MAX_INTERACTIONS_PER_PAGE = 50;
const NAV_TIMEOUT = 20_000;
const CLICK_SETTLE_MS = 800;

const VIEWPORT_DESKTOP = { width: 1440, height: 900 };
const VIEWPORT_MOBILE = { width: 412, height: 915 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function safeLabel(s: string, max = 40): string {
  return s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^a-zA-Z0-9\-_ ]/g, "")
    .trim()
    .slice(0, max)
    .replace(/\s+/g, "-")
    .toLowerCase() || "noname";
}

type ConsoleErr = { type: string; text: string };
type NetworkFail = { url: string; status: number; method: string };

async function clearAndAttachListeners(page: Page) {
  const consoleErrors: ConsoleErr[] = [];
  const networkFailures: NetworkFail[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleErrors.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push({ type: "pageerror", text: String(err) });
  });
  page.on("response", (res) => {
    const s = res.status();
    if (s >= 400) {
      networkFailures.push({ url: res.url(), status: s, method: res.request().method() });
    }
  });

  return {
    snapshot: () => ({ consoleErrors: [...consoleErrors], networkFailures: [...networkFailures] }),
    reset: () => {
      consoleErrors.length = 0;
      networkFailures.length = 0;
    },
  };
}

type ClickRecord = {
  index: number;
  selector: string;
  label: string;
  tag: string;
  href: string | null;
  before_url: string;
  after_url: string;
  url_changed: boolean;
  navigation_external: boolean;
  console_errors: ConsoleErr[];
  network_failures: NetworkFail[];
  screenshot: string;
  notes: string[];
};

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------

async function crawlRoute(page: Page, route: Route, viewport: "desktop" | "mobile") {
  const url = `https://${route.host}${route.path}`;
  const slugDir = path.join(OUT_ROOT, "clicks", `${route.slug}__${viewport}`);
  ensureDir(slugDir);

  const listeners = await clearAndAttachListeners(page);

  // 1. Initial load
  const navStart = Date.now();
  let initialStatus = -1;
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    initialStatus = res?.status() ?? -1;
  } catch (e) {
    fs.writeFileSync(
      path.join(slugDir, "00-load-failed.json"),
      JSON.stringify({ url, error: String(e), elapsed: Date.now() - navStart }, null, 2)
    );
    return;
  }
  await page.waitForTimeout(CLICK_SETTLE_MS);

  const initialScreenshot = path.join(slugDir, "00-initial.png");
  await page.screenshot({ path: initialScreenshot, fullPage: true });

  // Also write to viewport-level desktop/mobile dir for the diff harness
  const viewportDir = path.join(OUT_ROOT, viewport);
  ensureDir(viewportDir);
  await page.screenshot({ path: path.join(viewportDir, `${route.slug}.png`), fullPage: true });

  const initialSnapshot = listeners.snapshot();

  // 2. Enumerate clickables
  const clickables = await page.$$eval(
    `button, a[href], [role=button], summary, [aria-haspopup], input[type=submit], [data-toggle]`,
    (els) =>
      els.map((el, i) => {
        const tag = el.tagName.toLowerCase();
        let href: string | null = null;
        if (tag === "a") href = (el as HTMLAnchorElement).href || null;
        const text = (el as HTMLElement).innerText?.trim().slice(0, 80) || "";
        const aria = (el as HTMLElement).getAttribute("aria-label") || "";
        const id = (el as HTMLElement).id || "";
        const classes = (el as HTMLElement).className?.toString().slice(0, 60) || "";
        // Build a reasonably-stable selector
        let selector = "";
        if (id) selector = `#${id}`;
        else if (tag === "a" && href) selector = `a[href="${(el as HTMLAnchorElement).getAttribute("href")}"]`;
        else selector = `${tag}:nth-of-type(${i + 1})`;
        return {
          index: i,
          tag,
          href,
          label: text || aria || id || classes || tag,
          selector,
        };
      })
  );

  // 3. Filter
  const baseHost = new URL(url).host;
  const candidates = clickables.filter((c) => {
    if (DESTRUCTIVE_RE.test(c.label)) return false;
    if (c.href) {
      try {
        const target = new URL(c.href, url);
        if (target.host && target.host !== baseHost) return false; // external
        if (target.protocol === "mailto:" || target.protocol === "tel:") return false;
      } catch {
        return false;
      }
    }
    return true;
  });

  const overflow = candidates.length > MAX_INTERACTIONS_PER_PAGE
    ? candidates.length - MAX_INTERACTIONS_PER_PAGE
    : 0;
  const toClick = candidates.slice(0, MAX_INTERACTIONS_PER_PAGE);

  // 4. Click loop
  const clicksJsonl = path.join(slugDir, "clicks.jsonl");
  const summary = {
    url,
    viewport,
    initial_status: initialStatus,
    initial_console_errors: initialSnapshot.consoleErrors,
    initial_network_failures: initialSnapshot.networkFailures,
    total_clickables_enumerated: clickables.length,
    skipped_external_or_destructive: clickables.length - candidates.length,
    overflow_uncovered: overflow,
    interactions_run: 0,
    interactions_with_console_errors: 0,
    interactions_with_network_failures: 0,
    interactions_with_navigation: 0,
  };
  fs.writeFileSync(clicksJsonl, ""); // truncate

  for (let i = 0; i < toClick.length; i++) {
    const c = toClick[i];
    const beforeUrl = page.url();
    listeners.reset();

    const labelSafe = safeLabel(c.label || c.tag);
    const shotPath = path.join(slugDir, `${String(i + 1).padStart(2, "0")}-${labelSafe}.png`);
    const notes: string[] = [];

    // Locate by index using the same selector strategy as enumeration
    let clicked = false;
    try {
      const handles = await page.$$(`button, a[href], [role=button], summary, [aria-haspopup], input[type=submit], [data-toggle]`);
      const handle = handles[c.index];
      if (!handle) {
        notes.push("element-disappeared-before-click");
      } else {
        // Open in same tab — block target=_blank
        try {
          await handle.evaluate((el) => {
            const a = el as HTMLAnchorElement;
            if (a.target) a.target = "_self";
          });
        } catch {}

        await handle.click({ timeout: 5_000, trial: false }).catch((e) => {
          notes.push(`click-error: ${String(e).slice(0, 100)}`);
        });
        clicked = true;
        await page.waitForTimeout(CLICK_SETTLE_MS);
      }
    } catch (e) {
      notes.push(`outer-click-error: ${String(e).slice(0, 100)}`);
    }

    const afterUrl = page.url();
    const navigated = afterUrl !== beforeUrl;
    const externalNav = (() => {
      try {
        return new URL(afterUrl).host !== baseHost;
      } catch {
        return false;
      }
    })();

    try {
      await page.screenshot({ path: shotPath, fullPage: false });
    } catch (e) {
      notes.push(`screenshot-error: ${String(e).slice(0, 100)}`);
    }

    const snap = listeners.snapshot();
    const record: ClickRecord = {
      index: i + 1,
      selector: c.selector,
      label: c.label.slice(0, 80),
      tag: c.tag,
      href: c.href,
      before_url: beforeUrl,
      after_url: afterUrl,
      url_changed: navigated,
      navigation_external: externalNav,
      console_errors: snap.consoleErrors,
      network_failures: snap.networkFailures,
      screenshot: path.relative(OUT_ROOT, shotPath),
      notes,
    };

    fs.appendFileSync(clicksJsonl, JSON.stringify(record) + "\n");

    summary.interactions_run++;
    if (snap.consoleErrors.length) summary.interactions_with_console_errors++;
    if (snap.networkFailures.length) summary.interactions_with_network_failures++;
    if (navigated) summary.interactions_with_navigation++;

    // Return to baseline if navigation happened
    if (navigated && !externalNav) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
        await page.waitForTimeout(CLICK_SETTLE_MS);
      } catch (e) {
        notes.push(`return-nav-failed: ${String(e).slice(0, 100)}`);
        // try once more
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => {});
      }
    } else if (externalNav) {
      // shouldn't happen because we filter externals, but just in case
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => {});
    }
  }

  fs.writeFileSync(path.join(slugDir, "summary.json"), JSON.stringify(summary, null, 2));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("re-audit 2026-05-04 — interaction crawl", () => {
  test.describe.configure({ mode: "default" });

  for (const route of ROUTES) {
    test(`desktop · ${route.host}${route.path}`, async ({ browser }) => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext({ viewport: VIEWPORT_DESKTOP });
      const page = await ctx.newPage();
      try {
        await crawlRoute(page, route, "desktop");
      } finally {
        await ctx.close();
      }
    });

    if (route.mobile) {
      test(`mobile · ${route.host}${route.path}`, async ({ browser }) => {
        test.setTimeout(180_000);
        const ctx = await browser.newContext({ viewport: VIEWPORT_MOBILE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        try {
          await crawlRoute(page, route, "mobile");
        } finally {
          await ctx.close();
        }
      });
    }
  }
});
