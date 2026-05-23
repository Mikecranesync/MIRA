/**
 * Unauthenticated pre-expo audit — 2026-05-17.
 *
 * Crawls every Hub route without a session. For protected routes we expect
 * a redirect to /login; we still capture the gate screenshot + the final
 * URL so we can prove the route exists and the middleware behaves.
 *
 * Public routes (login, signup, /m/[tag]) render directly.
 */

import { test, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com";
const SCREENSHOTS = path.resolve(__dirname, "../../../docs/promo-screenshots");
const FINDINGS_DIR = path.resolve(__dirname, "../../test-results/audit-2026-05-17");
fs.mkdirSync(SCREENSHOTS, { recursive: true });
fs.mkdirSync(FINDINGS_DIR, { recursive: true });

type RouteFinding = {
  route: string;
  initialStatus: number | null;
  finalUrl: string;
  redirectedToLogin: boolean;
  consoleErrors: string[];
  failedRequests: { url: string; status: number }[];
  notes: string[];
  screenshot: string;
};

const ROUTES = [
  // Hub group
  "/feed",
  "/assets",
  "/namespace",
  "/knowledge",
  "/documents",
  "/workorders",
  "/workorders/new",
  "/requests",
  "/requests/new",
  "/conversations",
  "/alerts",
  "/event-log",
  "/parts",
  "/proposals",
  "/reports",
  "/channels",
  "/integrations",
  "/cmms",
  "/team",
  "/schedule",
  "/library",
  "/usage",
  "/plc",
  "/more",
  "/admin/users",
  "/admin/roles",
  "/pending-approval",
  "/upgrade",
  "/magic",
  "/onboarding",
  // Mike-flagged but unverified
  "/scan",
  // Public
  "/login",
  "/signup",
];

const allFindings: RouteFinding[] = [];

async function visit(page: Page, route: string): Promise<RouteFinding> {
  const f: RouteFinding = {
    route,
    initialStatus: null,
    finalUrl: "",
    redirectedToLogin: false,
    consoleErrors: [],
    failedRequests: [],
    notes: [],
    screenshot: "",
  };

  page.on("console", (msg) => {
    if (msg.type() === "error") f.consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("response", (resp) => {
    const s = resp.status();
    if (s >= 400 && !resp.url().match(/_next\/static|\.(woff2?|png|svg|jpg|ico)(\?|$)/)) {
      f.failedRequests.push({ url: resp.url(), status: s });
    }
  });

  try {
    const resp = await page.goto(`${HUB}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    f.initialStatus = resp?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    f.finalUrl = page.url();
    f.redirectedToLogin = /\/login/.test(page.url());
  } catch (e) {
    f.notes.push(`navigation failed: ${(e as Error).message.slice(0, 200)}`);
  }

  const safe = route.replace(/^\//, "").replace(/\//g, "-").replace(/\[|\]/g, "") || "root";
  const ssRel = `2026-05-17_hub-${safe}_desktop.png`;
  const ssAbs = path.join(SCREENSHOTS, ssRel);
  await page.screenshot({ path: ssAbs, fullPage: false }).catch((e) => {
    f.notes.push(`screenshot failed: ${(e as Error).message.slice(0, 100)}`);
  });
  f.screenshot = ssRel;

  return f;
}

test.describe("Unauth Hub crawl 2026-05-17", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.afterAll(async () => {
    fs.writeFileSync(
      path.join(FINDINGS_DIR, "findings-unauth.json"),
      JSON.stringify(allFindings, null, 2),
    );
    const summary = {
      total: allFindings.length,
      redirectedToLogin: allFindings.filter((f) => f.redirectedToLogin).length,
      withConsoleErrors: allFindings.filter((f) => f.consoleErrors.length > 0).length,
      withFailedRequests: allFindings.filter((f) => f.failedRequests.length > 0).length,
      routes: allFindings.map((f) => ({
        route: f.route,
        finalUrl: f.finalUrl,
        redirect: f.redirectedToLogin,
        status: f.initialStatus,
        errs: f.consoleErrors.length,
        failedReqs: f.failedRequests.length,
        notes: f.notes,
      })),
    };
    fs.writeFileSync(
      path.join(FINDINGS_DIR, "summary-unauth.json"),
      JSON.stringify(summary, null, 2),
    );
    console.log(`[audit] wrote ${allFindings.length} route findings`);
  });

  for (const route of ROUTES) {
    test(`route ${route}`, async ({ page }) => {
      const f = await visit(page, route);
      allFindings.push(f);
      console.log(
        `[audit] ${route} → ${f.initialStatus} → ${f.finalUrl} ${f.redirectedToLogin ? "(login-gate)" : ""}`,
      );
    });
  }

  test("mobile asset view /m/[assetTag] (public QR landing)", async ({ page }) => {
    // Use a guessed tag — the route should render *something* even if asset not found
    for (const tag of ["MC-AC-001", "missing-tag-xyz"]) {
      const f = await visit(page, `/m/${tag}`);
      f.route = `/m/${tag}`;
      allFindings.push(f);
    }
  });
});
