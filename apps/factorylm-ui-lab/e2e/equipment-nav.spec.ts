import { expect, test, type Page } from "playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Browser proof for the equipment-first navigation fixture slice (2026-11-15).
// Disconnected lab only: no network, no host, no device. PW_CHANNEL=chrome uses
// the installed Chrome instead of a downloaded browser.
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
const treeRow = (page: Page, id: string) => page.locator(`[role="tree"] [data-equipment-id="${id}"]`);
const adapterLog = (page: Page) => page.locator('ol[aria-label="Adapter log"]');

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls horizontally").toBeLessThanOrEqual(0);
}

async function sendQuestion(page: Page, text: string) {
  await page.getByRole("textbox", { name: /ask mira/i }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("desktop 1440x900: browsing keeps the target; Ask about moves it; the send carries it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = watch(page);
  await page.goto("/?surface=hub&theme=light&scenario=general-ask&nav=equipment");
  await expect(target(page)).toHaveText("VFD1 on GS10 bench");
  await expect(target(page)).toBeInViewport();
  await expect(treeRow(page, "c-vfd1-bench")).toHaveAttribute("data-target", "true");
  await page.screenshot({ path: resolve(SHOTS, "2026-11-15_equipment-nav-target_desktop.png") });

  await treeRow(page, "c-q1-mlc-bench").click();
  await expect(target(page)).toHaveText("VFD1 on GS10 bench");
  await expect(page.getByRole("status").filter({ hasText: "Questions still go to VFD1 on GS10 bench" })).toBeVisible();
  await page.screenshot({ path: resolve(SHOTS, "2026-11-15_equipment-nav-browsing_desktop.png") });

  await sendQuestion(page, "What does fault oc mean");
  await expect(adapterLog(page)).toContainText("send:target=m-gs10-bench/c-vfd1-bench");

  await page.locator('[role="tree"]').getByRole("button", { name: "Ask about MLC" }).click();
  await expect(target(page)).toHaveText("MLC on GS10 bench");
  await sendQuestion(page, "What does the RUN light mean");
  await expect(adapterLog(page)).toContainText("send:target=m-gs10-bench/c-q1-mlc-bench");

  // Search bypasses the tree; the repeated VFD1 shows where it is.
  await page.getByRole("searchbox", { name: "Search equipment" }).fill("vfd1");
  const results = page.getByRole("list", { name: "Equipment search results" });
  await expect(results.locator("[data-equipment-id]")).toHaveCount(2);
  await expect(results.locator('[data-equipment-id="c-vfd1-line2"]')).toContainText("Line 2 › Conveyor 2");
  // The browsed row keeps its full label next to the Ask about button.
  await results.locator('[data-equipment-id="c-vfd1-line2"]').click();
  // Clicking a result only browses it: the target holds, and the result offers Ask about.
  await expect(results.getByRole("button", { name: "Ask about VFD1" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Questions still go to MLC on GS10 bench" })).toBeVisible();
  await expect(target(page)).toHaveText("MLC on GS10 bench");
  const label = results.locator('[data-equipment-id="c-vfd1-line2"] .fl-equip__label');
  expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth), "label is truncated").toBe(true);
  await page.screenshot({ path: resolve(SHOTS, "2026-11-15_equipment-nav-search_desktop.png") });

  await noHorizontalScroll(page);
  expect(seen.external).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test("phone 412x915: browse in the drawer, Ask about closes it, target shown beside the composer", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const seen = watch(page);
  await page.goto("/?surface=mobile&theme=light&scenario=general-ask&nav=equipment");
  await expect(target(page)).toHaveText("VFD1 on GS10 bench");
  await expect(target(page)).toBeInViewport();
  await noHorizontalScroll(page);

  const aside = page.locator('aside[aria-label="FactoryLM navigation"]');
  if (!(await aside.isVisible())) await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(aside).toBeVisible();
  await expect(aside.getByRole("note")).toHaveText("Sample equipment for the lab. Not live plant data.");
  // MLC is the Q1 relay, not the PLC; its designation, catalog and PLC output stay separate.
  const mlc = treeRow(page, "c-q1-mlc-bench");
  await expect(mlc.locator(".fl-equip__tag")).toHaveText("Q1");
  await expect(mlc).toContainText("Schneider TeSys CA3KN22BD control relay");
  await expect(mlc.locator(".fl-equip__plc")).toHaveText("PLC out _IO_EM_DO_02");
  await expect(treeRow(page, "c-plc1-bench")).toContainText("Allen-Bradley Micro820");
  // At phone width the catalog number and PLC symbol are whole, not cut with an ellipsis.
  for (const detail of await mlc.locator(".fl-equip__detail").all()) {
    expect(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth), "detail is clipped").toBe(true);
    await expect(detail).toBeInViewport({ ratio: 1 });
  }
  await treeRow(page, "c-q1-mlc-bench").click();
  // Browsing does not close the drawer and does not move the target.
  await expect(aside).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(SHOTS, "2026-11-15_equipment-nav-drawer_mobile.png") });

  await page.locator('[role="tree"]').getByRole("button", { name: "Ask about MLC" }).click();
  await expect(aside).toBeHidden();
  await expect(target(page)).toHaveText("MLC on GS10 bench");
  // Beside the composer and on screen, not below the fold under the sticky composer.
  await expect(target(page)).toBeInViewport();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(SHOTS, "2026-11-15_equipment-nav-target_mobile.png") });

  await noHorizontalScroll(page);
  expect(seen.external).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test("tablet portrait 800x1107: search stays under the note and both VFD1 results show above the keyboard", async ({ page }) => {
  // Galaxy Tab S9 FE portrait in Chrome leaves an 800x1107 CSS px page; the Samsung keyboard
  // covers everything below ~634 px (physical-tablet finding F1, #5564 comment 6894710506).
  // Without align-content: start the nav rows stretch, so the search sat ~70 px lower and
  // dropped another ~220 px once the short result list replaced the tree.
  await page.setViewportSize({ width: 800, height: 1107 });
  const seen = watch(page);
  await page.goto("/?surface=hub&theme=light&scenario=general-ask&nav=equipment");
  const note = page.getByRole("note");
  const search = page.getByRole("searchbox", { name: "Search equipment" });
  await expect(search).toBeVisible();
  const noteTop = (await note.boundingBox())!.y;
  const searchTop = async () => (await search.boundingBox())!.y;
  const before = await searchTop();
  expect(before - noteTop, "blank gap between the note and search").toBeLessThan(80);

  await search.fill("vfd1");
  const results = page.getByRole("list", { name: "Equipment search results" });
  await expect(results.locator("[data-equipment-id]")).toHaveCount(2);
  expect(Math.abs((await searchTop()) - before), "search moved when results replaced the tree").toBeLessThan(2);
  const keyboardLine = 634;
  for (const id of ["c-vfd1-bench", "c-vfd1-line2"]) {
    const box = (await results.locator(`[data-equipment-id="${id}"] .fl-equip__place`).boundingBox())!;
    expect(box.y + box.height, `${id} location is behind the keyboard`).toBeLessThan(keyboardLine);
  }
  await page.screenshot({ path: resolve(SHOTS, "2026-11-15_equipment-search-portrait_tablet.png") });

  await noHorizontalScroll(page);
  expect(seen.external).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test("control: the default lab shows no equipment navigation or target bar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?surface=hub&theme=light&scenario=general-ask");
  await expect(page.getByRole("textbox", { name: /ask mira/i })).toBeVisible();
  await expect(page.getByRole("region", { name: "Question target" })).toHaveCount(0);
  await expect(page.locator('[role="tree"][aria-label="Equipment"]')).toHaveCount(0);
});
