import { test, expect } from "playwright/test";

test.skip(process.env.LAB_PREVIEW_PROFILE !== "evidence", "Explicit disconnected evidence prototype only");
test.use({ channel: "chrome" });

for (const size of [{ width: 800, height: 1280 }, { width: 1280, height: 800 }, { width: 412, height: 915 }]) {
  test(`citations, page transitions, zoom and return at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "See what supports the answer." })).toBeVisible();
    const marker = page.getByRole("button", { name: "Review citation 1", exact: true });
    expect(await marker.evaluate((el) => el.parentElement?.tagName)).toBe("SUP");
    await marker.click();
    const reader = page.getByRole("dialog", { name: "Citation evidence" });
    await expect(reader).toBeVisible();
    await expect(page.locator('[data-highlight="identity"]')).toBeVisible();
    await expect(reader.getByRole("button", { name: "Previous highlight" })).toBeDisabled();
    await expect(reader.getByRole("status")).toHaveText("1 of 3");
    await reader.getByRole("button", { name: "Next highlight" }).click();
    await expect(page.locator('[data-highlight="revision"]')).toBeVisible();
    await expect(reader).toContainText("PDF page 1 of 2");
    await reader.getByRole("button", { name: "Next highlight" }).click();
    await expect(page.locator('[data-highlight="record"]')).toBeVisible();
    await expect(reader).toContainText("PDF page 2 of 2");
    await expect(reader.getByRole("button", { name: "Next highlight" })).toBeDisabled();
    await reader.getByRole("button", { name: "Enlarge page" }).click();
    const geometry = await page.locator('[data-highlight="record"]').evaluate((el) => {
      const box = el.getBoundingClientRect();
      const paper = el.parentElement!.getBoundingClientRect();
      return { left: (box.left - paper.left) / paper.width, width: box.width / paper.width };
    });
    expect(geometry.left).toBeCloseTo(46 / 612, 2);
    expect(geometry.width).toBeCloseTo(339 / 612, 2);
    await reader.getByRole("button", { name: "Fit page" }).click();
    await page.screenshot({ path: `test-results/evidence-${size.width}.png` });
    await reader.getByRole("button", { name: "Back to answer" }).click();
    await expect(reader).not.toBeVisible();
    await expect(marker).toBeFocused();
    await page.getByRole("button", { name: "Review citation 3", exact: true }).click();
    await expect(page.locator('[data-highlight="record"]')).toBeVisible();
    await page.goBack();
    await expect(reader).not.toBeVisible();
    await page.getByRole("button", { name: "Dark appearance" }).click();
    await page.getByRole("button", { name: "Review evidence" }).click();
    await expect(page.locator('[data-highlight="identity"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(reader).not.toBeVisible();
    expect(errors).toEqual([]);
  });
}
