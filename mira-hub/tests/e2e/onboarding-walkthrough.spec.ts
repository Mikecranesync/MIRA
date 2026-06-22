/**
 * Onboarding wizard WALKTHROUGH reel — Company → Site → Line → Review →
 * Try MIRA → Train & approve (asset picker → AssetValidateTab lifecycle).
 *
 * Auth: minted next-auth JWE (same AUTH_SECRET the server boots with). Data:
 * wizard / assets / agent-status / validation-qa mocked via page.route() so the
 * reel is deterministic and needs no dev-DB seed. Captures one desktop PNG per
 * step into docs/promo-screenshots/ (plus a mobile shot of the Train & approve
 * step).
 *
 * Run:
 *   cd mira-hub
 *   doppler run -p factorylm -c dev -- npx playwright test \
 *     --config playwright.onboarding-walkthrough.config.ts
 */
import { test, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import * as path from "path";
import * as fs from "fs";

const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";
const TENANT_ID = "00000000-0000-0000-0000-0000000000cc";
const OUT = path.resolve(__dirname, "..", "..", "..", "docs", "promo-screenshots");
const DATE = "2026-06-08";
const PREFIX = `${DATE}_onboarding-walkthrough`;

const ASSET_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ASSETS = [
  { id: ASSET_ID, tag: "CONV-16", name: "Conveyor 16 — GS10 VFD" },
  { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", tag: "PMP-03", name: "Coolant Pump 3" },
];
const AGENT_STATUS = {
  state: "validating",
  docCount: 3,
  validationQuestionCount: 2,
  approvedAnswerCount: 1,
  citationCoverage: 2,
  minGroundedness: 4,
  readyToApprove: false,
  approvalReasons: ["Need at least 5 validation questions with good verdicts (have 1)."],
};
const QA = [
  {
    id: "qa-1",
    question: "What does GS10 fault code oC mean?",
    miraAnswer: "oC = overcurrent. Check for a shorted output, mechanical jam, or too-fast accel ramp.",
    citations: [{ doc_id: "d1", page: 142, source_url: "gs10-manual.pdf" }],
    reviewerVerdict: "good",
  },
  {
    id: "qa-2",
    question: "How do I reset it?",
    miraAnswer: "Clear the fault input then cycle run. Confirm the cause first.",
    citations: [{ doc_id: "d1", page: 143, source_url: "gs10-manual.pdf" }],
    reviewerVerdict: null,
  },
];

let WIZARD_STEP = "company";
const WIZARD_PAYLOADS: Record<string, unknown> = {};

test.beforeAll(() => fs.mkdirSync(OUT, { recursive: true }));

test("onboarding walkthrough — full reel through Train & approve", async ({ page, context, baseURL }) => {
  const trialExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const token = await encode({
    token: { uid: "wk-user", tid: TENANT_ID, status: "trial", trialExpiresAt, email: "walkthrough@factorylm-test.com" },
    secret: AUTH_SECRET,
  });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL! }]);

  // Wizard GET reflects accumulating progress; POST records the step.
  await page.route("**/api/wizard/**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const step = req.url().split("/").pop()?.split("?")[0] ?? "";
      try {
        WIZARD_PAYLOADS[step] = req.postDataJSON();
      } catch {
        /* finish has empty body */
      }
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ status: "in_progress", currentStep: WIZARD_STEP, stepPayloads: WIZARD_PAYLOADS }),
    });
  });
  await page.route("**/api/assets/*/agent-status/**", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(AGENT_STATUS) }),
  );
  await page.route("**/api/assets/*/validation-qa/**", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(QA) }),
  );
  // Trailing slash required (#1976 routed client fetches through `${API_BASE}/api/assets/`).
  await page.route("**/api/assets/", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(ASSETS) }),
  );

  await page.setViewportSize({ width: 1440, height: 900 });

  const shot = async (n: string) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-${n}_desktop.png`), fullPage: true });
    console.log(`📸 ${PREFIX}-${n}_desktop.png`);
  };

  // 1) Company
  await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("step-company")).toBeVisible({ timeout: 15_000 });
  await shot("01-company");
  await page.getByTestId("input-company-name").fill("Harper Industries");
  await page.getByTestId("onboarding-next").click();

  // 2) Site
  await expect(page.getByTestId("step-site")).toBeVisible();
  await shot("02-site");
  await page.getByTestId("input-site-name").fill("Lake Wales Plant");
  await page.getByTestId("input-site-location").fill("Lake Wales, FL");
  await page.getByTestId("onboarding-next").click();

  // 3) Line
  await expect(page.getByTestId("step-line")).toBeVisible();
  await shot("03-line");
  await page.getByTestId("input-line-name").fill("Sorting Line");
  await page.getByTestId("input-line-description").fill("Sorts product by height before packaging");
  await page.getByTestId("onboarding-next").click();

  // 3b) Tag-import (optional, #2074) → skip to review
  await expect(page.getByTestId("step-tag-import")).toBeVisible();
  await page.getByTestId("tag-import-continue").click();

  // 4) Review
  await expect(page.getByTestId("step-review")).toBeVisible();
  await shot("04-review");
  await page.getByTestId("onboarding-finish").click();

  // 4b) Upload step (#1993, inserted between Review and Try). Wizard-finish is mocked
  // empty so lineNode is null → UploadStep's no-manual branch → Continue → Try.
  await expect(page.getByTestId("step-upload")).toBeVisible();
  await shot("04b-upload");
  await page.getByTestId("onboarding-upload-continue").click();

  // 5) Try MIRA
  await expect(page.getByTestId("step-try")).toBeVisible();
  await shot("05-try-mira");
  await page.getByTestId("onboarding-train-approve").click();

  // 6) Train & approve — pick asset → AssetValidateTab lifecycle
  await expect(page.getByTestId("step-validate")).toBeVisible();
  await shot("06-train-approve-pick");
  await page.getByTestId("validate-asset-select").selectOption(ASSET_ID);
  await expect(page.getByTestId("validate-tab-host")).toBeVisible();
  await expect(page.getByText(/GS10 fault code oC/)).toBeVisible({ timeout: 15_000 });
  await shot("07-train-approve-validating");

  // 8) Mobile shot of the Train & approve step.
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-07-train-approve-validating_mobile.png`), fullPage: true });
  console.log(`📸 ${PREFIX}-07-train-approve-validating_mobile.png`);
});
