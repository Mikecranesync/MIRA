import { test } from "playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const OUT = resolve(import.meta.dirname, "../../../.audit/shots");
const PHASE = process.env.AESTHETIC_PHASE ?? "before";
const SHOTS = ["grounded-answer", "machine-ask", "work-run", "project-tree"] as const;
test.describe("aesthetic shots", () => {
  test.use({ viewport: { width: 412, height: 915 } });
  for (const s of SHOTS) for (const theme of ["light","dark"] as const) {
    test(`${PHASE} ${s} ${theme}`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      await page.goto(`/?surface=mobile&theme=${theme}&scenario=${s}`);
      await page.locator(".fl-shell").waitFor();
      // The lab inherits the shared reducer default navigationVisible: true
      // (correct for the desktop permanent sidebar). mira-mobile corrects this on
      // init; the lab does not, so dismiss the drawer to photograph the landing
      // screen the phone actually shows.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      await page.screenshot({ path: resolve(OUT, `${PHASE}_${s}_${theme}_412x915.png`), fullPage: false });
    });
  }
});
