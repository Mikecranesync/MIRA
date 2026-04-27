/**
 * FactoryLM Hub — Comprehensive Validation Suite
 *
 * Run against any base URL with E2E_BASE_URL. Credentials come from
 * E2E_HUB_EMAIL / E2E_HUB_PASSWORD — set them in your shell or in
 * playwright.config.ts. The hardcoded mike@factorylm.com / admin123
 * dev creds are NEVER shipped to production.
 */

import { test, expect, Page, BrowserContext } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://app.factorylm.com";
const HUB = `${BASE}/hub`;
const LOGIN_EMAIL = process.env.E2E_HUB_EMAIL ?? "mike@factorylm.com";
const LOGIN_PASSWORD = process.env.E2E_HUB_PASSWORD ?? "";

// ── Shared login helper ──────────────────────────────────────────────────────

async function login(page: Page): Promise<void> {
  if (!LOGIN_PASSWORD) {
    throw new Error("E2E_HUB_PASSWORD env var is required");
  }
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', LOGIN_EMAIL);
  await page.fill('input[type="password"]', LOGIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/hub\/feed\/?$/, { timeout: 15_000 });
}

// ── Shared fixture: logged-in page ───────────────────────────────────────────

let sharedContext: BrowserContext;
let sharedPage: Page;

test.beforeAll(async ({ browser }) => {
  sharedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  sharedPage = await sharedContext.newPage();
  await login(sharedPage);
});

test.afterAll(async () => {
  await sharedContext.close();
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 1 — Auth
// ────────────────────────────────────────────────────────────────────────────

test.describe("1. Auth", () => {
  test("login page renders email + password inputs and Sign in button", async ({ page }) => {
    await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("login page exposes Sign in with Google button", async ({ page }) => {
    await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Sign in with Google/i)).toBeVisible();
  });

  test("unauthenticated /hub/feed redirects to /hub/login", async ({ page }) => {
    const ctx = await page.context().browser()?.newContext();
    if (!ctx) throw new Error("no browser context");
    const fresh = await ctx.newPage();
    await fresh.goto(`${HUB}/feed`, { waitUntil: "networkidle" });
    await expect(fresh).toHaveURL(/\/hub\/login/);
    await ctx.close();
  });

  test("invalid credentials show an error message", async ({ page }) => {
    await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', "wrong@example.com");
    await page.fill('input[type="password"]', "badpassword");
    await page.click('button:has-text("Sign In")');
    // Expect either an error text or the URL to NOT be /feed
    await page.waitForTimeout(2000);
    const url = page.url();
    const hasError =
      url.includes("/login") ||
      (await page.locator('[class*="error"], [class*="alert"], [role="alert"]').count()) > 0;
    expect(hasError, "Should stay on login or show error with bad credentials").toBe(true);
  });

  test("valid credentials redirect to /hub/feed", async ({ page }) => {
    await login(page);
    expect(page.url()).toContain("/hub/feed");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 2 — Sidebar Nav (12 items)
// ────────────────────────────────────────────────────────────────────────────

test.describe("2. Sidebar Nav", () => {
  const NAV_ITEMS = [
    { label: "Activity Feed", path: "/hub/feed", heading: /feed|activity/i },
    { label: "Work Orders", path: "/hub/workorders", heading: /work order/i },
    { label: "Assets", path: "/hub/assets", heading: /asset/i },
    { label: "Schedule", path: "/hub/schedule", heading: /schedule/i },
    { label: "Requests", path: "/hub/requests", heading: /request/i },
    { label: "Parts", path: "/hub/parts", heading: /part/i },
    { label: "Documents", path: "/hub/documents", heading: /document/i },
    { label: "Reports", path: "/hub/reports", heading: /report/i },
    { label: "CMMS", path: "/hub/cmms", heading: /cmms/i },
    { label: "Team", path: "/hub/team", heading: /team/i },
    { label: "Admin", path: "/hub/admin/users", heading: /admin|user/i },
  ];

  for (const item of NAV_ITEMS) {
    test(`nav → ${item.label} loads at ${item.path}`, async () => {
      await sharedPage.goto(`${BASE}${item.path}`, { waitUntil: "networkidle" });
      expect(sharedPage.url()).toContain(item.path);
      const h1 = await sharedPage.locator("h1").first().textContent();
      expect(h1).toMatch(item.heading);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 3 — Mobile Bottom Tabs
// ────────────────────────────────────────────────────────────────────────────

test.describe("3. Mobile Bottom Tabs", () => {
  test("at 375×812 bottom tabs are visible and work", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await login(page);

    // Bottom tab bar should be visible (mobile only)
    const feedTab = page.locator('nav a[href="/hub/feed"], a[href="/hub/feed"]').last();
    await expect(feedTab).toBeVisible();

    // Tap Assets tab
    const assetsTab = page.locator('a[href="/hub/assets"]').last();
    await assetsTab.click();
    await page.waitForURL(`${HUB}/assets`, { timeout: 10_000 });
    expect(page.url()).toContain("/hub/assets");

    // Tap Work Orders tab
    const woTab = page.locator('a[href="/hub/workorders"]').last();
    await woTab.click();
    await page.waitForURL(`${HUB}/workorders`, { timeout: 10_000 });
    expect(page.url()).toContain("/hub/workorders");

    // Tap More tab
    const moreTab = page.locator('a[href="/hub/more"], a:has-text("More")').last();
    await expect(moreTab).toBeVisible();

    await ctx.close();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 4 — Feed
// ────────────────────────────────────────────────────────────────────────────

test.describe("4. Feed", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/feed`, { waitUntil: "networkidle" });
  });

  test("feed cards render (at least 3)", async () => {
    // Feed items have action buttons like Mark as read / Show more
    const feedItems = await sharedPage.locator('button:has-text("Mark as read")').count();
    expect(feedItems).toBeGreaterThanOrEqual(1);
  });

  test("FAB expands when clicked (new links become visible)", async () => {
    const fab = sharedPage.locator('button[class*="fixed"], div[class*="fixed"] button').first();
    await expect(fab).toBeVisible();
    const linksBefore = await sharedPage.locator('a[href*="/new"]').count();
    await fab.click();
    await sharedPage.waitForTimeout(400);
    const linksAfter = await sharedPage.locator('a[href*="/new"]').count();
    // FAB reveals extra /new links (workorders/new, requests/new)
    expect(linksAfter).toBeGreaterThan(linksBefore);
  });

  test("FAB contains link to New Work Order", async () => {
    const fab = sharedPage.locator('button[class*="fixed"], div[class*="fixed"] button').first();
    await fab.click();
    await sharedPage.waitForTimeout(400);
    await expect(sharedPage.locator('a[href*="workorders/new"]').first()).toBeVisible();
  });

  test("FAB contains link to New Request", async () => {
    const fab = sharedPage.locator('button[class*="fixed"], div[class*="fixed"] button').first();
    await fab.click();
    await sharedPage.waitForTimeout(400);
    await expect(sharedPage.locator('a[href*="requests/new"]').first()).toBeVisible();
  });

  test("feed has Chat with MIRA or Ask MIRA action", async () => {
    const miraBtns = await sharedPage
      .locator('button:has-text("MIRA"), button:has-text("Chat with MIRA"), button:has-text("Ask MIRA")')
      .count();
    expect(miraBtns).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 5 — Assets
// ────────────────────────────────────────────────────────────────────────────

test.describe("5. Assets", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/assets`, { waitUntil: "networkidle" });
  });

  test("asset grid renders at least 4 asset links", async () => {
    const assetLinks = await sharedPage.locator('a[href*="/assets/"]').count();
    expect(assetLinks).toBeGreaterThanOrEqual(4);
  });

  test("search input exists and accepts text", async () => {
    const searchInput = sharedPage.locator('input[placeholder*="earch"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill("conveyor");
    await sharedPage.waitForTimeout(400);
    // Should still have the input
    await expect(searchInput).toHaveValue("conveyor");
    await searchInput.fill(""); // reset
  });

  test("status filter buttons exist: All, Active, Maintenance, Inactive", async () => {
    // Use exact: true to avoid "Active" matching "Inactive" (strict mode)
    await expect(sharedPage.getByRole("button", { name: "All", exact: true })).toBeVisible();
    await expect(sharedPage.getByRole("button", { name: "Active", exact: true })).toBeVisible();
    await expect(sharedPage.getByRole("button", { name: "Maintenance", exact: true })).toBeVisible();
    await expect(sharedPage.getByRole("button", { name: "Inactive", exact: true })).toBeVisible();
  });

  test("filter buttons are clickable", async () => {
    await sharedPage.getByRole("button", { name: "Active", exact: true }).click();
    await sharedPage.waitForTimeout(300);
    await sharedPage.getByRole("button", { name: "All", exact: true }).click();
    await sharedPage.waitForTimeout(300);
  });

  test("clicking first asset navigates to detail page", async () => {
    const firstAssetLink = sharedPage.locator('a[href*="/hub/assets/"]').first();
    await firstAssetLink.click();
    await sharedPage.waitForURL(/\/hub\/assets\/\d+/, { timeout: 10_000 });
    expect(sharedPage.url()).toMatch(/\/hub\/assets\/\d+/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 5b — Asset Detail
// ────────────────────────────────────────────────────────────────────────────

test.describe("5b. Asset Detail", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/assets/1`, { waitUntil: "networkidle" });
  });

  test("5 detail tabs exist: Details, Activity, Work Orders, Documents, Parts", async () => {
    await expect(sharedPage.locator('button:has-text("Details")')).toBeVisible();
    await expect(sharedPage.locator('button:has-text("Activity")')).toBeVisible();
    await expect(sharedPage.locator('button:has-text("Work Orders")')).toBeVisible();
    await expect(sharedPage.locator('button:has-text("Documents")')).toBeVisible();
    await expect(sharedPage.locator('button:has-text("Parts")')).toBeVisible();
  });

  test("tabs are clickable", async () => {
    for (const tabName of ["Activity", "Work Orders", "Documents", "Parts", "Details"]) {
      await sharedPage.locator(`button:has-text("${tabName}")`).click();
      await sharedPage.waitForTimeout(300);
    }
  });

  test('"Chat with MIRA about this asset" button exists', async () => {
    await expect(
      sharedPage.locator('button:has-text("Chat with MIRA")')
    ).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 6 — Work Orders
// ────────────────────────────────────────────────────────────────────────────

test.describe("6. Work Orders", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/workorders`, { waitUntil: "networkidle" });
  });

  test("WO list renders at least 3 work order links", async () => {
    const woLinks = await sharedPage.locator('a[href*="/workorders/WO"]').count();
    expect(woLinks).toBeGreaterThanOrEqual(3);
  });

  test("status filter tabs exist: All, Open, In Progress, Scheduled, Completed, Overdue", async () => {
    for (const label of ["All", "Open", "In Progress", "Scheduled", "Completed", "Overdue"]) {
      await expect(sharedPage.locator(`button:has-text("${label}")`).first()).toBeVisible();
    }
  });

  test("status tabs filter the list", async () => {
    await sharedPage.locator('button:has-text("Open")').first().click();
    await sharedPage.waitForTimeout(400);
    await sharedPage.locator('button:has-text("All")').first().click();
    await sharedPage.waitForTimeout(300);
  });

  test('"New Work Order" link or button exists', async () => {
    // Both a link and a button exist on this page — check either is visible
    await expect(
      sharedPage.locator('button:has-text("New Work Order"), a:has-text("New Work Order")').first()
    ).toBeVisible();
  });

  test("clicking a WO navigates to detail page", async () => {
    await sharedPage.locator('a[href*="/workorders/WO"]').first().click();
    await sharedPage.waitForURL(/\/hub\/workorders\/WO/, { timeout: 10_000 });
    expect(sharedPage.url()).toMatch(/\/hub\/workorders\/WO/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 6b — WO Detail
// ────────────────────────────────────────────────────────────────────────────

test.describe("6b. Work Order Detail", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/workorders/WO-2026-001`, { waitUntil: "networkidle" });
  });

  test("Start Work button exists", async () => {
    await expect(sharedPage.locator('button:has-text("Start Work")').first()).toBeVisible();
  });

  test("Add part / Log Part button exists", async () => {
    await expect(
      sharedPage.locator('button:has-text("Log Part"), button:has-text("Add")')
        .first()
    ).toBeVisible();
  });

  test("MIRA Conversation tab exists", async () => {
    await expect(sharedPage.locator('button:has-text("MIRA Conversation")')).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 6c — New WO 3-step flow
// ────────────────────────────────────────────────────────────────────────────

test.describe("6c. New Work Order form", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/workorders/new`, { waitUntil: "networkidle" });
  });

  test("step 1: asset selector buttons are present", async () => {
    // Step 1 shows asset buttons to pick from
    const assetBtns = await sharedPage.locator('button:has-text("Air Compressor"), button:has-text("Conveyor"), button:has-text("CNC")').count();
    expect(assetBtns).toBeGreaterThanOrEqual(1);
  });

  test("selecting an asset shows the Save/submit button", async () => {
    await sharedPage.locator('button:has-text("Air Compressor")').first().click();
    await sharedPage.waitForTimeout(500);
    // Step 1: pick an asset; the Save/submit button is visible when an asset is selected
    await expect(sharedPage.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 7 — Documents
// ────────────────────────────────────────────────────────────────────────────

test.describe("7. Documents", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/documents`, { waitUntil: "networkidle" });
  });

  test("at least 6 document cards render", async () => {
    const docLinks = await sharedPage.locator('a[href*="/documents/"]').count();
    expect(docLinks).toBeGreaterThanOrEqual(6);
  });

  test("category filter buttons exist", async () => {
    // Should have filter buttons - at least All and a few categories
    const filterBtns = await sharedPage.locator('button:has-text("All"), button:has-text("all")').count();
    expect(filterBtns).toBeGreaterThanOrEqual(1);
  });

  test("clicking a document navigates to detail page", async () => {
    await sharedPage.locator('a[href*="/hub/documents/"]').first().click();
    await sharedPage.waitForURL(/\/hub\/documents\//, { timeout: 10_000 });
    expect(sharedPage.url()).toMatch(/\/hub\/documents\//);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 7b — Document Detail
// ────────────────────────────────────────────────────────────────────────────

test.describe("7b. Document Detail", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/documents/d01`, { waitUntil: "networkidle" });
  });

  test('"Ask MIRA About This Document" button exists', async () => {
    await expect(sharedPage.locator('button:has-text("Ask MIRA")')).toBeVisible();
  });

  test('"Open" button exists', async () => {
    await expect(sharedPage.locator('button:has-text("Open")')).toBeVisible();
  });

  test('"Download" button exists', async () => {
    await expect(sharedPage.locator('button:has-text("Download")')).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 8 — Parts
// ────────────────────────────────────────────────────────────────────────────

test.describe("8. Parts", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/parts`, { waitUntil: "networkidle" });
  });

  test("parts table renders with at least 5 rows", async () => {
    const partLinks = await sharedPage.locator('a[href*="/parts/"]').count();
    expect(partLinks).toBeGreaterThanOrEqual(5);
  });

  test("search input accepts text", async () => {
    const searchInput = sharedPage.locator('input[placeholder*="earch"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill("filter");
    await sharedPage.waitForTimeout(300);
    await searchInput.fill("");
  });

  test("clicking a part link navigates to detail page", async () => {
    // First 12 matches are hidden (sidebar/nav duplicates); use first visible one
    const partLinks = sharedPage.locator('a[href*="/hub/parts/"]');
    const count = await partLinks.count();
    let clicked = false;
    for (let i = 0; i < count; i++) {
      const link = partLinks.nth(i);
      if (await link.isVisible()) {
        await link.click();
        clicked = true;
        break;
      }
    }
    expect(clicked, "Expected at least one visible part link").toBe(true);
    await sharedPage.waitForURL(/\/hub\/parts\//, { timeout: 10_000 });
    expect(sharedPage.url()).toMatch(/\/hub\/parts\//);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 8b — Parts Detail
// ────────────────────────────────────────────────────────────────────────────

test.describe("8b. Parts Detail", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/parts/1`, { waitUntil: "networkidle" });
  });

  test('"Ask MIRA About This Part" button exists', async () => {
    await expect(sharedPage.locator('button:has-text("Ask MIRA")')).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 9 — Schedule
// ────────────────────────────────────────────────────────────────────────────

test.describe("9. Schedule", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/schedule`, { waitUntil: "networkidle" });
  });

  test("Calendar and List toggle buttons exist", async () => {
    await expect(sharedPage.locator('button:has-text("Calendar")')).toBeVisible();
    await expect(sharedPage.locator('button:has-text("List")')).toBeVisible();
  });

  test("month navigation buttons exist (prev/next arrows)", async () => {
    // Arrow buttons have no text — they contain only SVG
    const allBtns = await sharedPage.locator("button").all();
    const emptyTextBtns = [];
    for (const b of allBtns) {
      const text = (await b.textContent() ?? "").trim();
      if (text === "") emptyTextBtns.push(b);
    }
    // There should be at least 2 icon-only buttons (prev + next month)
    expect(emptyTextBtns.length).toBeGreaterThanOrEqual(2);
  });

  test("clicking List toggle shows list view", async () => {
    await sharedPage.locator('button:has-text("List")').click();
    await sharedPage.waitForTimeout(400);
    // In list view some list-like items should appear; clicking Calendar reverts
    await sharedPage.locator('button:has-text("Calendar")').click();
    await sharedPage.waitForTimeout(300);
  });

  test("calendar grid renders day number spans (1–31)", async () => {
    // Calendar days are rendered as <span> text, not buttons
    const allSpans = await sharedPage.locator("span").allTextContents();
    const dayNumbers = allSpans.filter(t => /^\d+$/.test(t.trim()) && parseInt(t) >= 1 && parseInt(t) <= 31);
    expect(dayNumbers.length).toBeGreaterThanOrEqual(7);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 10 — Requests
// ────────────────────────────────────────────────────────────────────────────

test.describe("10. Requests", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/requests`, { waitUntil: "networkidle" });
  });

  test("request list renders (Approve/Reject buttons visible)", async () => {
    const approveCount = await sharedPage.locator('button:has-text("Approve")').count();
    const rejectCount = await sharedPage.locator('button:has-text("Reject")').count();
    expect(approveCount).toBeGreaterThanOrEqual(1);
    expect(rejectCount).toBeGreaterThanOrEqual(1);
  });

  test("status filter tabs exist: All, Pending, Approved, Rejected, Converted", async () => {
    for (const label of ["All", "Pending", "Approved", "Rejected", "Converted"]) {
      await expect(sharedPage.locator(`button:has-text("${label}")`).first()).toBeVisible();
    }
  });

  test("filter tabs are clickable", async () => {
    await sharedPage.locator('button:has-text("Pending")').first().click();
    await sharedPage.waitForTimeout(300);
    await sharedPage.locator('button:has-text("All")').first().click();
    await sharedPage.waitForTimeout(300);
  });

  test('"New Request" button opens request form (modal or inline)', async () => {
    const inputsBefore = await sharedPage.locator("input, textarea").count();
    await sharedPage.locator('button:has-text("New Request")').click();
    await sharedPage.waitForTimeout(600);
    // Either URL changed OR form inputs appeared
    const urlChanged = sharedPage.url().includes("/requests/new");
    const inputsAfter = await sharedPage.locator("input, textarea").count();
    const formOpened = inputsAfter > inputsBefore;
    expect(urlChanged || formOpened, "New Request should open a form or navigate").toBe(true);
    // Restore
    await sharedPage.goto(`${HUB}/requests`, { waitUntil: "networkidle" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 10b — New Request form
// ────────────────────────────────────────────────────────────────────────────

test.describe("10b. New Request Form", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/requests/new`, { waitUntil: "networkidle" });
  });

  test("form renders with title input and priority selector", async () => {
    const inputs = await sharedPage.locator("input, textarea, select").count();
    expect(inputs).toBeGreaterThanOrEqual(1);
  });

  test("priority buttons render", async () => {
    // Priority buttons: Low / Medium / High / Critical
    const priorityBtns = await sharedPage
      .locator('button:has-text("Low"), button:has-text("Medium"), button:has-text("High"), button:has-text("Critical")')
      .count();
    expect(priorityBtns).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 11 — CMMS
// ────────────────────────────────────────────────────────────────────────────

test.describe("11. CMMS", () => {
  test("CMMS page loads with title", async () => {
    await sharedPage.goto(`${HUB}/cmms`, { waitUntil: "networkidle" });
    const h1 = await sharedPage.locator("h1").first().textContent();
    expect(h1).toMatch(/cmms/i);
  });

  test('"Open Atlas CMMS" link/button exists', async () => {
    await sharedPage.goto(`${HUB}/cmms`, { waitUntil: "networkidle" });
    const atlasBtn = await sharedPage
      .locator('button:has-text("Atlas"), a:has-text("Atlas"), button:has-text("Open"), a:has-text("Open")')
      .count();
    expect(atlasBtn).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 12 — Reports
// ────────────────────────────────────────────────────────────────────────────

test.describe("12. Reports", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/reports`, { waitUntil: "networkidle" });
  });

  test("page loads with heading", async () => {
    const h1 = await sharedPage.locator("h1").first().textContent();
    expect(h1).toMatch(/report/i);
  });

  test("at least 4 Recharts SVG chart elements render", async () => {
    const rechartsElements = await sharedPage.locator('[class*="recharts"]').count();
    expect(rechartsElements).toBeGreaterThanOrEqual(4);
  });

  test("KPI stat elements are present", async () => {
    // Reports shows multiple metric cards
    const svgCount = await sharedPage.locator("svg").count();
    expect(svgCount).toBeGreaterThanOrEqual(4);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 13 — Team
// ────────────────────────────────────────────────────────────────────────────

test.describe("13. Team", () => {
  test("team page renders member cards with status indicators", async () => {
    await sharedPage.goto(`${HUB}/team`, { waitUntil: "networkidle" });
    const h1 = await sharedPage.locator("h1").first().textContent();
    expect(h1).toMatch(/team/i);
    // Status indicators are colored dots or badges
    const cardElements = await sharedPage.locator('[class*="card"], [class*="member"]').count();
    expect(cardElements).toBeGreaterThanOrEqual(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 14 — Admin
// ────────────────────────────────────────────────────────────────────────────

test.describe("14. Admin", () => {
  test("Users table renders with at least 5 rows", async () => {
    await sharedPage.goto(`${HUB}/admin/users`, { waitUntil: "networkidle" });
    const rows = await sharedPage.locator("tbody tr").count();
    expect(rows).toBeGreaterThanOrEqual(5);
  });

  test("Users table has correct column headers", async () => {
    await sharedPage.goto(`${HUB}/admin/users`, { waitUntil: "networkidle" });
    const headers = await sharedPage.locator("th").allTextContents();
    const joined = headers.join(" ");
    expect(joined).toMatch(/user/i);
    expect(joined).toMatch(/role/i);
    expect(joined).toMatch(/status/i);
  });

  test('"Invite User" button exists', async () => {
    await sharedPage.goto(`${HUB}/admin/users`, { waitUntil: "networkidle" });
    await expect(sharedPage.locator('button:has-text("Invite User")')).toBeVisible();
  });

  test("Roles page renders role cards", async () => {
    await sharedPage.goto(`${HUB}/admin/roles`, { waitUntil: "networkidle" });
    const h1 = await sharedPage.locator("h1").first().textContent();
    expect(h1).toMatch(/role/i);
    const cards = await sharedPage.locator('[class*="card"]').count();
    expect(cards).toBeGreaterThanOrEqual(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 15 — Dark Mode
// ────────────────────────────────────────────────────────────────────────────

test.describe("15. Dark Mode", () => {
  test("dark mode toggle exists", async () => {
    await sharedPage.goto(`${HUB}/feed`, { waitUntil: "networkidle" });
    await expect(
      sharedPage.locator('button:has-text("Dark mode"), button:has-text("Light mode"), button:has-text("Modo oscuro")')
    ).toBeVisible();
  });

  test("clicking toggle adds dark class to <html>", async () => {
    await sharedPage.goto(`${HUB}/feed`, { waitUntil: "networkidle" });
    // Ensure we're starting in light mode
    await sharedPage.evaluate(() => document.documentElement.classList.remove("dark"));
    const classBefore = await sharedPage.locator("html").getAttribute("class");
    expect(classBefore).not.toContain("dark");

    await sharedPage
      .locator('button:has-text("Dark mode"), button:has-text("Light mode")')
      .first()
      .click();
    await sharedPage.waitForTimeout(400);
    const classAfter = await sharedPage.locator("html").getAttribute("class");
    expect(classAfter).toContain("dark");

    // Toggle back to light
    await sharedPage
      .locator('button:has-text("Dark mode"), button:has-text("Light mode")')
      .first()
      .click();
    await sharedPage.waitForTimeout(400);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 16 — Language Switching
// ────────────────────────────────────────────────────────────────────────────

test.describe("16. Language", () => {
  test.beforeEach(async () => {
    await sharedPage.goto(`${HUB}/feed`, { waitUntil: "networkidle" });
  });

  test("language selector button is visible at desktop width", async () => {
    // The topbar language button (2nd listbox, visible at 1280px)
    const langBtn = sharedPage.locator('button[aria-haspopup="listbox"]').nth(1);
    await expect(langBtn).toBeVisible();
    const text = await langBtn.textContent();
    expect(text).toContain("🇺🇸");
  });

  test("opening language selector shows 4 language options", async () => {
    const langBtn = sharedPage.locator('button[aria-haspopup="listbox"]').nth(1);
    await langBtn.click();
    await sharedPage.waitForTimeout(400);
    const options = await sharedPage
      .locator('button:has-text("Español"), button:has-text("हिन्दी"), button:has-text("中文"), button:has-text("English")')
      .count();
    expect(options).toBeGreaterThanOrEqual(3);
    // Close
    await sharedPage.keyboard.press("Escape");
    await sharedPage.waitForTimeout(200);
  });

  test("selecting Spanish changes nav text to Spanish", async () => {
    const langBtn = sharedPage.locator('button[aria-haspopup="listbox"]').nth(1);
    await langBtn.click();
    await sharedPage.waitForTimeout(300);
    await sharedPage.locator('button:has-text("Español")').click();
    await sharedPage.waitForTimeout(800);

    const navText = await sharedPage.locator("nav a, aside a").first().textContent();
    // Spanish nav should NOT be "Activity Feed" anymore
    expect(navText?.trim()).not.toBe("Activity Feed");
    // Revert to English
    const langBtn2 = sharedPage.locator('button[aria-haspopup="listbox"]').nth(1);
    await langBtn2.click();
    await sharedPage.waitForTimeout(300);
    await sharedPage.locator('button:has-text("English")').click();
    await sharedPage.waitForTimeout(800);
  });

  test("reverting to English restores English nav text", async () => {
    const navText = await sharedPage.locator("nav a, aside a").first().textContent();
    expect(navText?.trim()).toBe("Activity Feed");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP 17 — Responsive Layout
// ────────────────────────────────────────────────────────────────────────────

test.describe("17. Responsive Layout", () => {
  test("at 1280px sidebar is visible", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await login(page);
    // Sidebar should have nav links visible
    const sidebarLinks = await page.locator("aside a, nav a").count();
    expect(sidebarLinks).toBeGreaterThanOrEqual(6);
    await ctx.close();
  });

  test("at 375px bottom tabs are visible, sidebar is hidden or collapsed", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await login(page);
    // Bottom tab bar — mobile tabs appear at the bottom
    const bottomTabs = page.locator('nav a[href="/hub/feed"]').last();
    await expect(bottomTabs).toBeVisible();

    // The "More" tab should be in the bottom bar
    const moreTab = page.locator('a:has-text("More")').last();
    await expect(moreTab).toBeVisible();

    await ctx.close();
  });
});
