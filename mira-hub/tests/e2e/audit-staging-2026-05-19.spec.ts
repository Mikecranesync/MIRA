/**
 * Full Hub audit — 2026-05-19.
 *
 * Authenticates as playwright@factorylm.com (admin, registered via
 * /api/auth/register/) then walks every authenticated route, screenshots
 * desktop (1440x900) and mobile (412x915), and reports per-route status.
 *
 * Run via:
 *   E2E_HUB_URL=http://127.0.0.1:4101 \
 *   E2E_HUB_EMAIL=playwright@factorylm.com \
 *   E2E_HUB_PASSWORD=TestPass123 \
 *   PROMO_DIR=/Users/charlienode/MIRA/docs/promo-screenshots \
 *   bunx playwright test tests/e2e/audit-staging-2026-05-19.spec.ts \
 *     --config=tests/e2e/audit-staging.config.ts
 */

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const HUB = process.env.E2E_HUB_URL ?? "http://127.0.0.1:4101";
const EMAIL = process.env.E2E_HUB_EMAIL ?? "playwright@factorylm.com";
const PASSWORD = process.env.E2E_HUB_PASSWORD ?? "TestPass123";
const PROMO_DIR =
  process.env.PROMO_DIR ?? path.resolve(__dirname, "../../../docs/promo-screenshots");
const REPORT_PATH = path.join(PROMO_DIR, "audit-2026-05-19-staging-report.json");

fs.mkdirSync(PROMO_DIR, { recursive: true });

const ROUTES: { path: string; label: string }[] = [
  { path: "/feed", label: "feed" },
  { path: "/namespace", label: "namespace" },
  { path: "/assets", label: "assets" },
  { path: "/knowledge", label: "knowledge" },
  { path: "/documents", label: "documents" },
  { path: "/scan", label: "scan" },
  { path: "/conversations", label: "conversations" },
  { path: "/workorders", label: "workorders" },
  { path: "/requests", label: "requests" },
  { path: "/alerts", label: "alerts" },
  { path: "/parts", label: "parts" },
  { path: "/schedule", label: "schedule" },
  { path: "/library", label: "library" },
  { path: "/proposals", label: "proposals" },
  { path: "/reports", label: "reports" },
  { path: "/team", label: "team" },
  { path: "/integrations", label: "integrations" },
  { path: "/channels", label: "channels" },
  { path: "/event-log", label: "event-log" },
  { path: "/admin", label: "admin" },
  { path: "/usage", label: "usage" },
  { path: "/more", label: "more" },
  { path: "/plc", label: "plc" },
  { path: "/cmms", label: "cmms" },
  { path: "/onboarding", label: "onboarding" },
];

type Finding = {
  route: string;
  viewport: "desktop" | "mobile";
  status: "pass" | "fail";
  httpStatus: number | null;
  finalUrl: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  screenshot: string;
  notes: string[];
};

const findings: Finding[] = [];

async function login(page: Page): Promise<void> {
  // Authenticate via next-auth CSRF + credentials endpoints directly.
  // The /login UI has a collapsible password form that's brittle to drive;
  // hitting the API endpoint sets the session-token cookie just as cleanly.
  const ctx = page.context();
  const apiRequest = ctx.request;
  // Next-auth route handlers in this Hub are mounted with trailing slashes;
  // hitting the non-slashed form returns a 308 and Playwright's apiRequest
  // drops the form body on POST redirects, breaking credentials login.
  const csrfResp = await apiRequest.get(`${HUB}/api/auth/csrf/`);
  if (!csrfResp.ok()) {
    throw new Error(`CSRF fetch failed: ${csrfResp.status()} ${await csrfResp.text()}`);
  }
  const { csrfToken } = (await csrfResp.json()) as { csrfToken: string };
  const callbackResp = await apiRequest.post(
    `${HUB}/api/auth/callback/credentials/`,
    {
      form: {
        csrfToken,
        email: EMAIL,
        password: PASSWORD,
        callbackUrl: `${HUB}/feed`,
        json: "true",
      },
      maxRedirects: 0,
      failOnStatusCode: false,
    },
  );
  // next-auth returns 200 with { url } on success, 401 on bad creds.
  if (callbackResp.status() >= 400) {
    throw new Error(
      `credentials login failed: ${callbackResp.status()} ${await callbackResp.text()}`,
    );
  }
  // Confirm the session cookie is now in the browser context.
  const cookies = await ctx.cookies(HUB);
  const hasSession = cookies.some(
    (c) =>
      c.name === "next-auth.session-token" ||
      c.name === "__Secure-next-auth.session-token",
  );
  if (!hasSession) {
    throw new Error(
      `no next-auth session cookie after credentials login. cookies: ${cookies.map((c) => c.name).join(",")}`,
    );
  }
  // Warm the session by hitting /feed.
  await page.goto(`${HUB}/feed`, { waitUntil: "domcontentloaded" });
  if (/\/login(\?|$)/.test(page.url())) {
    throw new Error(`landed on /login after credential login — middleware rejected cookie. url=${page.url()}`);
  }
}

async function visitAndCapture(
  page: Page,
  route: { path: string; label: string },
  viewport: "desktop" | "mobile",
): Promise<Finding> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  const onConsole = (msg: import("@playwright/test").ConsoleMessage) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (/extension|chrome-extension/i.test(t)) return;
      consoleErrors.push(t.slice(0, 300));
    }
  };
  const onPageError = (err: Error) => pageErrors.push(err.message.slice(0, 300));
  const onResponse = (resp: import("@playwright/test").Response) => {
    const s = resp.status();
    if (s >= 500 || s === 404) {
      failedRequests.push(`${s} ${resp.url().replace(HUB, "")}`);
    }
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);

  let httpStatus: number | null = null;
  let finalUrl = "";
  const notes: string[] = [];

  try {
    const resp = await page.goto(`${HUB}${route.path}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    httpStatus = resp?.status() ?? null;
    // small settle for client-side hydration
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {
      notes.push("networkidle-timeout");
    });
    finalUrl = page.url();
  } catch (err) {
    notes.push(`navigation-error: ${(err as Error).message.slice(0, 200)}`);
    finalUrl = page.url();
  }

  const fname = `2026-05-19_${route.label}_${viewport}.png`;
  const screenshotPath = path.join(PROMO_DIR, fname);
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 15_000 });
  } catch (err) {
    notes.push(`screenshot-error: ${(err as Error).message.slice(0, 200)}`);
  }

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("response", onResponse);

  // PASS = HTTP 200, no JS page errors, URL didn't bounce to /login.
  const bouncedToLogin = /\/login(\?|$)/.test(finalUrl);
  if (bouncedToLogin) notes.push("redirected-to-login");
  const status: "pass" | "fail" =
    httpStatus === 200 && !bouncedToLogin && pageErrors.length === 0 ? "pass" : "fail";

  return {
    route: route.path,
    viewport,
    status,
    httpStatus,
    finalUrl,
    consoleErrors,
    pageErrors,
    failedRequests,
    screenshot: fname,
    notes,
  };
}

test.describe("Hub full-route audit — staging", () => {
  test.describe.configure({ mode: "serial" });

  test("desktop 1440x900", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page);
    for (const route of ROUTES) {
      const finding = await visitAndCapture(page, route, "desktop");
      findings.push(finding);
      console.log(
        `[desktop] ${route.path} → ${finding.status.toUpperCase()} ` +
          `(${finding.httpStatus}) ${finding.notes.join(", ") || "-"}`,
      );
    }
    await ctx.close();
  });

  test("mobile 412x915", async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 915 },
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await login(page);
    for (const route of ROUTES) {
      const finding = await visitAndCapture(page, route, "mobile");
      findings.push(finding);
      console.log(
        `[mobile]  ${route.path} → ${finding.status.toUpperCase()} ` +
          `(${finding.httpStatus}) ${finding.notes.join(", ") || "-"}`,
      );
    }
    await ctx.close();

    // Write the consolidated JSON report at the very end (mobile runs second).
    fs.writeFileSync(REPORT_PATH, JSON.stringify(findings, null, 2));
    console.log(`[audit] report → ${REPORT_PATH}`);

    // Print a table to stdout for the agent harness.
    console.log("\n=== AUDIT SUMMARY ===");
    for (const f of findings) {
      console.log(
        `${f.status === "pass" ? "✓" : "✗"} ${f.viewport.padEnd(7)} ` +
          `${f.route.padEnd(18)} http=${f.httpStatus ?? "?"} ` +
          `pageErrs=${f.pageErrors.length} consoleErrs=${f.consoleErrors.length} ` +
          `${f.notes.join(", ")}`,
      );
    }
    expect(findings.length).toBe(ROUTES.length * 2);
  });
});
