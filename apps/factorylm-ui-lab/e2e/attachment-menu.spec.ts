import { expect, test } from "playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

for (const renderer of ["classic", "assistant"] as const) {
  for (const [viewport, width, height] of [["portrait", 390, 844], ["landscape", 844, 390], ["desktop", 1280, 900]] as const) {
    test(renderer + " attachment availability and copy, " + viewport + " (#4631 #4683)", async ({ page, browser }) => {
      await page.setViewportSize({ width, height });
      const external: string[] = [], errors: string[] = [];
      page.on("request", request => { if (!request.url().startsWith("http://127.0.0.1:")) external.push(request.url()); });
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto("/?surface=web&theme=light&scenario=grounded-answer&embed=1&thread=" + renderer);
      await page.keyboard.press("Escape");
      const draft = page.getByRole("textbox", { name: "Ask MIRA", exact: true });
      await draft.fill("Keep this draft while I inspect Attach.");
      const attach = page.getByRole("button", { name: "Add attachment", exact: true });
      const attachBox = await attach.boundingBox();
      const glyphBox = await attach.locator("svg").boundingBox();
      expect(attachBox?.height).toBeGreaterThanOrEqual(44);
      // Engineering choice for this icon repair; not a Level3 customer-acceptance threshold.
      expect(glyphBox?.width).toBeGreaterThanOrEqual(20);
      await attach.click();
      const menu = page.getByRole("dialog", { name: "Attachment menu", exact: true });
      await expect(menu.locator(".fl-attachment-menu__title")).toHaveText("Attach");
      const photo = menu.getByRole("button", { name: "Photo", exact: true });
      await expect(photo).toBeEnabled();
      await expect(menu.getByRole("button", { name: "File", exact: true })).toBeEnabled();
      for (const name of ["Camera", "Scan QR code"]) {
        const button = menu.getByRole("button", { name, exact: true });
        await expect(button).toBeDisabled();
        const describedBy = await button.getAttribute("aria-describedby");
        expect(describedBy).toBeTruthy();
        await expect(menu.locator('[id="' + describedBy + '"]')).toHaveText("Requires the mobile app");
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport({ ratio: 1 });
        expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      const styles = await menu.evaluate(element => {
        const buttons = Array.from(element.querySelectorAll("button"));
        const photo = buttons.find(button => button.textContent?.trim() === "Photo")!;
        const camera = buttons.find(button => button.getAttribute("aria-label") === "Camera")!;
        return { enabled: getComputedStyle(photo).color, disabled: getComputedStyle(camera).color,
          disabledBorder: getComputedStyle(camera).borderTopStyle, disabledCursor: getComputedStyle(camera).cursor };
      });
      expect(styles.disabled).not.toBe(styles.enabled);
      expect(styles.disabledBorder).toBe("dashed");
      expect(styles.disabledCursor).toBe("not-allowed");
      await menu.evaluate(element => { element.scrollTop = 0; });
      const shots = resolve(import.meta.dirname, "../../../docs/promo-screenshots");
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: resolve(shots, "2026-11-05_attach-" + renderer + "-" + viewport + "_lab.png") });
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(draft).toHaveValue("Keep this draft while I inspect Attach.");
      expect(external).toEqual([]);
      expect(errors).toEqual([]);
      writeFileSync(test.info().outputPath("attach-record.json"), JSON.stringify({ renderer, viewport, width, height, browser: browser.version(), attachBox, glyphBox, styles, external, errors, providerCalls: 0 }, null, 2));
    });
  }
}
