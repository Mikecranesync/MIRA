import { expect, test, type Page } from "playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { FIXTURE_IDS } from "../../../packages/factorylm-interaction/src/fixtures";

const SURFACES = ["public", "web", "mobile", "hub"] as const;
const THEMES = ["light", "dark"] as const;
const VIEWPORTS = { "390x844": [390, 844], "412x915": [412, 915], "768x1024": [768, 1024], "1440x900": [1440, 900], "1720x1000": [1720, 1000] } as const;
const SHOTS = resolve(import.meta.dirname, "../../../docs/promo-screenshots");
mkdirSync(SHOTS, { recursive: true });

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

test.describe("no network, no console errors", () => {
  for (const surface of SURFACES) {
    for (const theme of THEMES) {
      test(`${surface}-${theme}`, async ({ page }) => {
        const seen = watch(page);
        await page.goto(`/?surface=${surface}&theme=${theme}&scenario=grounded-answer`);
        await expect(page.getByRole("textbox", { name: /ask mira/i })).toBeVisible();
        expect(seen.external).toEqual([]);
        expect(seen.errors).toEqual([]);
      });
    }
  }

  for (const scenario of FIXTURE_IDS) {
    test(`renders ${scenario} without console errors`, async ({ page }) => {
      const seen = watch(page);
      await page.goto(`/?surface=web&theme=light&scenario=${scenario}`);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("region", { name: "Conversation" })).toBeVisible();
      expect(seen.errors).toEqual([]);
      expect(seen.external).toEqual([]);
    });
  }

  test("a mock send never leaves the loopback", async ({ page }) => {
    const seen = watch(page);
    await page.goto("/?surface=web&theme=light&scenario=general-ask");
    await page.getByRole("textbox", { name: /ask mira/i }).fill("How is preload measured?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("[data-turn-id]")).toHaveCount(3);
    expect(seen.external).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
});

test.describe("screenshot matrix", () => {
  for (const surface of SURFACES) {
    for (const theme of THEMES) {
      for (const [name, [width, height]] of Object.entries(VIEWPORTS)) {
        test(`grounded-answer ${surface} ${theme} ${name}`, async ({ page }) => {
          const seen = watch(page);
          await page.setViewportSize({ width, height });
          await page.goto(`/?surface=${surface}&theme=${theme}&scenario=grounded-answer`);
          await expect(page.getByRole("region", { name: "Conversation" })).toBeVisible();
          await page.screenshot({ path: resolve(SHOTS, `2026-09-06_flm-ui-v2-grounded-answer_${surface}_${theme}_${name}.png`) });
          expect(seen.errors).toEqual([]);
        });
      }
    }
  }

  for (const scenario of FIXTURE_IDS) {
    for (const [name, [width, height]] of [["1440x900", [1440, 900]], ["412x915", [412, 915]]] as const) {
      test(`scenario ${scenario} at ${name}`, async ({ page }) => {
        const seen = watch(page);
        await page.setViewportSize({ width, height });
        await page.goto(`/?surface=${name === "412x915" ? "mobile" : "web"}&theme=light&scenario=${scenario}`);
        await expect(page.getByRole("main")).toBeVisible();
        await page.screenshot({ path: resolve(SHOTS, `2026-09-06_flm-ui-v2-${scenario}_${name === "412x915" ? "mobile" : "web"}_light_${name}.png`) });
        expect(seen.errors).toEqual([]);
      });
    }
  }
});
