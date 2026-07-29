import { expect, test } from "@playwright/test";
import { HUB_URL, loginWithPassword } from "./fixtures/auth";

test.describe("authenticated logout navigation", () => {
  test("mobile drawer exposes sign out and clears the session", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginWithPassword(page);

    await page.goto(`${HUB_URL}/feed`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^More$/ }).click();

    const drawer = page.getByRole("dialog", { name: /navigation menu/i });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: /^Sign out$/ })).toBeVisible();

    await drawer.getByRole("button", { name: /^Sign out$/ }).click();

    await expect(page).toHaveURL(/\/login\/?$/);
    await page.goto(`${HUB_URL}/feed`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/);
  });

  test("desktop sidebar sign out clears the session", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginWithPassword(page);

    await page.goto(`${HUB_URL}/feed`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^Sign out$/ }).click();

    await expect(page).toHaveURL(/\/login\/?$/);
    await page.goto(`${HUB_URL}/feed`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/);
  });
});
