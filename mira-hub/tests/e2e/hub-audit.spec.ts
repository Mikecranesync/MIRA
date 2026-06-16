/**
 * Full interactive audit of app.factorylm.com/hub
 * Tests every page, button, modal, and flow. Screenshots everything.
 * Broken states are screenshotted and logged — tests don't fail-fast.
 */

import { test, expect, Page, Browser } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com/hub";
const OUT = path.join("test-results", "hub-audit");
const REPORT: { page: string; status: "pass" | "warn" | "fail"; notes: string[] }[] = [];

fs.mkdirSync(OUT, { recursive: true });

const CREDS = { email: "playwright@factorylm.com", password: "TestPass123" };

// ─── Helpers ────────────────────────────────────────────────────────────────

async function shot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }).catch(() => {});
  console.log(`📸 ${name}.png`);
}

async function login(page: Page) {
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', CREDS.email);
  await page.fill('input[type="password"]', CREDS.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/hub\/feed\/?/, { timeout: 25_000 });
}

async function goTo(page: Page, route: string) {
  await page.goto(`${HUB}/${route}`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1500);
}

function report(pageName: string, status: "pass" | "warn" | "fail", ...notes: string[]) {
  REPORT.push({ page: pageName, status, notes });
  const icon = status === "pass" ? "✅" : status === "warn" ? "⚠️" : "❌";
  console.log(`${icon} [${pageName}] ${notes.join(" | ")}`);
}

// ─── Setup ──────────────────────────────────────────────────────────────────

test.beforeAll(async ({ request }) => {
  const res = await request.post(`${HUB}/api/auth/register/`, {
    data: { email: CREDS.email, password: CREDS.password, name: "Playwright Audit" },
  });
  console.log(`test user: ${res.status()} (201=created, 409=exists)`);
});

test.afterAll(async () => {
  console.log("\n════════════════════════════════════════");
  console.log("           HUB AUDIT REPORT             ");
  console.log("════════════════════════════════════════");
  for (const r of REPORT) {
    const icon = r.status === "pass" ? "✅" : r.status === "warn" ? "⚠️" : "❌";
    console.log(`${icon} ${r.page}`);
    for (const n of r.notes) console.log(`   ${n}`);
  }
  const failing = REPORT.filter(r => r.status === "fail").length;
  const warning = REPORT.filter(r => r.status === "warn").length;
  console.log(`\nTotal: ${REPORT.length} pages | ${failing} broken | ${warning} warnings`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. EVENT LOG
// ═══════════════════════════════════════════════════════════════════════════
test("1. event-log — load, filters, row click", async ({ page }) => {
  await login(page);
  await goTo(page, "event-log");
  await shot(page, "1a-event-log-loaded");

  // Check page loaded
  const hasError = await page.locator('text="Error"').isVisible().catch(() => false);
  const hasContent = await page.locator('[class*="event"], tr, [data-testid*="event"], table').first().isVisible().catch(() => false);
  const bodyText = await page.locator("body").innerText().catch(() => "");

  if (hasError) {
    report("event-log", "fail", "Error state visible on load");
  } else {
    report("event-log", hasContent ? "pass" : "warn",
      hasContent ? "Page loaded with content" : "Page loaded but no event rows found",
    );
  }

  // Try filter buttons
  const filterBtns = page.locator('button, [role="tab"]').filter({ hasText: /filter|all|safety|diagnostic/i });
  const filterCount = await filterBtns.count();
  if (filterCount > 0) {
    await filterBtns.first().click().catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, "1b-event-log-filter-clicked");
    report("event-log-filters", "pass", `${filterCount} filter options found, clicked first`);
  } else {
    report("event-log-filters", "warn", "No filter buttons found");
  }

  // Try clicking a row
  const rows = page.locator('tr:not(:first-child), [data-testid*="event-row"], [class*="cursor-pointer"]').filter({ hasText: /.+/ });
  const rowCount = await rows.count();
  if (rowCount > 0) {
    await rows.first().click().catch(() => {});
    await page.waitForTimeout(1000);
    const drawer = await page.locator('[role="dialog"], [class*="drawer"], [class*="panel"], [class*="sheet"]').isVisible().catch(() => false);
    await shot(page, "1c-event-log-row-clicked");
    report("event-log-detail", drawer ? "pass" : "warn",
      drawer ? "Detail drawer opened on row click" : `Row clicked but no drawer appeared (${rowCount} rows found)`,
    );
  } else {
    report("event-log-detail", "warn", "No clickable rows found to test detail drawer");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CONVERSATIONS
// ═══════════════════════════════════════════════════════════════════════════
test("2. conversations — load and data check", async ({ page }) => {
  await login(page);
  await goTo(page, "conversations");
  await shot(page, "2a-conversations-loaded");

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const hasError = bodyText.includes("Error") && !bodyText.includes("error rate");
  const hasConversations = await page.locator('[class*="conversation"], li, tr').count().then(n => n > 0).catch(() => false);
  const hasEmptyState = bodyText.match(/no conversations|empty|no data/i);

  if (hasError) {
    report("conversations", "fail", "Error state visible", `URL: ${page.url()}`);
  } else if (hasConversations) {
    report("conversations", "pass", "Conversations loaded with items");
  } else if (hasEmptyState) {
    report("conversations", "warn", "Empty state — no conversation data");
  } else {
    report("conversations", "warn", "Page loaded but content unclear", `URL: ${page.url()}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. ACTIONS
// ═══════════════════════════════════════════════════════════════════════════
test("3. actions — load check", async ({ page }) => {
  await login(page);
  await goTo(page, "actions");
  await shot(page, "3a-actions-loaded");

  const url = page.url();
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const hasError = bodyText.match(/error|not found|404/i);
  const redirectedAway = !url.includes("/actions");

  if (redirectedAway) {
    report("actions", "fail", `Redirected away — landed on ${url}`);
  } else if (hasError) {
    report("actions", "fail", "Error state on /actions page");
  } else {
    report("actions", "pass", "Actions page loads without error");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. ALERTS
// ═══════════════════════════════════════════════════════════════════════════
test("4. alerts — load check", async ({ page }) => {
  await login(page);
  await goTo(page, "alerts");
  await shot(page, "4a-alerts-loaded");

  const url = page.url();
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const redirectedAway = !url.includes("/alerts");

  if (redirectedAway) {
    report("alerts", "fail", `Redirected away — landed on ${url}`);
  } else {
    const hasContent = await page.locator("main, [class*='card'], table, li").count().then(n => n > 0).catch(() => false);
    report("alerts", hasContent ? "pass" : "warn",
      hasContent ? "Alerts page loads with content" : "Alerts page loads but appears empty",
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. KNOWLEDGE
// ═══════════════════════════════════════════════════════════════════════════
test("5. knowledge — load, data count, row click", async ({ page }) => {
  await login(page);
  await goTo(page, "knowledge");
  await shot(page, "5a-knowledge-loaded");

  // Count items
  const items = page.locator('[class*="card"], tr:not(:first-child), [class*="document"], [class*="chunk"]');
  const itemCount = await items.count().catch(() => 0);

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const hasRealCount = bodyText.match(/\d+ (document|chunk|item|result)/i);

  report("knowledge", itemCount > 0 ? "pass" : "warn",
    itemCount > 0 ? `${itemCount} knowledge items rendered` : "No knowledge items visible",
    hasRealCount ? `Count text: "${hasRealCount[0]}"` : "No count text found",
  );

  // Try clicking a document
  if (itemCount > 0) {
    await items.first().click().catch(() => {});
    await page.waitForTimeout(1000);
    const detail = await page.locator('[role="dialog"], [class*="drawer"], [class*="detail"]').isVisible().catch(() => false);
    await shot(page, "5b-knowledge-item-clicked");
    report("knowledge-detail", detail ? "pass" : "warn",
      detail ? "Detail opened on knowledge item click" : "Item clicked but no detail panel appeared",
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. ASSETS — full flow
// ═══════════════════════════════════════════════════════════════════════════
test("6a. assets — grid load", async ({ page }) => {
  await login(page);
  await goTo(page, "assets");
  await page.waitForTimeout(2000);
  await shot(page, "6a-assets-grid");

  const cards = page.locator('[class*="asset"], [class*="card"], a[href*="/assets/"]');
  const cardCount = await cards.count().catch(() => 0);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const countMatch = bodyText.match(/(\d+)\s*(asset|equipment|machine)/i);

  report("assets-grid", cardCount > 0 ? "pass" : "warn",
    cardCount > 0 ? `${cardCount} asset items rendered` : "No asset cards found",
    countMatch ? `Count text: "${countMatch[0]}"` : "",
  );
});

test("6b. assets — New Asset modal", async ({ page }) => {
  await login(page);
  await goTo(page, "assets");
  await page.waitForTimeout(2000);

  // Find and click the New Asset button
  const newBtn = page.locator('button').filter({ hasText: /new asset|\+/i }).first();
  const fabBtn = page.locator('button[aria-label*="asset" i], [class*="fab"]').first();

  let clicked = false;
  if (await newBtn.isVisible().catch(() => false)) {
    await newBtn.click();
    clicked = true;
  } else if (await fabBtn.isVisible().catch(() => false)) {
    await fabBtn.click();
    clicked = true;
  }

  await page.waitForTimeout(1000);
  await shot(page, "6b-assets-new-modal");

  const modal = page.locator('[role="dialog"], [class*="modal"], [class*="sheet"]');
  const modalVisible = await modal.isVisible().catch(() => false);

  if (!clicked) {
    report("assets-new-modal", "fail", "Could not find New Asset button to click");
  } else if (modalVisible) {
    report("assets-new-modal", "pass", "New Asset modal opened");

    // Try filling and submitting
    const nameField = modal.locator('input[name*="name" i], input[placeholder*="name" i]').first();
    if (await nameField.isVisible().catch(() => false)) {
      await nameField.fill("Playwright Test Asset");

      // Fill other required fields if visible
      const typeField = modal.locator('input[name*="type" i], select[name*="type" i]').first();
      if (await typeField.isVisible().catch(() => false)) {
        await typeField.fill("Test Equipment");
      }

      await shot(page, "6b2-assets-modal-filled");

      const submitBtn = modal.locator('button[type="submit"], button').filter({ hasText: /create|save|submit/i }).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
        await shot(page, "6b3-assets-after-submit");

        const stillOpen = await modal.isVisible().catch(() => false);
        const successToast = await page.locator('[class*="toast"], [role="alert"]').filter({ hasText: /success|created/i }).isVisible().catch(() => false);

        report("assets-create", stillOpen && !successToast ? "fail" : "pass",
          stillOpen && !successToast ? "Modal still open after submit — possible error" : "Asset created or modal closed",
        );
      } else {
        report("assets-create", "warn", "No submit button found in modal");
      }
    } else {
      report("assets-create", "warn", "Modal open but no name field found");
    }
  } else {
    report("assets-new-modal", "fail", "New Asset button clicked but no modal appeared");
  }
});

test("6c. assets — detail page and tabs", async ({ page }) => {
  await login(page);
  await goTo(page, "assets");
  await page.waitForTimeout(2000);

  // Click first asset
  const assetLink = page.locator('a[href*="/assets/"]').first();
  const assetCount = await assetLink.count().catch(() => 0);

  if (assetCount === 0) {
    report("assets-detail", "fail", "No asset links found to click for detail page");
    await shot(page, "6c-assets-no-items");
    return;
  }

  await assetLink.click();
  await page.waitForURL(/\/assets\//, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, "6c-assets-detail-loaded");

  report("assets-detail", "pass", `Detail page loaded: ${page.url()}`);

  // Test tabs
  const tabs = page.locator('[role="tab"], [class*="tab"]').filter({ hasText: /.+/ });
  const tabCount = await tabs.count().catch(() => 0);
  report("assets-tabs", "pass", `${tabCount} tabs found`);

  for (let i = 0; i < Math.min(tabCount, 5); i++) {
    const tab = tabs.nth(i);
    const tabText = await tab.innerText().catch(() => `Tab ${i}`);
    await tab.click().catch(() => {});
    await page.waitForTimeout(700);
    await shot(page, `6c-tab-${i + 1}-${tabText.replace(/\s+/g, "-").toLowerCase()}`);
    console.log(`  Tab ${i + 1}: "${tabText}" clicked`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. CHANNELS — Google connect
// ═══════════════════════════════════════════════════════════════════════════
test("7. channels — load and connect buttons", async ({ page }) => {
  await login(page);
  await goTo(page, "channels");
  await shot(page, "7a-channels-loaded");

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const hasContent = await page.locator('[class*="channel"], [class*="card"], li').count().then(n => n > 0).catch(() => false);

  report("channels", hasContent ? "pass" : "warn",
    hasContent ? "Channels page loads with content" : "Channels page appears empty",
  );

  // Find connect buttons
  const connectBtns = page.locator('button, a').filter({ hasText: /connect/i });
  const connectCount = await connectBtns.count().catch(() => 0);
  report("channels-connect-buttons", connectCount > 0 ? "pass" : "warn",
    `${connectCount} connect buttons found`,
  );

  // Click "Connect Google" specifically
  const googleBtn = connectBtns.filter({ hasText: /google/i }).first();
  const hasGoogleBtn = await googleBtn.isVisible().catch(() => false);

  if (hasGoogleBtn) {
    // Intercept navigation
    let redirectUrl = "";
    page.on("request", req => {
      if (req.url().includes("google") || req.url().includes("oauth") || req.url().includes("accounts")) {
        redirectUrl = req.url();
      }
    });

    await googleBtn.click();
    await page.waitForTimeout(2000);
    await shot(page, "7b-channels-google-clicked");

    const newUrl = page.url();
    const errorVisible = await page.locator('text="Error", [class*="error"]').isVisible().catch(() => false);

    if (errorVisible) {
      report("channels-google-connect", "fail", `Error shown after Google connect click`, `URL: ${newUrl}`);
    } else if (newUrl.includes("google") || redirectUrl.includes("google")) {
      report("channels-google-connect", "pass", `Redirects to Google OAuth: ${redirectUrl || newUrl}`);
    } else if (newUrl.includes("/hub/channels")) {
      report("channels-google-connect", "warn", `Still on channels page after click — no redirect occurred`, `URL: ${newUrl}`);
    } else {
      report("channels-google-connect", "warn", `Unexpected redirect: ${newUrl}`);
    }
  } else {
    // Try first connect button
    if (connectCount > 0) {
      await connectBtns.first().click().catch(() => {});
      await page.waitForTimeout(1500);
      await shot(page, "7b-channels-first-connect-clicked");
      const newUrl = page.url();
      report("channels-first-connect", "warn", `No Google button found; clicked first connect btn`, `Now at: ${newUrl}`);
    } else {
      report("channels-google-connect", "warn", "No connect buttons found on channels page");
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. DOCUMENTS / UPLOAD
// ═══════════════════════════════════════════════════════════════════════════
test("8. documents — upload flow", async ({ page }) => {
  await login(page);
  await goTo(page, "documents");
  await shot(page, "8a-documents-loaded");

  const url = page.url();
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const redirectedAway = !url.includes("/documents");

  if (redirectedAway) {
    report("documents", "fail", `Redirected away from /documents — landed on ${url}`);
    return;
  }

  // Look for upload button
  const uploadBtn = page.locator('button, label[for], input[type="file"]').filter({ hasText: /upload|import|add document/i }).first();
  const fileInput = page.locator('input[type="file"]').first();
  const hasUpload = await uploadBtn.isVisible().catch(() => false);
  const hasFileInput = await fileInput.isVisible().catch(() => false);

  report("documents", "pass", `Documents page loads at ${url}`);

  if (hasUpload || hasFileInput) {
    report("documents-upload", "pass", "Upload mechanism found");
    await uploadBtn.click().catch(() => {});
    await page.waitForTimeout(1000);
    await shot(page, "8b-documents-upload-clicked");
  } else {
    // Check for Drive link or other upload mechanism
    const driveLink = page.locator('a, button').filter({ hasText: /drive|google|import/i }).first();
    const hasDrive = await driveLink.isVisible().catch(() => false);
    if (hasDrive) {
      report("documents-upload", "warn", "Google Drive link found but no direct upload input");
      await driveLink.click().catch(() => {});
      await page.waitForTimeout(1000);
      await shot(page, "8b-documents-drive-clicked");
    } else {
      report("documents-upload", "warn", "No upload button or file input found on documents page");
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. WORK ORDERS — full 3-step flow
// ═══════════════════════════════════════════════════════════════════════════
test("9. workorders — list and new work order flow", async ({ page }) => {
  await login(page);
  await goTo(page, "workorders");
  await page.waitForTimeout(2000);
  await shot(page, "9a-workorders-list");

  const items = page.locator('[class*="card"], tr:not(:first-child), [class*="work-order"]');
  const itemCount = await items.count().catch(() => 0);
  report("workorders-list", itemCount > 0 ? "pass" : "warn",
    itemCount > 0 ? `${itemCount} work orders visible` : "No work order items visible",
  );

  // Click New Work Order
  const newBtn = page.locator('button').filter({ hasText: /new work order|create/i }).first();
  const hasNewBtn = await newBtn.isVisible().catch(() => false);

  if (!hasNewBtn) {
    report("workorders-new", "fail", "No 'New Work Order' button found");
    return;
  }

  await newBtn.click();
  await page.waitForTimeout(1000);
  await shot(page, "9b-workorders-step1");

  const modal = page.locator('[role="dialog"], [class*="modal"], [class*="sheet"]');
  const modalVisible = await modal.isVisible().catch(() => false);

  if (!modalVisible) {
    report("workorders-new-modal", "fail", "New Work Order button clicked but no modal appeared");
    return;
  }

  report("workorders-new-modal", "pass", "New Work Order modal/dialog opened");

  // Step 1 — fill title/description
  const titleField = modal.locator('input[name*="title" i], input[placeholder*="title" i], input').first();
  if (await titleField.isVisible().catch(() => false)) {
    await titleField.fill("Playwright Test WO");
  }

  // Look for Next / Step buttons
  const nextBtn = modal.locator('button').filter({ hasText: /next|continue/i }).first();
  if (await nextBtn.isVisible().catch(() => false)) {
    await nextBtn.click();
    await page.waitForTimeout(800);
    await shot(page, "9c-workorders-step2");
    report("workorders-step2", "pass", "Reached step 2");

    const nextBtn2 = modal.locator('button').filter({ hasText: /next|continue/i }).first();
    if (await nextBtn2.isVisible().catch(() => false)) {
      await nextBtn2.click();
      await page.waitForTimeout(800);
      await shot(page, "9d-workorders-step3");
      report("workorders-step3", "pass", "Reached step 3");
    }
  } else {
    // Single-step modal
    await shot(page, "9c-workorders-single-step");
    const submitBtn = modal.locator('button[type="submit"], button').filter({ hasText: /create|save|submit/i }).first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(1500);
      await shot(page, "9d-workorders-after-submit");
      const stillOpen = await modal.isVisible().catch(() => false);
      report("workorders-submit", stillOpen ? "warn" : "pass",
        stillOpen ? "Modal still open after submit" : "Work order submitted",
      );
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════
test("10. integrations — load check", async ({ page }) => {
  await login(page);
  await goTo(page, "integrations");
  await shot(page, "10a-integrations-loaded");

  const url = page.url();
  const redirectedAway = !url.includes("/integrations");
  if (redirectedAway) {
    report("integrations", "fail", `Redirected to ${url}`);
    return;
  }

  const cards = page.locator('[class*="card"], [class*="integration"], li');
  const cardCount = await cards.count().catch(() => 0);
  const bodyText = await page.locator("body").innerText().catch(() => "");

  report("integrations", cardCount > 0 ? "pass" : "warn",
    cardCount > 0 ? `${cardCount} integration items` : "Page loads but no integration cards visible",
    `Content preview: ${bodyText.slice(0, 100).replace(/\n/g, " ")}`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. USAGE
// ═══════════════════════════════════════════════════════════════════════════
test("11. usage — real data check", async ({ page }) => {
  await login(page);
  await goTo(page, "usage");
  await page.waitForTimeout(2000);
  await shot(page, "11a-usage-loaded");

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const hasPercent = bodyText.match(/\d+%/);
  const hasNumbers = bodyText.match(/\d{2,}/g);
  const loadingVisible = await page.locator('text="Loading"').isVisible().catch(() => false);

  report("usage", !loadingVisible && hasNumbers ? "pass" : "warn",
    hasPercent ? `Progress meter found: ${hasPercent[0]}` : "No percentage found",
    hasNumbers ? `Numbers visible: ${hasNumbers?.slice(0, 3).join(", ")}` : "No numeric data visible",
    loadingVisible ? "Still showing loading state" : "",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. TEAM
// ═══════════════════════════════════════════════════════════════════════════
test("12. team — load check", async ({ page }) => {
  await login(page);
  await goTo(page, "team");
  await shot(page, "12a-team-loaded");

  const url = page.url();
  const redirectedAway = !url.includes("/team");
  if (redirectedAway) {
    report("team", "fail", `Redirected to ${url}`);
    return;
  }

  const members = page.locator('[class*="member"], [class*="user"], [class*="card"], tr:not(:first-child)');
  const count = await members.count().catch(() => 0);
  const bodyText = await page.locator("body").innerText().catch(() => "");

  report("team", count > 0 ? "pass" : "warn",
    count > 0 ? `${count} team member items visible` : "No team member items visible",
    `Content: ${bodyText.slice(0, 80).replace(/\n/g, " ")}`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. DARK MODE TOGGLE
// ═══════════════════════════════════════════════════════════════════════════
test("13. dark mode toggle", async ({ page }) => {
  await login(page);
  await goTo(page, "feed");

  // Find theme toggle
  const toggle = page.locator('button[aria-label*="theme" i], button[aria-label*="dark" i], button[title*="dark" i], button[title*="theme" i]').first();
  const moreMenu = page.locator('a[href*="more"], button').filter({ hasText: /more/i }).first();

  let toggleFound = await toggle.isVisible().catch(() => false);

  // Check sidebar bottom for theme toggle
  if (!toggleFound) {
    const sidebarToggles = page.locator('aside button, nav button').filter({ hasText: /dark|light|theme/i });
    toggleFound = await sidebarToggles.count().then(n => n > 0).catch(() => false);
    if (toggleFound) {
      await sidebarToggles.first().click().catch(() => {});
    }
  }

  // Try /more page which may have settings
  if (!toggleFound) {
    await goTo(page, "more");
    await shot(page, "13a-more-page");
    const themeBtn = page.locator('button, [role="switch"]').filter({ hasText: /dark|light|theme/i }).first();
    toggleFound = await themeBtn.isVisible().catch(() => false);
    if (toggleFound) {
      await themeBtn.click();
      await page.waitForTimeout(800);
    }
  }

  const isDark = await page.locator('[class*="dark"], [data-theme="dark"]').count().then(n => n > 0).catch(() => false);
  const bodyClass = await page.locator("html, body").getAttribute("class").catch(() => "");
  const bodyTheme = await page.locator("html").getAttribute("data-theme").catch(() => "");

  await shot(page, "13b-dark-mode-state");

  report("dark-mode-toggle", toggleFound ? "pass" : "warn",
    toggleFound ? "Dark mode toggle found and clicked" : "Dark mode toggle not found",
    `html class: "${bodyClass}" data-theme: "${bodyTheme}"`,
    isDark ? "Dark mode CSS class detected" : "No dark mode class detected",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. LANGUAGE SELECTOR
// ═══════════════════════════════════════════════════════════════════════════
test("14. language selector", async ({ page }) => {
  await login(page);
  await goTo(page, "more");
  await shot(page, "14a-more-for-language");

  // Find language selector
  const langBtn = page.locator('button, [role="combobox"]').filter({ hasText: /english|español|language|flag|🇺🇸|🇪🇸/i }).first();
  const flagBtns = page.locator('button').filter({ hasText: /🇺🇸|🇪🇸|🇫🇷|🇩🇪|en|es|fr|de/i });

  let langFound = await langBtn.isVisible().catch(() => false);
  if (!langFound) {
    langFound = await flagBtns.count().then(n => n > 0).catch(() => false);
  }

  if (langFound) {
    const btn = langFound ? (await langBtn.isVisible().catch(() => false) ? langBtn : flagBtns.first()) : langBtn;
    await btn.click().catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, "14b-language-dropdown-open");

    // Look for Spanish option
    const esOption = page.locator('[role="option"], li, button').filter({ hasText: /español|spanish|es/i }).first();
    const hasEs = await esOption.isVisible().catch(() => false);

    if (hasEs) {
      await esOption.click().catch(() => {});
      await page.waitForTimeout(1500);
      await shot(page, "14c-language-spanish-selected");
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const hasSpanish = bodyText.match(/configuración|ajustes|inicio|bienvenido/i);
      report("language-selector", hasSpanish ? "pass" : "warn",
        hasSpanish ? "UI changed to Spanish" : "Spanish selected but UI text unchanged",
      );
    } else {
      report("language-selector", "warn", "Language selector opened but no Spanish option found");
    }
  } else {
    // Try feed page
    await goTo(page, "feed");
    const langBtnFeed = page.locator('button').filter({ hasText: /🇺🇸|🇬🇧|en|language/i }).first();
    const foundOnFeed = await langBtnFeed.isVisible().catch(() => false);
    await shot(page, "14b-feed-for-language");
    report("language-selector", "warn",
      langFound ? "Language selector found but interaction incomplete" : "Language selector not found on more or feed page",
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. MOBILE VIEWPORT — bottom tabs + FAB
// ═══════════════════════════════════════════════════════════════════════════
test("15. mobile — bottom tabs and FAB", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();

  // Login
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', CREDS.email);
  await page.fill('input[type="password"]', CREDS.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/hub\/feed\/?/, { timeout: 25_000 });
  await page.waitForTimeout(1000);
  await shot(page, "15a-mobile-feed");

  // Find bottom nav tabs
  const bottomNav = page.locator('nav, [class*="bottom"], [class*="tab-bar"]').filter({ hasNotText: /sidebar/i });
  const tabs = page.locator('a[href*="/hub/"], nav a').filter({ visible: true });
  const tabCount = await tabs.count().catch(() => 0);

  report("mobile-bottom-nav", tabCount > 0 ? "pass" : "warn",
    tabCount > 0 ? `${tabCount} nav tabs visible on mobile` : "No bottom nav tabs found",
  );

  // Click each visible tab
  const tabNames = ["event-log", "conversations", "knowledge", "assets", "channels"];
  for (const tabName of tabNames) {
    const tabLink = page.locator(`a[href*="${tabName}"]`).filter({ visible: true }).first();
    const tabVisible = await tabLink.isVisible().catch(() => false);
    if (tabVisible) {
      await tabLink.click().catch(() => {});
      await page.waitForTimeout(1000);
      await shot(page, `15b-mobile-${tabName}`);
      console.log(`  Mobile tab "${tabName}" clicked`);
    }
  }

  // FAB on assets
  await page.goto(`${HUB}/assets`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const fab = page.locator('button[aria-label*="asset" i], button[class*="fab"], [class*="floating"]').first();
  const fabVisible = await fab.isVisible().catch(() => false);
  await shot(page, "15c-mobile-assets-fab");

  report("mobile-fab", fabVisible ? "pass" : "warn",
    fabVisible ? "Mobile FAB visible on assets page" : "Mobile FAB not found",
  );

  if (fabVisible) {
    await fab.click().catch(() => {});
    await page.waitForTimeout(1000);
    await shot(page, "15d-mobile-fab-clicked");
    const modal = await page.locator('[role="dialog"], [class*="sheet"]').isVisible().catch(() => false);
    report("mobile-fab-action", modal ? "pass" : "warn",
      modal ? "FAB opens modal/sheet" : "FAB clicked but nothing appeared",
    );
  }

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// BONUS: Feed page KPIs
// ═══════════════════════════════════════════════════════════════════════════
test("0. feed — KPIs and data", async ({ page }) => {
  await login(page);
  await goTo(page, "feed");
  await page.waitForTimeout(2000);
  await shot(page, "0a-feed-desktop");

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const kpiValues = bodyText.match(/\d+\.?\d*[h%]?/g);
  const hasKPIs = kpiValues && kpiValues.length > 3;

  report("feed", "pass", hasKPIs ? `KPI values visible: ${kpiValues?.slice(0, 5).join(", ")}` : "Feed loaded");
});
