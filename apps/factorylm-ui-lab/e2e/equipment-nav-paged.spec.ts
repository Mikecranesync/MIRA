import { expect, test, type Page } from "playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Browser proof for the paged equipment navigator (PR A, 2026-11-17). The lab's
// fake source plays the #5602 equipment-browser API: one page per request,
// server-side search, explicit resolve. Disconnected lab only: no network, no
// host, no device. PW_CHANNEL=chrome uses the installed Chrome.
const SHOTS = resolve(import.meta.dirname, "../../../docs/promo-screenshots");
mkdirSync(SHOTS, { recursive: true });
if (process.env.PW_CHANNEL) test.use({ channel: process.env.PW_CHANNEL });

function watch(page: Page) {
  const external: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:")) external.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return { external, errors };
}

const target = (page: Page) => page.getByTestId("question-target");
const row = (page: Page, key: string) => page.locator(`[role="tree"] [data-equipment-key="${key}"]`);
const adapterLog = (page: Page) => page.locator('ol[aria-label="Adapter log"]');

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls horizontally").toBeLessThanOrEqual(0);
}

async function openBench(page: Page) {
  await row(page, "namespace:ns-garage").click();
  await row(page, "namespace:ns-bench-line").click();
  await row(page, "notebook:nb-gs10-bench").click();
  await expect(row(page, "notebook_component:nc-q1-mlc-bench")).toBeVisible();
}

test("desktop 1440x900: pages load per expand, a 409 is shown and not retried, Ask about moves the target", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = watch(page);
  await page.goto("/?surface=hub&theme=light&scenario=general-ask&nav=equipment-paged");
  await expect(target(page)).toHaveText("VFD1 on GS10 bench");
  await expect(row(page, "namespace:ns-garage")).toBeVisible();
  // Only the root page was requested on load.
  await expect(adapterLog(page)).toContainText("browse:children root");
  await expect(adapterLog(page)).not.toContainText("browse:children namespace:");

  await openBench(page);
  await expect(row(page, "notebook_component:nc-vfd1-bench")).toHaveAttribute("data-target", "true");
  await expect(row(page, "notebook_component:nc-k0-retired")).toContainText("Retired");

  // A component corrected since the list loaded: resolve once, notice beside the composer, target holds.
  await row(page, "notebook_component:nc-k2-corrected").click();
  await page.locator('[role="tree"]').getByRole("button", { name: "Ask about Contactor K2" }).click();
  const notice = page.getByRole("alert").filter({ hasText: "did not change" });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-reason", "stale_revision");
  await page.waitForTimeout(400);
  expect(await adapterLog(page).locator("li", { hasText: "browse:resolve notebook_component:nc-k2-corrected" }).count()).toBe(1);
  await expect(target(page)).toHaveText("VFD1 on GS10 bench");
  await page.screenshot({ path: resolve(SHOTS, "2026-11-17_equipment-nav-paged-stale-409_desktop.png") });

  // Recovery is a reload, not a retry: the list is fetched again, nothing is resolved, the target holds.
  await expect(adapterLog(page).locator("li", { hasText: "browse:resolve notebook_component:nc-k2-corrected rev=1" })).toHaveCount(1);
  await page.locator(".fl-equip").getByRole("button", { name: "Load current record" }).click();
  await expect(adapterLog(page).locator("li", { hasText: "browse:children notebook:nb-gs10-bench" })).toHaveCount(2);
  expect(await adapterLog(page).locator("li", { hasText: "browse:resolve" }).count()).toBe(1);
  await expect(target(page)).toHaveText("VFD1 on GS10 bench");

  // Browsing MLC keeps the target; the explicit Ask about resolves it and moves it.
  await row(page, "notebook_component:nc-q1-mlc-bench").click();
  await expect(target(page)).toHaveText("VFD1 on GS10 bench");
  await expect(page.getByRole("status").filter({ hasText: "Questions still go to VFD1 on GS10 bench" })).toBeVisible();
  await page.locator('[role="tree"]').getByRole("button", { name: "Ask about MLC" }).click();
  await expect(target(page)).toHaveText("MLC on GS10 bench");
  await page.getByRole("textbox", { name: /ask mira/i }).fill("What does the RUN light mean");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(adapterLog(page)).toContainText("send:target=nb-gs10-bench/nc-q1-mlc-bench");
  await page.screenshot({ path: resolve(SHOTS, "2026-11-17_equipment-nav-paged-target_desktop.png") });

  // Server search over the 20,000-component plant: one bounded page, then Show more.
  await page.getByRole("searchbox", { name: "Search equipment" }).fill("GS10 drive");
  const results = page.getByRole("list", { name: "Equipment search results" });
  await expect(results.locator("[data-equipment-key]")).toHaveCount(25);
  await results.getByRole("button", { name: /^Show more/ }).click();
  await expect(results.locator("[data-equipment-key]")).toHaveCount(50);
  await page.screenshot({ path: resolve(SHOTS, "2026-11-17_equipment-nav-paged-search_desktop.png") });

  await noHorizontalScroll(page);
  expect(seen.external).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test("phone 412x915: duplicate VFD1s show their place, the unlinked one cannot be asked, Ask about closes the drawer", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const seen = watch(page);
  await page.goto("/?surface=mobile&theme=light&scenario=general-ask&nav=equipment-paged");
  await expect(target(page)).toHaveText("VFD1 on GS10 bench");
  const aside = page.locator('aside[aria-label="FactoryLM navigation"]');
  if (!(await aside.isVisible())) await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(aside).toBeVisible();

  await page.getByRole("searchbox", { name: "Search equipment" }).fill("vfd1");
  const results = page.getByRole("list", { name: "Equipment search results" });
  await expect(results.locator("[data-equipment-key]")).toHaveCount(3);
  await expect(results.locator('[data-equipment-key="notebook_component:nc-vfd1-line2"]')).toContainText("Line 2");
  const unlinked = results.locator('[data-equipment-key="installed_instance:ii-vfd1-line2"]');
  await expect(unlinked).toContainText("Not linked to a notebook");
  await unlinked.click();
  await expect(results.getByRole("button", { name: /^Ask about/ })).toHaveCount(0);
  await expect(aside).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(SHOTS, "2026-11-17_equipment-nav-paged-drawer_mobile.png") });

  await results.locator('[data-equipment-key="notebook_component:nc-vfd1-line2"]').click();
  await results.getByRole("button", { name: "Ask about VFD1" }).click();
  await expect(aside).toBeHidden();
  await expect(target(page)).toHaveText("VFD1 on Conveyor 2 notebook");
  await expect(target(page)).toBeInViewport();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(SHOTS, "2026-11-17_equipment-nav-paged-target_mobile.png") });

  await noHorizontalScroll(page);
  expect(seen.external).toEqual([]);
  expect(seen.errors).toEqual([]);
});
