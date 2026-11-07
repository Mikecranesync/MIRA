import { expect, test } from "playwright/test";
import { writeFileSync } from "node:fs";

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
      await page.screenshot({ path: test.info().outputPath("attach-" + renderer + "-" + viewport + "_lab.png") });
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(draft).toHaveValue("Keep this draft while I inspect Attach.");
      expect(external).toEqual([]);
      expect(errors).toEqual([]);
      writeFileSync(test.info().outputPath("attach-record.json"), JSON.stringify({ renderer, viewport, width, height, browser: browser.version(), attachBox, glyphBox, styles, external, errors, providerCalls: 0 }, null, 2));
    });
  }
}


for (const renderer of ["classic", "assistant"] as const) {
  for (const [kind, width, height, rootSize] of [
    ["desktop", 1280, 900, 16], ["desktop", 1920, 1080, 16],
    ["desktop", 1280, 900, 14], ["desktop", 1920, 1080, 14],
    ["portrait", 390, 844, 16], ["landscape", 844, 390, 16],
  ] as const) {
    test(`${renderer} attachment anchoring ${kind} ${width}x${height} at ${rootSize}px (#4938)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/?surface=hub&theme=light&scenario=grounded-answer&embed=1&thread=${renderer}`);
      await page.evaluate(size => {
        document.documentElement.style.fontSize = `${size}px`;
        document.body.style.fontSize = `${size}px`;
      }, rootSize);
      if (width < 768) {
        await page.getByRole("button", { name: "Close navigation", exact: true }).click();
        await page.waitForFunction(() => document.querySelector<HTMLElement>(".fl-shell__sidebar")!.getBoundingClientRect().right <= 0);
      }
      const draft = page.getByRole("textbox", { name: "Ask MIRA", exact: true });
      const text = "  Preserve my attachment question\nand its spacing  ";
      await draft.fill(text);
      const attach = page.getByRole("button", { name: "Add attachment", exact: true });
      await attach.click();
      const menu = page.getByRole("dialog", { name: "Attachment menu", exact: true });
      await expect(menu).toBeVisible();
      // Capture the initial state before scrolling any option into view.
      const geometry = await menu.evaluate(element => {
        const composer = element.closest<HTMLElement>(".fl-composer")!;
        const row = composer.querySelector<HTMLElement>(".fl-composer__row")!;
        const attach = composer.querySelector<HTMLElement>('[aria-label="Add attachment"]')!;
        const inset = getComputedStyle(composer), rowStyle = getComputedStyle(row), menuStyle = getComputedStyle(element);
        const rect = composer.getBoundingClientRect();
        return {
          menu: element.getBoundingClientRect().toJSON(), attach: attach.getBoundingClientRect().toJSON(),
          composer: rect.toJSON(), row: row.getBoundingClientRect().toJSON(),
          header: element.querySelector(".fl-attachment-menu__head")!.getBoundingClientRect().toJSON(),
          close: element.querySelector('[aria-label="Close attachment menu"]')!.getBoundingClientRect().toJSON(),
          menuPosition: menuStyle.position,
          menuInsets: { inlineStart: menuStyle.insetInlineStart, inlineEnd: menuStyle.insetInlineEnd, left: menuStyle.left, right: menuStyle.right },
          composerTransform: inset.transform, bodyTransform: getComputedStyle(document.body).transform,
          htmlTransform: getComputedStyle(document.documentElement).transform,
          containingBlock: (element as HTMLElement).offsetParent?.className ?? null,
          composerPaddingStart: inset.paddingInlineStart, composerPaddingEnd: inset.paddingInlineEnd,
          contentEdge: rect.left + parseFloat(inset.borderLeftWidth) + parseFloat(inset.paddingLeft),
          rowInset: parseFloat(rowStyle.paddingLeft) + parseFloat(rowStyle.borderLeftWidth),
          rootFontSize: getComputedStyle(document.documentElement).fontSize,
          bodyFontSize: getComputedStyle(document.body).fontSize,
        };
      });
      const record: Record<string, unknown> = { renderer, kind, viewportWidth: width, viewportHeight: height, rootSize, geometry };
      writeFileSync(test.info().outputPath("anchor-geometry.json"), JSON.stringify(record, null, 2));
      await page.screenshot({ path: test.info().outputPath("attachment-initial.png") });
      if (kind === "desktop") {
        const attachGap = Math.abs(geometry.menu.x - geometry.attach.x);
        const contentGap = Math.abs(geometry.menu.x - geometry.contentEdge);
        expect.soft(attachGap <= geometry.rowInset + 1 || contentGap <= 1,
          `initial menu x=${geometry.menu.x}, Attach x=${geometry.attach.x}, content edge=${geometry.contentEdge}; containing block=${geometry.containingBlock}`).toBe(true);
      } else if (kind === "portrait") {
        expect.soft(geometry.menuPosition).toBe("fixed");
        // The baseline sheet has a measured 16px left gutter; its full-width
        // discrepancy is separate from the desktop anchoring acceptance.
        expect.soft(geometry.menu.x).toBeGreaterThanOrEqual(0);
        expect.soft(geometry.menu.right).toBeLessThanOrEqual(width);
        expect.soft(Math.abs(geometry.menu.bottom - height)).toBeLessThanOrEqual(1);
      }
      // Landscape geometry above is an observation, not a new sheet-height gate.
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(attach).toBeFocused();
      await expect(draft).toHaveValue(text);
      if (kind !== "landscape") {
        await attach.click();
        await menu.getByRole("button", { name: "File", exact: true }).click();
        await expect(menu).toBeHidden();
        await expect(draft).toHaveValue(text);
        const pending = page.getByRole("list", { name: "Pending attachments" });
        await expect(pending).toContainText("g120-manual.pdf");
        const remove = pending.getByRole("button", { name: "Remove g120-manual.pdf", exact: true });
        record.pendingRemoveTarget = await remove.boundingBox();
        writeFileSync(test.info().outputPath("anchor-geometry.json"), JSON.stringify(record, null, 2));
        await page.screenshot({ path: test.info().outputPath("attachment-selected.png") });
      }
    });
  }
}
