import { expect, test } from "playwright/test";

for (const thread of ["classic", "assistant"] as const) {
  for (const [name, viewport, surface] of [
    ["desktop", { width: 1280, height: 900 }, "hub"],
    ["portrait phone", { width: 390, height: 844 }, "hub"],
    ["landscape phone", { width: 844, height: 390 }, "hub"],
  ] as const) {
    test(`${thread}: ${name} reaches chat with the first Tab and preserves navigation`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.goto(`/?surface=${surface}&theme=light&scenario=grounded-answer&thread=${thread}&embed=1`);
      const shell = page.locator(".fl-shell");
      const box = page.getByRole("textbox", { name: "Ask MIRA", exact: true });
      if (viewport.width < 768) {
        await page.keyboard.press("Escape");
        await expect(shell).toHaveAttribute("data-navigation-visible", "false");
        await expect(page.locator(".fl-shell__sidebar")).not.toBeInViewport();
      }
      await expect(box).not.toBeFocused();
      const skip = page.getByRole("button", { name: "Skip to chat", exact: true });
      await expect(skip).toBeEnabled();
      await page.keyboard.press("Tab");
      await expect(skip).toBeFocused();
      const bounds = await skip.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({ path: testInfo.outputPath("skip-focused.png") });
      await page.keyboard.press("Enter");
      await expect(box).toBeFocused();
      await expect(box).toBeInViewport();

      const draft = "  Keep my question\nwith exact spacing  ";
      await box.fill(draft);
      const url = page.url();
      const context = await page.locator(".fl-conversation__crumbs").textContent();
      await skip.focus();
      await page.evaluate(() => {
        for (const element of document.querySelectorAll<HTMLElement>(".fl-shell__nav-scroll, .fl-conversation, .fl-thread__viewport")) {
          element.scrollTop = 100;
        }
      });
      const before = await page.evaluate(() => [
        document.scrollingElement!.scrollTop,
        ...Array.from(document.querySelectorAll<HTMLElement>(".fl-shell__nav-scroll, .fl-conversation, .fl-thread__viewport"), (element) => element.scrollTop),
      ]);
      await page.keyboard.press("Enter");
      await expect(box).toBeFocused();
      await expect(box).toHaveValue(draft);
      expect(page.url()).toBe(url);
      await expect(page.locator(".fl-conversation__crumbs")).toHaveText(context!);
      expect(await page.evaluate(() => [
        document.scrollingElement!.scrollTop,
        ...Array.from(document.querySelectorAll<HTMLElement>(".fl-shell__nav-scroll, .fl-conversation, .fl-thread__viewport"), (element) => element.scrollTop),
      ])).toEqual(before);

      // Ordinary navigation remains a keyboard action after using the bypass.
      if (viewport.width < 768) {
        await page.getByRole("button", { name: "Open navigation", exact: true }).focus();
        await page.keyboard.press("Enter");
      }
      const project = page.locator('button[data-project-id="project-launch-2"]');
      await project.focus();
      await expect(project).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(shell).toHaveAttribute("data-navigation-visible", "false");
    });
  }
}
