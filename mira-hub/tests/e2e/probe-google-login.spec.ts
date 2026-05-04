import { test, expect } from "@playwright/test";

// Drive the /hub/login → "Sign in with Google" click and capture the
// redirect_uri NextAuth sends to Google. Compare with what's likely
// registered in GCP. Read-only — does not complete the OAuth flow.

test("capture redirect_uri NextAuth sends to Google", async ({ page }) => {
  await page.goto("/hub/login", { waitUntil: "networkidle" });

  console.log(`\n=== /hub/login state ===`);
  console.log(`Final URL: ${page.url()}`);
  console.log(`Title: "${await page.title()}"`);

  // Capture all URL changes (including the Google redirect)
  const urlChanges: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) urlChanges.push(frame.url());
  });

  // Find and click the "Sign in with Google" button
  const googleBtn = page.getByRole("button", { name: /google/i }).first();
  await expect(googleBtn).toBeVisible({ timeout: 5000 });
  console.log(`\nClicking "Sign in with Google" button...`);

  // Click but don't wait for navigation to complete (we want to inspect mid-flight)
  await Promise.all([
    page.waitForURL(/.*/, { timeout: 15000 }).catch(() => {}),
    googleBtn.click(),
  ]);

  await page.waitForTimeout(2500);
  const finalUrl = page.url();

  console.log(`\n=== URL chain ===`);
  urlChanges.forEach((u, i) => console.log(`  ${i}: ${u.slice(0, 200)}`));
  console.log(`Final URL: ${finalUrl.slice(0, 300)}`);

  // Parse the Google OAuth URL to extract redirect_uri
  const u = new URL(finalUrl);
  console.log(`\n=== Final URL parsed ===`);
  console.log(`Origin:   ${u.origin}`);
  console.log(`Pathname: ${u.pathname}`);

  const redirectUri = u.searchParams.get("redirect_uri");
  const clientId = u.searchParams.get("client_id");
  const errorParam = u.searchParams.get("error");
  const errorDesc = u.searchParams.get("error_description");

  console.log(`\n=== Critical OAuth params ===`);
  console.log(`client_id:         ${clientId}`);
  console.log(`redirect_uri:      ${redirectUri}`);
  if (errorParam) console.log(`error:             ${errorParam}`);
  if (errorDesc) console.log(`error_description: ${errorDesc}`);

  // Check page body for Google's error message if present
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 800) ?? "");
  console.log(`\n=== Page body (first 800 chars) ===\n${bodyText}`);

  await page.screenshot({
    path: "test-results/probe-google-login.png",
    fullPage: true,
  });
  console.log(`\nScreenshot: test-results/probe-google-login.png`);

  expect(true).toBe(true);
});
