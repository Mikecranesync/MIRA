/**
 * Render proof for the onboarding wizard "Train & approve" step (train-before-deploy).
 *
 * Auth: mint a next-auth JWE session cookie (Hub local-e2e recipe) signed with the
 * SAME AUTH_SECRET the server boots with (see playwright.onboarding-validate.config.ts)
 * so the (hub) middleware admits us — no real login.
 *
 * Data: wizard progress, the asset list, and the asset-agent status/Q&A are mocked
 * via page.route() so the screenshot is deterministic and needs no dev-DB seed.
 * The flow: wizard restores at "Review" → Create namespace → Upload manual (#1993)
 * → Try MIRA → Train & approve → pick an asset → AssetValidateTab (#1783) renders
 * the lifecycle.
 *
 * Captures desktop (1440×900) + mobile (412×915) into docs/promo-screenshots/.
 *
 * Run:
 *   cd mira-hub
 *   doppler run -p factorylm -c dev -- npx playwright test \
 *     --config playwright.onboarding-validate.config.ts
 */
import { test, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import * as path from "path";
import * as fs from "fs";

const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";
const TENANT_ID = "00000000-0000-0000-0000-0000000000cc";
const OUT = path.resolve(__dirname, "..", "..", "..", "docs", "promo-screenshots");
const DATE = "2026-06-08";

const ASSET_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// Wizard restored mid-flow at "review" with company/site/line already filled.
const WIZARD = {
  status: "in_progress",
  currentStep: "review",
  stepPayloads: {
    company: { name: "Harper Industries" },
    site: { name: "Lake Wales Plant", location: "Lake Wales, FL" },
    line: { name: "Sorting Line", description: "Sorts product by height before packaging" },
  },
};

const ASSETS = [
  { id: ASSET_ID, tag: "CONV-16", name: "Conveyor 16 — GS10 VFD" },
  { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", tag: "PMP-03", name: "Coolant Pump 3" },
];

// AssetValidateTab AgentStatus shape (src/components/AssetValidateTab.tsx).
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

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
});

async function mintCookie(context: import("@playwright/test").BrowserContext, baseURL: string) {
  const trialExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const token = await encode({
    token: {
      uid: "onboarding-e2e-user",
      tid: TENANT_ID,
      status: "trial",
      trialExpiresAt,
      email: "onboarding-e2e@factorylm-test.com",
    },
    secret: AUTH_SECRET,
  });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL }]);
}

test("onboarding wizard — Train & approve step renders the asset-agent lifecycle", async ({
  page,
  context,
  baseURL,
}) => {
  await mintCookie(context, baseURL!);

  // Deterministic data. Specific routes first so the bare asset-list glob can't shadow them.
  await page.route("**/api/assets/*/agent-status/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(AGENT_STATUS) }),
  );
  await page.route("**/api/assets/*/validation-qa/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(QA) }),
  );
  // Trailing slash required (#1976 routed client fetches through `${API_BASE}/api/assets/`).
  await page.route("**/api/assets/", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(ASSETS) }),
  );
  await page.route("**/api/wizard/**", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(WIZARD) });
  });

  // 1) Land on the wizard (restores at Review).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("step-review")).toBeVisible({ timeout: 15_000 });

  // 2) Create namespace → upload step (#1993) → Try MIRA → Train & approve.
  await page.getByTestId("onboarding-finish").click();
  // #1993 inserted an "upload" step between Review and Try. The wizard-finish
  // response is mocked empty, so lineNode stays null → UploadStep renders its
  // no-manual branch (step-upload + a Continue button) → Continue advances to Try.
  await expect(page.getByTestId("step-upload")).toBeVisible();
  await page.getByTestId("onboarding-upload-continue").click();
  await expect(page.getByTestId("step-try")).toBeVisible();
  await page.getByTestId("onboarding-train-approve").click();
  await expect(page.getByTestId("step-validate")).toBeVisible();

  // 3) Pick an asset → AssetValidateTab renders.
  await page.getByTestId("validate-asset-select").selectOption(ASSET_ID);
  await expect(page.getByTestId("validate-tab-host")).toBeVisible();
  await expect(page.getByText(/GS10 fault code oC/)).toBeVisible({ timeout: 15_000 });

  await page.screenshot({
    path: path.join(OUT, `${DATE}_onboarding-train-approve-step_desktop.png`),
    fullPage: true,
  });
  console.log(`📸 ${DATE}_onboarding-train-approve-step_desktop.png`);

  // 4) Mobile.
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(OUT, `${DATE}_onboarding-train-approve-step_mobile.png`),
    fullPage: true,
  });
  console.log(`📸 ${DATE}_onboarding-train-approve-step_mobile.png`);
});
