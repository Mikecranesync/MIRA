/**
 * #5546 — on a phone-width screen with a project open, the notebook action column
 * (`data-testid="notebook-actions"`, zIndex 40) sat over the open navigation drawer and
 * took the taps meant for "New project", Search and the first project rows.
 *
 * Runs against a real hub (local dev server or staging): sign in (registering a fresh
 * account unless E2E_EMAIL/E2E_PASSWORD are set) → create two projects (or, with
 * NOTEBOOK_FIXTURES=1, serve two fixed projects for the notebook list/detail reads) →
 * open one at Pixel 7 size → open the drawer → the browser's own hit test must land on
 * the drawer control, not on the action column.
 *
 *   HUB_URL=http://localhost:3131/hub npx playwright test tests/e2e/drawer-actions-5546.spec.ts -c playwright.config.ts
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const HUB = (process.env.HUB_URL ?? "http://localhost:3131/hub").replace(/\/$/, "");
const SHOT_DIR = process.env.SHOT_DIR ?? path.join(__dirname, "..", "..", "..", "docs", "promo-screenshots");

test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });

function rand(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function signUpAndIn(page: Page): Promise<void> {
  // E2E_EMAIL/E2E_PASSWORD reuse one account (registration also fires lead capture).
  const reuse = !!(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);
  const creds = reuse
    ? { email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD!, name: "E2E 5546" }
    : { email: `e2e-5546-${rand()}@example.com`, password: `Pw-${rand()}-${rand()}!A1`, name: "E2E 5546" };
  if (!reuse) {
    const reg = await page.request.post(`${HUB}/api/auth/register/`, { data: creds });
    expect(reg.status(), `register failed: ${await reg.text()}`).toBe(201);
  }
  const csrf = (await (await page.request.get(`${HUB}/api/auth/csrf`)).json()) as { csrfToken: string };
  const res = await page.request.post(`${HUB}/api/auth/callback/credentials/`, {
    form: { email: creds.email, password: creds.password, csrfToken: csrf.csrfToken, redirect: "false", json: "true", callbackUrl: HUB },
    maxRedirects: 0,
  });
  expect([200, 302]).toContain(res.status());
}

/**
 * NOTEBOOK_FIXTURES=1: a database whose schema lags the code (local dev Neon,
 * missing equipment_notebooks.equipment_entity_id) cannot create a project. Sign-in
 * stays real; only the notebook list/detail reads are answered with two fixed
 * projects, so the layout under test is the real shell and host.
 */
const FIXTURES = process.env.NOTEBOOK_FIXTURES === "1";

function fixtureNotebook(id: string, displayName: string) {
  return {
    id, displayName, manufacturer: "AutomationDirect", model: "GS10", catalogNumber: null, serialNumber: null,
    equipmentType: null, assetTag: null, locationLabel: null, identityStatus: "user_confirmed", identityConfidence: null,
    identitySourceType: "user", nodeId: `node-${id}`, sourceCount: 0, lastOpenedAt: null,
    createdAt: "2026-11-14T00:00:00.000Z", asset: null,
  };
}

async function installNotebookFixtures(page: Page, names: [string, string]): Promise<string> {
  const ids = ["00000000-0000-4000-8000-000000005546", "00000000-0000-4000-8000-000000005547"];
  const nbs = ids.map((id, i) => fixtureNotebook(id, names[i]));
  await page.route(/\/api\/equipment-notebooks\/?(\?.*)?$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { notebooks: nbs.map((n) => ({ ...n, threads: [] })) } })
      : route.fallback(),
  );
  await page.route(/\/api\/equipment-notebooks\/[0-9a-f-]{36}\/?(\?.*)?$/, (route) => {
    const nb = nbs.find((n) => route.request().url().includes(n.id));
    return route.request().method() === "GET" && nb
      ? route.fulfill({ json: { notebook: nb, sources: [], turns: [], threads: [], photos: [], manualSearch: null } })
      : route.fallback();
  });
  return ids[0];
}

async function createProject(page: Page, name: string): Promise<string> {
  const res = await page.request.post(`${HUB}/api/equipment-notebooks/`, {
    data: { displayName: name, manufacturer: "AutomationDirect", model: "GS10", identityStatus: "user_confirmed", identitySourceType: "user" },
  });
  expect(res.ok(), `create project failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { notebook: { id: string } }).notebook.id;
}

/** What the browser's own hit test finds at the centre of `target`. */
async function hitAtCentre(page: Page, target: ReturnType<Page["locator"]>): Promise<{ insideActions: boolean; insideTarget: boolean }> {
  const box = await target.boundingBox();
  expect(box, "target has no box").toBeTruthy();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  const handle = await target.elementHandle();
  return page.evaluate(
    ({ x, y, el }) => {
      const hit = document.elementFromPoint(x, y);
      return { insideActions: !!hit?.closest('[data-testid="notebook-actions"]'), insideTarget: !!hit && !!el && (el === hit || el.contains(hit)) };
    },
    { x, y, el: handle },
  );
}

test("#5546: the open drawer's controls take their taps on a phone with a project open", async ({ page }) => {
  test.setTimeout(240_000);
  await signUpAndIn(page);
  const first = FIXTURES
    ? await installNotebookFixtures(page, [`E2E-5546 first ${rand()}`, `E2E-5546 second ${rand()}`])
    : await createProject(page, `E2E-5546 first ${rand()}`);
  if (!FIXTURES) await createProject(page, `E2E-5546 second ${rand()}`);

  await page.goto(`${HUB}/v3/?notebook=${encodeURIComponent(first)}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const actions = page.locator('[data-testid="notebook-actions"]');
  await expect(actions).toBeAttached({ timeout: 120_000 });

  const aside = page.locator('aside[aria-label="FactoryLM navigation"]');
  await expect(aside).toBeAttached();
  if (await aside.evaluate((el) => el.hasAttribute("inert"))) {
    await page.locator('button[aria-label="Open navigation"]').click();
  }
  await expect.poll(() => aside.evaluate((el) => el.hasAttribute("inert"))).toBe(false);
  await expect(aside).toBeVisible();
  await page.waitForTimeout(400); // the drawer's 160 ms slide

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `2026-11-15_drawer-actions-5546_mobile.png`) });

  const targets = [
    aside.getByRole("button", { name: /new project/i }).first(),
    aside.getByRole("searchbox").or(aside.locator("input")).first(),
    aside.getByText(/E2E-5546 second/).first(),
  ];
  for (const target of targets) {
    await expect(target).toBeVisible();
    const hit = await hitAtCentre(page, target);
    expect(hit.insideActions, "the action column took the tap meant for a drawer control").toBe(false);
    expect(hit.insideTarget, "the drawer control did not receive the tap").toBe(true);
  }
  // Playwright's own actionability check (the one that reported "intercepts pointer events").
  await targets[0].click({ trial: true, timeout: 5_000 });

  // Closing the drawer brings the column back, still mounted.
  await page.locator(".fl-shell__drawer-close").first().click();
  await expect.poll(() => aside.evaluate((el) => el.hasAttribute("inert"))).toBe(true);
  await expect(actions).toBeVisible();
});
