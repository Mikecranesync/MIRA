/**
 * Mechanical full-page audit.
 *
 * Every (hub) page route + auth pages get loaded against the live hub. Per
 * route we capture: HTTP status, JS console errors, unhandled exceptions,
 * paint completeness, and load time. Output is appended to
 * docs/audits/YYYY-MM-DD-audit.md so regressions surface diff-style on
 * subsequent runs.
 *
 * Spec: docs/specs/enforcement-layer-spec.md §4.1
 *
 * Run: HUB_URL=https://app.factorylm.com npx playwright test tests/e2e/hub-page-audit.spec.ts
 *
 * The 28-route catalog is regenerated from mira-hub/src/app at boot — adding a
 * page.tsx automatically expands the audit, no edits required here.
 */

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com";
const ROOT = path.resolve(__dirname, "..", "..", "..");
const AUDIT_DIR = path.join(ROOT, "docs", "audits");
const PAINT_THRESHOLD_MS = 5000;
const MIN_BODY_TEXT_CHARS = 20;

interface RouteResult {
  route: string;
  ok: boolean;
  status: number;
  consoleErrors: number;
  exceptions: number;
  paintMs: number;
  bodyChars: number;
  notes: string[];
}

const RESULTS: RouteResult[] = [];

// ─── Route catalog (regenerated from filesystem) ────────────────────────────

function discoverRoutes(): string[] {
  const appDir = path.join(ROOT, "mira-hub", "src", "app");
  const routes: string[] = [];

  // Public auth pages live at the root of /app
  for (const r of ["login", "signup"]) {
    if (fs.existsSync(path.join(appDir, r, "page.tsx"))) {
      routes.push("/" + r);
    }
  }

  // Hub pages — under (hub) route group
  const hubGroup = path.join(appDir, "(hub)");
  if (fs.existsSync(hubGroup)) {
    walk(hubGroup, "", routes);
  }

  return Array.from(new Set(routes)).sort();
}

function walk(dir: string, prefix: string, acc: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    // Skip dynamic segments, route groups, private dirs, and api routes — we
    // want concrete user-facing routes only.
    if (name.startsWith("[") || name.startsWith("(") || name.startsWith("_") || name === "api") {
      continue;
    }

    const child = path.join(dir, name);
    const childPrefix = prefix + "/" + name;
    if (fs.existsSync(path.join(child, "page.tsx"))) {
      acc.push(childPrefix);
    }
    walk(child, childPrefix, acc);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function attachInstrumentation(page: Page): { errors: string[]; exceptions: string[] } {
  const errors: string[] = [];
  const exceptions: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Filter known-noisy prod errors that aren't real regressions.
      if (text.includes("Failed to load resource") && text.includes("favicon")) return;
      errors.push(text.slice(0, 240));
    }
  });

  page.on("pageerror", (err) => {
    exceptions.push((err.message || String(err)).slice(0, 240));
  });

  return { errors, exceptions };
}

async function visit(page: Page, route: string): Promise<RouteResult> {
  const inst = attachInstrumentation(page);
  const finalUrl = HUB.replace(/\/$/, "") + route;

  const t0 = Date.now();
  let status = 0;
  const notes: string[] = [];

  try {
    const resp = await page.goto(finalUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    status = resp?.status() ?? 0;
  } catch (err) {
    notes.push("nav-error: " + (err instanceof Error ? err.message : String(err)).slice(0, 120));
  }
  const paintMs = Date.now() - t0;

  // Auth-gated routes redirect to /login — that's a healthy state, not a fail.
  const finalUrlActual = page.url();
  const redirectedToLogin = /\/login\b/.test(finalUrlActual);
  if (redirectedToLogin && route !== "/login") {
    notes.push("auth-redirect");
  }

  let bodyChars = 0;
  try {
    const text = await page.locator("body").innerText({ timeout: 3000 });
    bodyChars = text.replace(/\s+/g, " ").trim().length;
  } catch {
    /* page may have torn down */
  }

  const httpOk = status === 200 || status === 304 || (redirectedToLogin && status >= 300 && status < 400) || (redirectedToLogin && status === 200);
  const paintOk = paintMs <= PAINT_THRESHOLD_MS;
  // Auth-redirect to /login is the correct unauth behavior — treat the redirect
  // destination body (login page) as satisfying the body check. Closes #1056.
  const bodyOk = redirectedToLogin || bodyChars >= MIN_BODY_TEXT_CHARS;
  // For auth-redirected routes, console errors on the login landing page are
  // not bugs in the protected page itself — only count errors on direct-load pages.
  const errorsOk = redirectedToLogin ? true : inst.errors.length === 0;
  const exceptionsOk = inst.exceptions.length === 0;

  if (!httpOk) notes.push(`http-${status}`);
  if (!paintOk) notes.push(`slow-${paintMs}ms`);
  if (!bodyOk) notes.push(`empty-body-${bodyChars}chars`);
  if (!errorsOk) notes.push(`${inst.errors.length}-console-errors`);
  if (!exceptionsOk) notes.push(`${inst.exceptions.length}-exceptions`);

  // Surface the first error/exception text in notes so the audit is debuggable.
  if (inst.errors.length && !redirectedToLogin) notes.push("err: " + inst.errors[0].slice(0, 80));
  if (inst.exceptions.length) notes.push("exc: " + inst.exceptions[0].slice(0, 80));

  const ok = httpOk && paintOk && bodyOk && errorsOk && exceptionsOk;

  return {
    route,
    ok,
    status,
    consoleErrors: inst.errors.length,
    exceptions: inst.exceptions.length,
    paintMs,
    bodyChars,
    notes,
  };
}

// ─── Audit run ──────────────────────────────────────────────────────────────

const ROUTES = discoverRoutes();

test.describe.configure({ mode: "serial" });

test(`audit: ${ROUTES.length} routes`, async ({ page }) => {
  console.log(`Auditing ${ROUTES.length} routes against ${HUB}`);

  for (const route of ROUTES) {
    const result = await visit(page, route);
    RESULTS.push(result);
    const icon = result.ok ? "✅" : "❌";
    console.log(`${icon} ${route.padEnd(28)} ${result.status} ${result.paintMs}ms ${result.notes.join(" | ")}`);
  }

  const passing = RESULTS.filter((r) => r.ok).length;
  const score = `${passing}/${RESULTS.length}`;
  console.log(`\nScore: ${score}`);

  writeAuditReport(score);

  // Phase 1: warn-only. We assert on a soft floor so someone shipping a
  // catastrophic regression still gets a red CI signal, but routine flakes
  // don't spam. Floor: 50% of routes must be healthy.
  expect(passing, `audit floor: at least half the routes must be healthy`).toBeGreaterThanOrEqual(Math.ceil(RESULTS.length / 2));
});

function writeAuditReport(score: string): void {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const out = path.join(AUDIT_DIR, `${today}-audit.md`);

  const previous = readPreviousScore();
  const passing = RESULTS.filter((r) => r.ok).length;
  const regressed = previous !== null && passing < previous;

  const lines: string[] = [];
  lines.push(`# Hub Page Audit — ${today}`);
  lines.push("");
  lines.push(`- Hub: ${HUB}`);
  lines.push(`- Score: **${score}** routes healthy`);
  if (previous !== null) {
    const delta = passing - previous;
    const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    lines.push(`- Previous: ${previous}/${RESULTS.length} (${arrow} ${delta >= 0 ? "+" : ""}${delta})`);
  }
  if (regressed) {
    lines.push("");
    lines.push("> ⚠️ **Regression detected.** Score dropped from previous audit.");
  }
  lines.push("");
  lines.push("## Per-route results");
  lines.push("");
  lines.push("| Route | OK | HTTP | Paint | Body | Errors | Exceptions | Notes |");
  lines.push("|-------|----|------|-------|------|--------|------------|-------|");
  for (const r of RESULTS) {
    const okIcon = r.ok ? "✅" : "❌";
    const notes = r.notes.length ? r.notes.join("; ").replace(/\|/g, "\\|") : "-";
    lines.push(
      `| \`${r.route}\` | ${okIcon} | ${r.status} | ${r.paintMs}ms | ${r.bodyChars}c | ${r.consoleErrors} | ${r.exceptions} | ${notes} |`,
    );
  }
  lines.push("");
  lines.push("## Failures");
  lines.push("");
  const failures = RESULTS.filter((r) => !r.ok);
  if (failures.length === 0) {
    lines.push("_None._");
  } else {
    for (const f of failures) {
      lines.push(`- \`${f.route}\` — ${f.notes.join(", ")}`);
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("_Generated by `tests/e2e/hub-page-audit.spec.ts` (spec: `docs/specs/enforcement-layer-spec.md` §4.1)._");

  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(`Wrote ${out}`);
}

function readPreviousScore(): number | null {
  if (!fs.existsSync(AUDIT_DIR)) return null;
  const files = fs
    .readdirSync(AUDIT_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}-audit\.md$/.test(f))
    .sort()
    .reverse();
  // Skip today's file (we're about to write it / overwrite).
  const today = new Date().toISOString().slice(0, 10);
  const prior = files.find((f) => !f.startsWith(today));
  if (!prior) return null;
  const txt = fs.readFileSync(path.join(AUDIT_DIR, prior), "utf-8");
  const m = txt.match(/Score: \*\*(\d+)\/\d+\*\*/);
  return m ? parseInt(m[1], 10) : null;
}
