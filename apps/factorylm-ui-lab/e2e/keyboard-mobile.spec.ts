import { expect, test } from "playwright/test";

const MOBILE = { width: 412, height: 915 };

test.describe("mobile drawer, sheet, Back, and keyboard", () => {
  test.use({ viewport: MOBILE });

  test("Escape and the hardware Back event close the drawer opened at mount, then reach the host", async ({ page }) => {
    await page.goto("/?surface=mobile&theme=light&scenario=machine-ask");
    const shell = page.locator(".fl-shell");
    await expect(shell).toHaveAttribute("data-navigation-visible", "true");
    await page.keyboard.press("Escape");
    await expect(shell).toHaveAttribute("data-navigation-visible", "false");
    await expect(page.locator(".fl-scrim")).toHaveCount(0);

    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(shell).toHaveAttribute("data-navigation-visible", "true");
    await page.evaluate(() => document.dispatchEvent(new Event("factorylm:back", { bubbles: true, cancelable: true })));
    await expect(shell).toHaveAttribute("data-navigation-visible", "false");

    await page.evaluate(() => document.dispatchEvent(new Event("factorylm:back", { bubbles: true, cancelable: true })));
    await page.getByText("Adapter log (1)").click();
    await expect(page.getByRole("list", { name: "Adapter log" })).toContainText("onBack");
  });

  test("the drawer traps focus while open and returns it to the opener", async ({ page }) => {
    await page.goto("/?surface=mobile&theme=light&scenario=project-tree");
    await page.keyboard.press("Escape");
    const open = page.getByRole("button", { name: "Open navigation" });
    await open.focus();
    await open.click();
    const drawer = page.getByRole("complementary", { name: "FactoryLM navigation" });
    await expect(drawer.locator(":focus")).toHaveCount(1);
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      await expect(drawer.locator(":focus")).toHaveCount(1);
    }
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
  });

  test("a citation opens the modal source viewer as a bottom sheet and Escape returns focus", async ({ page }) => {
    await page.goto("/?surface=mobile&theme=light&scenario=grounded-answer");
    await page.keyboard.press("Escape");
    const citation = page.locator('button[data-part-type="source"]').first();
    await citation.focus();
    await citation.click();
    const viewer = page.getByRole("dialog", { name: "Source viewer" });
    await expect(viewer).toBeVisible();
    await expect(viewer).toHaveAttribute("aria-modal", "true");
    const box = await viewer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeGreaterThan(MOBILE.height - 2);
    await expect(viewer.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(citation).toBeFocused();
  });

  test("Enter sends, Shift+Enter keeps typing", async ({ page }) => {
    await page.goto("/?surface=mobile&theme=light&scenario=general-ask");
    await page.keyboard.press("Escape");
    const box = page.getByRole("textbox", { name: /ask mira/i });
    await box.fill("line one");
    await box.press("Shift+Enter");
    await box.type("line two");
    await expect(page.locator("[data-turn-id]")).toHaveCount(2);
    await expect(box).toHaveValue("line one\nline two");
    await box.press("Enter");
    await expect(page.locator("[data-turn-id]")).toHaveCount(3);
    await expect(box).toHaveValue("");
  });

  test("every visible control is at least 44 by 44 CSS pixels", async ({ page }) => {
    for (const scenario of ["machine-ask", "work-run", "attachments"]) {
      await page.goto(`/?surface=mobile&theme=light&scenario=${scenario}`);
      await page.keyboard.press("Escape");
      const small = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(".fl-shell button, .fl-shell textarea, .fl-shell summary"))) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (rect.width < 44 || rect.height < 44) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }
        return out;
      });
      expect(small, scenario).toEqual([]);
    }
  });

  test("the whole core flow is reachable by keyboard alone", async ({ page }) => {
    await page.goto("/?surface=mobile&theme=light&scenario=machine-ask");
    await page.keyboard.press("Escape");
    const names: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? `${el.tagName.toLowerCase()}:${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? ""}` : "";
      });
      names.push(name);
    }
    expect(names).toContain("button:Ask");
    expect(names).toContain("button:Work");
    expect(names.some((n) => n.startsWith("button:OEM"))).toBe(true);
    expect(names).toContain("textarea:Ask MIRA");
    expect(names).toContain("button:Add attachment");
  });
});
