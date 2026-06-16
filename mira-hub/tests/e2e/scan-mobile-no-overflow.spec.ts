import { test, expect } from "@playwright/test";

test("scan page has no horizontal overflow at 412px", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/scan");
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
