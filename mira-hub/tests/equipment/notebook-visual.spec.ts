/**
 * Visual-regression baselines for the Equipment Notebook CHROME across
 * viewports (desktop / tablet / mobile / narrow via the config's projects).
 * These lock LAYOUT — header, composer, source-sheet structure, list cards —
 * not the ever-growing conversation content or drifting timestamps, which are
 * masked so the baselines stay stable across runs (the loop project mutates
 * the notebook). Baselines are created with --update-snapshots, committed per
 * project.
 */
import { test, expect } from "@playwright/test";

const NB = process.env.NOTEBOOK_ID ?? "39f36b8a-0303-4d85-a9aa-db63c4341172";

// Non-deterministic regions to mask everywhere.
const TRIAL = /Free trial/;

test.describe("Equipment Notebook visuals", () => {
  // Baselines encode the maintainer notebook's chrome. For an account that
  // can't see that notebook (e.g. the new-user loop account), skip loudly
  // instead of timing out — the loop project is the account-agnostic gate.
  test.beforeEach(async ({ page }) => {
    const r = await page.request.get(`api/equipment-notebooks/${NB}/`);
    test.skip(!r.ok(), `notebook ${NB} not visible to this account — set NOTEBOOK_ID to a seeded notebook for visual baselines`);
  });

  test("notebook list", async ({ page }) => {
    await page.goto("equipment/");
    await expect(page.getByRole("heading", { name: "Equipment Notebooks" })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("notebook-list.png", {
      fullPage: true,
      // Mask the trial banner and the relative "N ago" timestamps on each card.
      mask: [page.getByText(TRIAL), page.getByText(/\bago$/)],
      maxDiffPixelRatio: 0.02,
    });
  });

  test("notebook chat empty/loaded state", async ({ page }) => {
    await page.goto(`equipment/${NB}/`);
    await expect(page.getByRole("button", { name: /^Sources · / })).toBeVisible();
    await page.waitForTimeout(800);
    // Lock the header + composer chrome; mask the conversation log (grows every
    // run) and the trial banner.
    await expect(page).toHaveScreenshot("notebook-chat.png", {
      mask: [page.getByText(TRIAL), page.getByTestId("notebook-chat-log")],
      maxDiffPixelRatio: 0.02,
    });
  });

  test("sources sheet open", async ({ page }) => {
    await page.goto(`equipment/${NB}/`);
    await page.getByRole("button", { name: /^Sources · / }).click();
    await expect(page.getByRole("dialog", { name: "Sources" })).toBeVisible();
    await page.waitForTimeout(400);
    // Screenshot the sheet PANEL element (not the full-screen scrim dialog):
    // its content is deterministic (title, source rows, Upload PDF, Add-source
    // link), independent of the conversation behind the scrim.
    await expect(page.getByTestId("sources-sheet-panel")).toHaveScreenshot("sources-sheet.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});
