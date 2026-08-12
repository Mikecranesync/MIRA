/**
 * Auth setup for the Equipment Notebook Playwright run. Logs in once via the
 * NextAuth password form and saves storage state for the other projects.
 * Credentials come from env (NOTEBOOK_TEST_EMAIL / NOTEBOOK_TEST_PASSWORD) —
 * never hardcoded, never logged. Fails loudly if they're unset so a green run
 * can never mean "skipped login".
 */
import { test as setup, expect } from "@playwright/test";

const STATE = "tests/equipment/.state/notebook.json";

setup("authenticate", async ({ page }) => {
  const email = process.env.NOTEBOOK_TEST_EMAIL;
  const password = process.env.NOTEBOOK_TEST_PASSWORD;
  expect(email, "NOTEBOOK_TEST_EMAIL must be set").toBeTruthy();
  expect(password, "NOTEBOOK_TEST_PASSWORD must be set").toBeTruthy();

  await page.goto("login/");
  await page.getByRole("button", { name: "Sign in with password" }).click();
  // The password form fields carry stable ids (#login-email / #login-password);
  // getByLabel("Email") is ambiguous with the magic-link input above.
  await page.locator("#login-email").fill(email!);
  await page.locator("#login-password").fill(password!);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login/"), { timeout: 30_000 }),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  // Prove the session is real: an authed API call returns 200.
  const res = await page.request.get("api/me/");
  expect(res.ok(), "authenticated /api/me should be 200").toBeTruthy();
  await page.context().storageState({ path: STATE });
});
