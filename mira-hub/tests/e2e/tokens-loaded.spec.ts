/**
 * #3707 — are ANY FactoryLM design tokens defined at runtime on a rendered Hub page?
 *
 * `.claude/rules/ui-style.md` rule 1 says every colour comes from a `--fl-*`
 * token. A component can obey that rule perfectly and still render unstyled if
 * the surface never loads a tokens stylesheet — `var(--fl-x)` with no
 * definition resolves to nothing, and no static review can see it. This is the
 * check that can: it walks the live document's stylesheets and counts the
 * `--fl-*` custom properties actually declared.
 *
 * Name-agnostic on purpose: mira-web's served `/_tokens.css` and the canonical
 * `docs/design/factorylm-tokens.css` do not share every name (a keyed probe on
 * `--fl-accent` failed on BOTH surfaces while writing this), so the question
 * asked is "does this page define the token family at all", which is the
 * defect #3707 describes.
 *
 * mira-web is the positive control (it links `/_tokens.css`), so a green
 * control + red Hub means "the Hub is the surface that fell through", not
 * "the probe cannot see tokens".
 *
 * Deliberately NOT wired into a workflow: a live-target check cannot validate
 * a pre-deploy fix, so blocking/non-blocking placement is the fix PR's call.
 * Run by hand:
 *   HUB_URL=https://app.factorylm.com WEB_URL=https://factorylm.com \
 *     npx playwright test tests/e2e/tokens-loaded.spec.ts --reporter=list
 */
import { expect, test, type Page } from "@playwright/test";

// HUB_URL may be the origin or the /hub-prefixed base the other e2e workflows pass;
// normalise to the origin so the login URL is built once, correctly.
const HUB = (process.env.HUB_URL ?? "https://app.factorylm.com").replace(/\/$/, "").replace(/\/hub$/, "");
const WEB = (process.env.WEB_URL ?? "https://factorylm.com").replace(/\/$/, "");

/** Every `--fl-*` custom property declared in any readable stylesheet on the page. */
async function definedTokens(page: Page, url: string): Promise<string[]> {
  const res = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  expect(res?.status(), `${url} did not render`).toBeLessThan(400);
  return page.evaluate(() => {
    const names = new Set<string>();
    const visit = (rules: CSSRuleList | undefined) => {
      if (!rules) return;
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            if (prop.startsWith("--fl-")) names.add(prop);
          }
        } else if ("cssRules" in rule) {
          visit((rule as CSSGroupingRule).cssRules); // @media / @supports / @layer
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        visit(sheet.cssRules);
      } catch {
        /* cross-origin sheet: unreadable, skipped — same-origin token sheets are readable */
      }
    }
    return Array.from(names).sort();
  });
}

test("positive control — mira-web defines the --fl-* family at runtime", async ({ page }) => {
  const names = await definedTokens(page, `${WEB}/`);
  expect(names.length, `--fl-* tokens declared on ${WEB}/`).toBeGreaterThan(0);
});

test("Hub login page defines the --fl-* family at runtime (#3707)", async ({ page }) => {
  const names = await definedTokens(page, `${HUB}/hub/login`);
  expect(
    names.length,
    `no --fl-* token is declared on ${HUB}/hub/login — the Hub never loads a tokens ` +
      "stylesheet, so every var(--fl-*) in V3 resolves to nothing (#3707)",
  ).toBeGreaterThan(0);
});
