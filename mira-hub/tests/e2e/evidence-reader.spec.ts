import { test, expect } from "@playwright/test";
for (const viewport of [{ width: 800, height: 1280 }, { width: 1280, height: 800 }, { width: 412, height: 915 }]) {
  test(`real citation adapter ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    const first = page.getByRole("button", { name: "Review citation 1", exact: true });
    await first.click();
    await expect(page.locator("[data-evidence-highlight]")).toHaveCount(1);
    await expect(page.locator("canvas")).toHaveAttribute("data-rendered-page", "1");
    const firstTop = await page.locator("[data-evidence-highlight]").evaluate(el => (el as HTMLElement).style.top);
    await page.getByRole("button", { name: "Next highlight" }).click();
    await expect(page.locator("[data-evidence-highlight]")).toHaveCount(1);
    expect(await page.locator("[data-evidence-highlight]").evaluate(el => (el as HTMLElement).style.top)).not.toBe(firstTop);
    await page.getByRole("button", { name: "Next highlight" }).click();
    await expect(page.locator("canvas")).toHaveAttribute("data-rendered-page", "2");
    await expect(page.locator("[data-evidence-highlight]")).toHaveCount(2);
    await page.getByRole("button", { name: "Previous highlight" }).click();
    await expect(page.locator("canvas")).toHaveAttribute("data-rendered-page", "1");
    await expect(page.locator("[data-evidence-highlight]")).toHaveCount(1);
    await page.getByRole("button", { name: "Next highlight" }).click();
    await expect(page.locator("[data-evidence-highlight]")).toHaveCount(2);
    await page.screenshot({ path: `test-results/real-evidence-${viewport.width}.png` });
    await page.getByRole("button", { name: "Next highlight" }).click();
    await expect(page.getByText(/Highlight unavailable: the quoted text was not found/)).toBeVisible();
    await expect(page.locator("[data-evidence-highlight]")).toHaveCount(0);
    await page.getByRole("button", { name: "Next highlight" }).click();
    await expect(page.getByRole("alert")).toContainText("valid PDF page");
    await page.getByRole("button", { name: "Back to answer" }).click();
    await expect(first).toBeFocused();
    await first.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Review evidence", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
test("expired session never displays cached/guessed evidence", async ({ page }) => {
  await page.route("**/api/namespace/files/**", route => route.fulfill({ status: 401, body: "Unauthorized" }));
  await page.goto("/");
  await page.getByRole("button", { name: "Review citation 1", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/sign in/i);
  await expect(page.locator("[data-evidence-highlight]")).toHaveCount(0);
});
