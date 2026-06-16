/**
 * Setup project for the deep-crawl audit. Logs in once, persists session to
 * tests/e2e/.state/hub.json, then exits. The audit-desktop and audit-mobile
 * projects depend on this and reuse the storageState.
 *
 * Wired via playwright.config.ts as a project (not globalSetup) so existing
 * specs that don't depend on it run unchanged.
 */

import { test as setup, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import {
  AUDIT_USER,
  HUB_URL,
  STORAGE_STATE_PATH,
  ensureUserRegistered,
  loginWithPassword,
} from "./fixtures/auth";

setup("authenticate audit user", async ({ page, request }) => {
  console.log(`[audit-setup] target hub: ${HUB_URL}`);
  console.log(`[audit-setup] user: ${AUDIT_USER.email}`);

  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

  await ensureUserRegistered(request);
  await loginWithPassword(page);

  // Confirm we landed on an authenticated page before saving state
  await expect(page).toHaveURL(/\/(?:hub\/)?(feed|pending-approval|upgrade)\/?/);

  await page.context().storageState({ path: STORAGE_STATE_PATH });
  console.log(`[audit-setup] storageState saved → ${STORAGE_STATE_PATH}`);
});
