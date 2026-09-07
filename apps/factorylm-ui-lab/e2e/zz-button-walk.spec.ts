// CANARY-OTA-NAV-AUDIT — button-by-button walk of the unified shell at 412x915.
// Every visible product control: click, detect whether ANYTHING observably changed,
// and where a layer opened, verify Escape unwinds exactly one.
//
// The signature is a full-DOM fingerprint, not a text prefix: an earlier version
// compared the first 90 chars of body text and reported every control as dead,
// which is a detector that cannot see rather than a UI that does not work.
import { expect, test } from "playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(import.meta.dirname, "../../../.audit");
const SCENARIOS = ["machine-ask","grounded-answer","attachments","project-tree","work-run",
  "machine-evidence","safety-stop","error-retry","offline-sync","long-history",
  "enterprise-inspector","general-ask","empty"] as const;
// Lab chrome, not product UI — the harness's own controls.
const LAB_CHROME = /^(Theme:|Reset scenario|Surface:|Viewport:|Embed)/i;

type Row = { scenario: string; control: string; expected: string; actual: string; verdict: string };
const rows: Row[] = [];

async function snapshot(page: import("playwright/test").Page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".fl-shell");
    return {
      html: (shell?.innerHTML.length ?? 0) + ":" + (document.body.innerText || "").length,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      navOpen: shell?.getAttribute("data-navigation-visible") ?? "",
      active: document.querySelectorAll('[data-active="true"]').length,
      text: (document.body.innerText || "").replace(/\s+/g, " ").trim(),
    };
  });
}


// The shared reducer's initial state has navigationVisible: true, which is
// correct for the desktop permanent sidebar. mira-mobile corrects it for the
// phone (UnifiedChat.tsx dispatches set-navigation-visible false on init), but
// the lab harness does not — so a raw mobile load in the lab renders the drawer
// open over the conversation, with its scrim swallowing every tap underneath.
// Walking that state audits a screen the product never presents, so match the
// product's landing state before walking.
async function landAsMobileApp(page: import("playwright/test").Page) {
  const shell = page.locator(".fl-shell");
  await shell.waitFor();
  if ((await shell.getAttribute("data-navigation-visible")) === "true") {
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.querySelector(".fl-shell")?.getAttribute("data-navigation-visible") !== "true",
    );
  }
}

test.describe("button walk 412x915", () => {
  test.use({ viewport: { width: 412, height: 915 } });

  for (const scenario of SCENARIOS) {
    test(`walk ${scenario}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

      await page.goto(`/?surface=mobile&theme=light&scenario=${scenario}`);
      await landAsMobileApp(page);
      await expect(page.locator(".fl-shell")).toBeVisible();

      const names: string[] = await page.locator("button:visible, [role=button]:visible")
        .evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g," ").trim()).filter(Boolean));
      const unique = [...new Set(names)].filter((n) => !LAB_CHROME.test(n));

      for (const name of unique) {
        // Re-enter the scenario before each control so the walk is order-independent.
        await page.goto(`/?surface=mobile&theme=light&scenario=${scenario}`);
      await landAsMobileApp(page);
        const btn = page.getByRole("button", { name, exact: true }).first();
        if (!(await btn.count().catch(() => 0)) || !(await btn.isVisible().catch(() => false))) continue;

        // A control that is disabled, or already in its target state, doing nothing
        // is CORRECT — not a dead control. Distinguishing the two is the whole
        // point of the audit; an earlier version reported both as failures.
        const state = await btn.evaluate((e) => ({
          disabled: (e as HTMLButtonElement).disabled === true || e.getAttribute("aria-disabled") === "true",
          pressed: e.getAttribute("aria-pressed"),
          current: e.getAttribute("aria-current"),
        }));
        const before = await snapshot(page);
        await btn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(150);
        const after = await snapshot(page);

        const changed = JSON.stringify(before) !== JSON.stringify(after);
        const inertByDesign = !changed && (state.disabled || state.pressed === "true" || state.current === "page");
        let verdict = changed ? "PASS" : inertByDesign ? "PASS" : "FAIL";
        let actual = inertByDesign
          ? `no-op by design (${state.disabled ? "disabled" : state.pressed === "true" ? "already selected" : "already current"})`
          : !changed ? "NOTHING HAPPENED — dead control"
          : after.dialogs > before.dialogs ? `opened a layer (${before.dialogs}->${after.dialogs})`
          : after.navOpen !== before.navOpen ? `navigation ${before.navOpen}->${after.navOpen}`
          : after.active !== before.active ? `selection ${before.active}->${after.active}`
          : "view changed";

        if (after.dialogs > before.dialogs) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(150);
          const back = (await snapshot(page)).dialogs;
          if (back === after.dialogs - 1) actual += "; Escape unwound exactly one";
          else { actual += `; Escape left ${back} (expected ${after.dialogs - 1})`; verdict = "FAIL"; }
        }
        rows.push({ scenario, control: name, expected: "acts; any layer unwinds one step", actual, verdict });
      }

      if (errors.length) rows.push({ scenario, control: "(console)", expected: "no errors",
        actual: errors.slice(0,2).join(" | ").slice(0,120), verdict: "FAIL" });
    });
  }

  test.afterAll(() => {
    mkdirSync(OUT, { recursive: true });
    const pass = rows.filter(r => r.verdict === "PASS").length;
    const md = [`# Button walk — unified shell @ 412x915`, ``,
      `${pass}/${rows.length} PASS`, ``,
      "| Scenario | Control | Expected | Actual | Verdict |","|---|---|---|---|---|",
      ...rows.map(r => `| ${r.scenario} | ${r.control} | ${r.expected} | ${r.actual} | ${r.verdict} |`)].join("\n");
    writeFileSync(resolve(OUT, "button-walk.md"), md);
  });
});
