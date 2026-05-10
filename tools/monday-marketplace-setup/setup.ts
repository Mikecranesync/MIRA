/**
 * MIRA Scan — monday.com marketplace configuration driver.
 *
 * The four Build-tab sections (Features, OAuth, Webhooks, App Onboarding)
 * of the Developer Center for our self-hosted app are configured via a
 * web UI; there is NO API or CLI for self-hosted-app config.
 *
 * AUTOMATION MODE (macOS, default)
 *   Connects to an existing Chrome via CDP on localhost:9222 and auto-fills
 *   all four sections. Chrome must be launched with:
 *     open -a "Google Chrome" --args --remote-debugging-port=9222
 *   then navigate to developer.monday.com and sign in.
 *
 * HYBRID FALLBACK
 *   If CDP connection fails (Chrome not listening, or on Windows where
 *   Defender blocks the CDP websocket handshake), falls back to the
 *   original manual-assist mode: prints exact values, waits for you to
 *   fill each section, captures secrets via stdin → Doppler.
 *
 * USAGE
 *   bun setup.ts              # default mode (automation → hybrid fallback)
 *   bun setup.ts --dry-run    # walk through; skip Doppler writes
 *   bun setup.ts --hybrid     # force hybrid mode even on macOS
 *
 * REQUIREMENTS
 *   - bun 1.x
 *   - doppler CLI authenticated to factorylm/prd
 *   - app.factorylm.com/scan/healthz returning 200
 *   For automation: Chrome open with --remote-debugging-port=9222
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

// ── Configuration ────────────────────────────────────────────────────────

const APP_FACTORYLM_HEALTH = "https://app.factorylm.com/scan/healthz";
const DEVELOPER_HOME = "https://developer.monday.com";
const CDP_ENDPOINT = "http://localhost:9222";

const VALUES = {
  iframeUrl: "https://app.factorylm.com/scan/",
  redirectUri: "https://app.factorylm.com/oauth/monday/callback",
  scopes: "me:read boards:read boards:write",
  webhookUrl: "https://app.factorylm.com/monday/webhook",
  webhookEvents: [
    "install",
    "uninstall",
    "app_subscription_created",
    "app_subscription_changed",
    "app_subscription_cancelled",
  ],
  onboardingMessage:
    "Open any item, then click MIRA Scan in the right panel to capture an asset photo.",
};

const SCRIPT_DIR =
  (import.meta as any).dir ??
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RUNS_DIR = path.join(SCRIPT_DIR, "runs");

// ── Mode flags ───────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const FORCE_HYBRID = argv.includes("--hybrid");

// ── Tiny helpers ─────────────────────────────────────────────────────────

const COLOR = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function log(msg: string, color: keyof typeof COLOR = "reset"): void {
  process.stdout.write(`${COLOR[color]}${msg}${COLOR.reset}\n`);
}

function fail(msg: string): never {
  log(msg, "red");
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ── Pre-flight ───────────────────────────────────────────────────────────

function bunVersionOk(): boolean {
  const r = spawnSync("bun", ["--version"], { encoding: "utf8", shell: true });
  return r.status === 0 && /^\d+\./.test(r.stdout.trim());
}

function dopplerAuthOk(): boolean {
  const r = spawnSync(
    "doppler",
    ["secrets", "--only-names", "--project", "factorylm", "--config", "prd"],
    { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  return r.status === 0;
}

async function appHealthOk(): Promise<boolean> {
  try {
    const resp = await fetch(APP_FACTORYLM_HEALTH, { method: "GET" });
    return resp.ok;
  } catch {
    return false;
  }
}

async function preflight(): Promise<void> {
  log("Pre-flight checks…", "cyan");

  if (!bunVersionOk()) fail("bun 1.x not found in PATH.");
  log("  bun: ok", "dim");

  if (!dopplerAuthOk())
    fail("doppler CLI not authenticated to factorylm/prd. Run `doppler login` and `doppler setup`.");
  log("  doppler factorylm/prd: ok", "dim");

  if (!(await appHealthOk()))
    fail(
      `${APP_FACTORYLM_HEALTH} is NOT 200. The OAuth/webhook URLs we register would point at a dead service. Aborting.`,
    );
  log("  app.factorylm.com/scan/healthz: 200 (ok)", "dim");

  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

// ── Browser open (hybrid fallback only) ──────────────────────────────────

function openBrowser(url: string): void {
  log(`\nOpening ${url} in your default browser…`, "cyan");
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  if (isWin) {
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else if (isMac) {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

// ── Doppler write helper (never logs the value) ──────────────────────────

function dopplerSet(name: string, value: string): boolean {
  if (DRY_RUN) {
    log(`  [dry-run] would set ${name} (length=${value.length})`, "dim");
    return true;
  }
  if (!value) {
    log(`  skip: ${name} is empty (nothing to write)`, "yellow");
    return false;
  }
  const r = spawnSync(
    "doppler",
    ["secrets", "set", name, "--project", "factorylm", "--config", "prd"],
    { input: value, shell: true, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" },
  );
  if (r.status !== 0) {
    log(`  doppler set ${name}: FAILED — ${r.stderr.split("\n")[0]}`, "red");
    return false;
  }
  const verify = spawnSync(
    "doppler",
    ["secrets", "get", name, "--project", "factorylm", "--config", "prd", "--plain"],
    { shell: true, encoding: "utf8" },
  );
  const ok = verify.status === 0 && verify.stdout.trim().length > 0;
  log(
    ok
      ? `  doppler ${name}: stored (length=${verify.stdout.trim().length})`
      : `  doppler ${name}: write OK but verify FAILED`,
    ok ? "green" : "red",
  );
  return ok;
}

// ── Playwright CDP automation ─────────────────────────────────────────────

async function connectChrome(): Promise<{ browser: Browser; page: Page } | null> {
  if (FORCE_HYBRID) return null;
  try {
    log("Connecting to Chrome via CDP (localhost:9222)…", "cyan");
    const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    const ctx: BrowserContext = browser.contexts()[0];
    // Reuse existing Developer Center page or open a new one
    let page = ctx.pages().find((p: Page) => p.url().includes("developer.monday.com")) ?? null;
    if (!page) {
      page = await ctx.newPage();
      await page.goto(DEVELOPER_HOME + "/apps");
      await page.waitForLoadState("networkidle");
    }
    await page.bringToFront();
    log("  ✓ CDP connected", "green");
    return { browser, page };
  } catch (e) {
    log(
      `  CDP failed (${e instanceof Error ? e.message : String(e)}) — falling back to hybrid mode`,
      "yellow",
    );
    return null;
  }
}

/** Navigate to the MIRA Scan app's Build tab section. */
async function ensureOnBuildTab(page: Page, section: string): Promise<void> {
  const url = page.url();
  if (!url.includes("/build/") && !url.includes("/apps/")) {
    await page.goto(DEVELOPER_HOME + "/apps");
    await page.waitForLoadState("networkidle");
  }
  // If on the apps listing, find and click the MIRA Scan app
  if (!url.includes("/build/")) {
    const appCard = page.getByText(/mira scan/i).first();
    await appCard.waitFor({ timeout: 10_000 });
    await appCard.click();
    await page.waitForLoadState("networkidle");
  }
  // Click the section in the Build tab sidebar
  const sectionLink = page
    .getByRole("link", { name: new RegExp(section, "i") })
    .or(page.getByText(new RegExp(`^${section}$`, "i")))
    .first();
  await sectionLink.waitFor({ timeout: 8_000 });
  await sectionLink.click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
}

/** Try to read a displayed value as input value, then textContent, then fallback. */
async function scrapeValue(page: Page, labelPattern: RegExp, fallbackPrompt: string): Promise<string> {
  // Try input/textarea near the label
  try {
    const container = page.getByText(labelPattern).locator("..").first();
    const input = container.getByRole("textbox").first();
    if (await input.isVisible({ timeout: 2_000 })) {
      const val = await input.inputValue();
      if (val.trim()) return val.trim();
    }
  } catch { /* ignore */ }
  // Try adjacent code/span
  try {
    const codeEl = page.getByText(labelPattern).locator("..").locator("code, span[class*='value'], span[class*='secret']").first();
    if (await codeEl.isVisible({ timeout: 1_500 })) {
      const text = await codeEl.textContent();
      if (text?.trim()) return text.trim();
    }
  } catch { /* ignore */ }
  // Manual fallback
  log(`  Auto-scrape failed for ${labelPattern.source} — paste manually:`, "yellow");
  return (await ask(`  ${fallbackPrompt}: `)).trim();
}

// ── Automated sections ────────────────────────────────────────────────────

async function autoSection1Features(page: Page): Promise<void> {
  log("\n[1/4] Features → Item view (automated)", "cyan");
  await ensureOnBuildTab(page, "features");

  // Add new feature if button is visible
  const addBtn = page.getByRole("button", { name: /add.*feature|new feature/i });
  if (await addBtn.isVisible({ timeout: 3_000 })) {
    await addBtn.click();
    await page.waitForTimeout(600);
  }

  // Select Item view
  const itemView = page.getByText(/item view/i).first();
  await itemView.waitFor({ timeout: 6_000 });
  await itemView.click();
  await page.waitForTimeout(500);

  // Fill iframe URL
  const urlField = page
    .getByLabel(/iframe url/i)
    .or(page.getByPlaceholder(/https:\/\//i))
    .first();
  await urlField.waitFor({ timeout: 5_000 });
  await urlField.clear();
  await urlField.fill(VALUES.iframeUrl);

  // Enable mobile compat if present
  const mobileToggle = page.getByLabel(/mobile/i).first();
  if (await mobileToggle.isVisible({ timeout: 1_500 })) {
    if (!(await mobileToggle.isChecked())) await mobileToggle.check();
  }

  // Save
  await page.getByRole("button", { name: /^save$/i }).first().click();
  await page.waitForTimeout(1_500);
  log("  ✓ Features → Item view saved", "green");
}

async function autoSection2OAuth(page: Page): Promise<[string, string]> {
  log("\n[2/4] OAuth → redirect URI + scopes + capture credentials (automated)", "cyan");
  await ensureOnBuildTab(page, "oauth");

  // Redirect URI
  const uriField = page
    .getByLabel(/redirect uri/i)
    .or(page.getByPlaceholder(/redirect/i))
    .or(page.getByPlaceholder(/https/i))
    .first();
  await uriField.waitFor({ timeout: 5_000 });
  await uriField.clear();
  await uriField.fill(VALUES.redirectUri);

  // Scopes — each scope may be a checkbox or a multi-select tag
  for (const scope of VALUES.scopes.split(" ")) {
    const label = new RegExp(scope.replace(":", ".*"), "i");
    const chk = page.getByLabel(label).first();
    if (await chk.isVisible({ timeout: 1_000 })) {
      if (!(await chk.isChecked())) await chk.check();
    } else {
      // Try clicking a scope chip/tag
      const chip = page.getByText(new RegExp(`^${scope}$`, "i")).first();
      if (await chip.isVisible({ timeout: 800 })) await chip.click();
    }
  }

  // Save
  await page.getByRole("button", { name: /^save$/i }).first().click();
  await page.waitForTimeout(2_000);

  // Scrape revealed credentials
  log("  Scraping OAuth credentials from page…", "dim");
  const clientId = await scrapeValue(page, /client id/i, "Client ID (paste)");
  const clientSecret = await scrapeValue(page, /client secret/i, "Client Secret (paste)");

  log(`  Client ID: ${"*".repeat(Math.min(clientId.length, 8))}… (length=${clientId.length})`, "dim");
  log(`  Client Secret: ${"*".repeat(Math.min(clientSecret.length, 8))}… (length=${clientSecret.length})`, "dim");
  return [clientId, clientSecret];
}

async function autoSection3Webhooks(page: Page): Promise<string> {
  log("\n[3/4] Webhooks → URL + lifecycle events + capture signing secret (automated)", "cyan");
  await ensureOnBuildTab(page, "webhook");

  // Webhook URL
  const urlField = page
    .getByLabel(/webhook url/i)
    .or(page.getByPlaceholder(/https/i))
    .first();
  await urlField.waitFor({ timeout: 5_000 });
  await urlField.clear();
  await urlField.fill(VALUES.webhookUrl);

  // Subscribe to each lifecycle event
  for (const evt of VALUES.webhookEvents) {
    const label = new RegExp(evt.replace(/_/g, "[_ ]"), "i");
    const chk = page.getByLabel(label).first();
    if (await chk.isVisible({ timeout: 1_000 })) {
      if (!(await chk.isChecked())) await chk.check();
    } else {
      const chip = page.getByText(label).first();
      if (await chip.isVisible({ timeout: 800 })) await chip.click();
    }
  }

  // Save
  await page.getByRole("button", { name: /^save$/i }).first().click();
  await page.waitForTimeout(2_000);

  // Try to scrape signing secret (optional — backend falls back to client_secret)
  log("  Checking for webhook signing secret…", "dim");
  let sigSecret = "";
  try {
    sigSecret = await scrapeValue(page, /signing secret/i, "Signing Secret (or empty to skip)");
  } catch { /* ignore — secret field may not exist */ }

  if (!sigSecret) {
    log("  No signing secret shown — backend will use MONDAY_OAUTH_CLIENT_SECRET as fallback", "dim");
  }
  return sigSecret;
}

async function autoSection4Onboarding(page: Page): Promise<void> {
  log("\n[4/4] App Onboarding → welcome message (automated)", "cyan");
  await ensureOnBuildTab(page, "onboarding");

  const msgField = page.getByRole("textbox").first();
  if (await msgField.isVisible({ timeout: 3_000 })) {
    const current = await msgField.inputValue().catch(() => "");
    if (!current.trim()) {
      await msgField.fill(VALUES.onboardingMessage);
    } else {
      log("  Onboarding message already set — leaving as-is", "dim");
    }
    // Save only if there's a save button (section may auto-save)
    const saveBtn = page.getByRole("button", { name: /^save$/i }).first();
    if (await saveBtn.isVisible({ timeout: 1_500 })) await saveBtn.click();
    await page.waitForTimeout(1_000);
  } else {
    log("  No onboarding text field visible — skipping", "dim");
  }
  log("  ✓ App Onboarding done", "green");
}

// ── Hybrid section walkthroughs (manual fallback) ─────────────────────────

function printValueBlock(title: string, lines: string[]): void {
  log(`\n${"─".repeat(60)}`, "dim");
  log(title, "bold");
  log(`${"─".repeat(60)}`, "dim");
  for (const line of lines) log(`  ${line}`);
  log(`${"─".repeat(60)}\n`, "dim");
}

async function section1Features(): Promise<void> {
  log("\n[1/4] Features → Item view", "cyan");
  printValueBlock("Enter these values in: Build → Features", [
    "Click 'Add new feature' → choose 'Item view'",
    "",
    `iframe URL:     ${VALUES.iframeUrl}`,
    "Mobile compat:  yes",
    "",
    "Click Save.",
    "(Skip Board view, Dashboard widget, Workspace template — Item view",
    " is the wedge for this app.)",
  ]);
  await ask(`${COLOR.yellow}When the Features → Item view section is saved, press Enter…${COLOR.reset} `);
  log("  ✓ Features marked done.", "green");
}

async function section2OAuth(): Promise<void> {
  log("\n[2/4] OAuth → redirect URI + scopes + capture credentials", "cyan");
  printValueBlock("Enter these values in: Build → OAuth", [
    `Redirect URI:   ${VALUES.redirectUri}`,
    `Scopes:         ${VALUES.scopes}`,
    "",
    "Click Save.",
    "monday will reveal Client ID and Client Secret on the same screen.",
  ]);
  await ask(`${COLOR.yellow}When OAuth is saved and the credentials are visible, press Enter…${COLOR.reset} `);

  log(
    "\nPaste the values below. They go straight into Doppler factorylm/prd via stdin —",
    "dim",
  );
  log("never echoed back, never written to disk, never put in shell history.", "dim");

  const clientId = (await ask(`  Client ID: `)).trim();
  const clientSecret = (await ask(`  Client Secret: `)).trim();

  if (!clientId || !clientSecret) {
    log("  skipping Doppler write — empty values pasted", "yellow");
    return;
  }
  dopplerSet("MONDAY_OAUTH_CLIENT_ID", clientId);
  dopplerSet("MONDAY_OAUTH_CLIENT_SECRET", clientSecret);
}

async function section3Webhooks(): Promise<void> {
  log("\n[3/4] Webhooks → URL + lifecycle events + capture signing secret", "cyan");
  printValueBlock("Enter these values in: Build → Webhooks", [
    `Webhook URL:    ${VALUES.webhookUrl}`,
    `Subscribe to:   ${VALUES.webhookEvents.join(", ")}`,
    "",
    "Click Save.",
    "monday will reveal a Signing Secret on the same screen.",
    "",
    "Note: monday may NOT show a separate signing secret — some app",
    "shapes use the OAuth client_secret to sign lifecycle deliveries.",
    "If there's no signing-secret field shown, just press Enter at the",
    "prompt below; the backend falls back to MONDAY_OAUTH_CLIENT_SECRET.",
  ]);
  await ask(`${COLOR.yellow}When Webhooks is saved, press Enter…${COLOR.reset} `);

  const secret = (await ask(`  Webhook Signing Secret (or empty if not shown): `)).trim();
  if (!secret) {
    log("  no separate signing secret — backend will fall back to MONDAY_OAUTH_CLIENT_SECRET", "dim");
    return;
  }
  dopplerSet("MONDAY_WEBHOOK_SIGNING_SECRET", secret);
}

async function section4Onboarding(): Promise<void> {
  log("\n[4/4] App Onboarding → minimal welcome (or skip)", "cyan");
  printValueBlock("Enter this in: Build → App Onboarding", [
    "Recommendation: leave blank if optional. The product is",
    "self-explanatory (camera button → AI extraction).",
    "",
    "If a non-empty value is required, paste this welcome message:",
    "",
    `  ${VALUES.onboardingMessage}`,
    "",
    "Click Save.",
  ]);
  await ask(`${COLOR.yellow}When App Onboarding is saved (or skipped), press Enter…${COLOR.reset} `);
  log("  ✓ All four sections walked.", "green");
}

// ── Final verification ────────────────────────────────────────────────────

function verifyDoppler(): boolean {
  log("\nDoppler verification:", "cyan");
  let allOk = true;
  for (const name of [
    "MONDAY_OAUTH_CLIENT_ID",
    "MONDAY_OAUTH_CLIENT_SECRET",
    "MONDAY_WEBHOOK_SIGNING_SECRET",
  ]) {
    const r = spawnSync(
      "doppler",
      ["secrets", "get", name, "--project", "factorylm", "--config", "prd", "--plain"],
      { shell: true, encoding: "utf8" },
    );
    const len = r.status === 0 ? r.stdout.trim().length : 0;
    const ok = len > 0;
    log(`  ${name}: ${ok ? `set (length=${len})` : "MISSING"}`, ok ? "green" : "red");
    // Webhook signing secret is optional — backend falls back to client_secret.
    if (!ok && name !== "MONDAY_WEBHOOK_SIGNING_SECRET") allOk = false;
  }
  return allOk;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("MIRA Scan — monday.com marketplace setup", "cyan");
  log(`  mode: ${DRY_RUN ? "dry-run" : "live"} | automation: ${FORCE_HYBRID ? "hybrid (forced)" : "CDP → hybrid fallback"}`, "dim");

  await preflight();

  // ── Automation path (Playwright CDP) ──────────────────────────────────
  const cdp = await connectChrome();

  if (cdp) {
    log("\nPlaywright CDP connected — running fully automated setup…", "cyan");
    log("(Chrome must already be signed in to monday.com Developer Center)", "dim");

    const { browser, page } = cdp;
    try {
      await autoSection1Features(page);
      const [clientId, clientSecret] = await autoSection2OAuth(page);
      const sigSecret = await autoSection3Webhooks(page);
      await autoSection4Onboarding(page);

      if (!DRY_RUN) {
        if (clientId) dopplerSet("MONDAY_OAUTH_CLIENT_ID", clientId);
        if (clientSecret) dopplerSet("MONDAY_OAUTH_CLIENT_SECRET", clientSecret);
        if (sigSecret) dopplerSet("MONDAY_WEBHOOK_SIGNING_SECRET", sigSecret);
      }
    } finally {
      // Disconnect without closing the Chrome window
      await browser.close().catch(() => {});
    }
  } else {
    // ── Hybrid fallback ────────────────────────────────────────────────
    log("\nThis script will:", "cyan");
    log("  1. Open developer.monday.com in your default browser", "dim");
    log("  2. Print the exact values for each Build-tab section", "dim");
    log("  3. Wait for you to save each section", "dim");
    log("  4. Pipe generated OAuth + webhook secrets straight into Doppler", "dim");
    log("  5. Verify the three Doppler secrets at the end", "dim");

    await ask(`\n${COLOR.yellow}Press Enter to open the Developer Center and begin…${COLOR.reset} `);

    openBrowser(DEVELOPER_HOME);
    log("(Sign in to monday.com if prompted, then navigate to your MIRA Scan app's Build tab.)", "dim");

    await section1Features();
    await section2OAuth();
    await section3Webhooks();
    await section4Onboarding();
  }

  const ok = verifyDoppler();

  log("\nNext steps:", "cyan");
  log("  1. mira-scan-monday/docker-compose.yml already has the env block (in this PR).", "dim");
  log("  2. Merge the open PR for the webhook + 429 + setup script.", "dim");
  log("  3. Redeploy mira-scan-monday on the VPS so new env reaches the container:", "dim");
  log(
    "     ssh root@165.245.138.91 'cd /opt/mira/mira-scan-monday && doppler run --project factorylm --config prd -- docker compose up -d --force-recreate'",
    "dim",
  );
  log("  4. Test install round-trip from a non-Mike monday workspace.", "dim");

  rl.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  log(`\nFatal: ${err?.message || err}`, "red");
  rl.close();
  process.exit(2);
});
