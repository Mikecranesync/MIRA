import { expect, test } from "playwright/test";

/**
 * #4763 — on a phone in landscape, pending attachments must not eat the screen.
 * Found on the Pixel 9a and emulator (2026-10-25): six files left a 44 px conversation and pushed
 * the composer's Attach/Send row below the screen edge. Real layout, real attach flow (lab adapter).
 * Run: cd apps/factorylm-ui-lab && bun x playwright test e2e/pending-list-landscape.spec.ts
 */
async function attachFiles(page: import("playwright/test").Page, n: number) {
  for (let i = 0; i < n; i++) {
    await page.getByRole("button", { name: "Add attachment" }).click();
    await page.getByRole("dialog", { name: "Attachment menu" }).getByRole("button", { name: "File" }).click();
  }
  await expect(page.locator(".fl-composer__pending > li")).toHaveCount(n);
}

const geometry = (page: import("playwright/test").Page) => page.evaluate(() => {
  const list = document.querySelector<HTMLElement>(".fl-composer__pending")!;
  const row = document.querySelector<HTMLElement>(".fl-composer__row")!;
  const composer = document.querySelector<HTMLElement>(".fl-composer")!;
  return {
    viewport: innerHeight,
    rowBottom: Math.round(row.getBoundingClientRect().bottom),
    composerTop: Math.round(composer.getBoundingClientRect().top),
    listHeight: Math.round(list.getBoundingClientRect().height),
    listScrolls: list.scrollHeight > list.clientHeight + 1,
  };
});

for (const [name, viewport] of [["landscape phone", { width: 844, height: 390 }], ["landscape Pixel 9a", { width: 924, height: 412 }]] as const) {
  test(`${name}: six pending files keep the input row on screen and most of the conversation readable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?surface=mobile&theme=light&scenario=grounded-answer");
    await page.keyboard.press("Escape");
    await attachFiles(page, 6);
    const g = await geometry(page);
    expect(g.rowBottom, "Attach/Send row fully on screen").toBeLessThanOrEqual(g.viewport);
    expect(g.composerTop, "at least 45% of the height left for the conversation").toBeGreaterThanOrEqual(g.viewport * 0.45);
    expect(g.listScrolls, "the extra files scroll inside the list").toBe(true);
    // The last file stays reachable inside the list.
    await page.locator(".fl-composer__pending > li").last().scrollIntoViewIfNeeded();
    await expect(page.locator(".fl-composer__pending > li").last()).toBeInViewport();
  });
}

test("portrait phone: two files are shown whole — the cap never hides a short list", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/?surface=mobile&theme=light&scenario=grounded-answer");
  await page.keyboard.press("Escape");
  await attachFiles(page, 2);
  const g = await geometry(page);
  expect(g.listScrolls).toBe(false);
});
