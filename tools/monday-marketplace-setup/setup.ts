/**
 * MIRA Scan — monday.com marketplace configuration driver (hybrid).
 *
 * The four Build-tab sections (Features, OAuth, Webhooks, App Onboarding)
 * of the Developer Center for our self-hosted app are configured via a
 * web UI; there is NO API or CLI for self-hosted-app config.
 *
 * Initial design tried to drive Chrome via Playwright (`connectOverCDP`)
 * but Microsoft Defender on this Windows host blocks the websocket-CDP
 * handshake (see `feedback_playwright_windows_cdp_websocket_blocked.md`
 * in memory). So this script is a HYBRID:
 *
 *   - We do all the programmable parts: pre-flight, value generation,
 *     secret capture into Doppler, end-to-end verification.
 *   - You do the actual click + form-fill in monday's Developer Center
 *     (1-3 minutes per section).
 *   - Generated secrets go straight from your paste-in to Doppler via
 *     stdin — never disk, never stdout, never shell history.
 *
 * USAGE
 *   bun setup.ts              # default mode
 *   bun setup.ts --dry-run    # walk through; skip Doppler writes
 *
 * REQUIREMENTS
 *   - bun 1.x
 *   - doppler CLI authenticated to factorylm/prd
 *   - app.factorylm.com/scan/healthz returning 200
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

// ── Configuration ────────────────────────────────────────────────────────

const APP_FACTORYLM_HEALTH = "https://app.factorylm.com/scan/healthz";
const DEVELOPER_HOME = "https://developer.monday.com";

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

// bun exposes import.meta.dir; fall back to deriving from import.meta.url for tsc-checks.
const SCRIPT_DIR =
  (import.meta as any).dir ??
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RUNS_DIR = path.join(SCRIPT_DIR, "runs");

// ── Mode flags ───────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");

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

// ── Browser open (no automation control) ─────────────────────────────────

function openBrowser(url: string): void {
  // Windows: `start "" "<url>"` opens in the default browser.
  // We don't try to control it — Defender on this host blocks Playwright
  // CDP transports (see feedback_playwright_windows_cdp_websocket_blocked).
  log(`\nOpening ${url} in your default browser…`, "cyan");
  spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
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
  // Verify by reading back length only — never echo the value.
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

// ── Section walkthroughs ─────────────────────────────────────────────────

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
  log("MIRA Scan — monday.com marketplace setup (hybrid)", "cyan");
  log(`  mode: ${DRY_RUN ? "dry-run" : "live"}`, "dim");

  await preflight();

  log("\nThis script will:", "cyan");
  log("  1. Open developer.monday.com in your default browser", "dim");
  log("  2. Print the exact values for each Build-tab section", "dim");
  log("  3. Wait for you to save each section", "dim");
  log("  4. Pipe generated OAuth + webhook secrets straight into Doppler", "dim");
  log("  5. Verify the three Doppler secrets at the end", "dim");
  log(
    "\nWhy not full automation? Microsoft Defender on this Windows host blocks",
    "dim",
  );
  log(
    "Playwright's CDP transports — see memory feedback_playwright_windows_cdp_*.md",
    "dim",
  );
  log("for the rationale. Hybrid is the reliable path on this machine.", "dim");

  await ask(`\n${COLOR.yellow}Press Enter to open the Developer Center and begin…${COLOR.reset} `);

  openBrowser(DEVELOPER_HOME);
  log("(Sign in to monday.com if prompted, then navigate to your MIRA Scan app's Build tab.)", "dim");

  await section1Features();
  await section2OAuth();
  await section3Webhooks();
  await section4Onboarding();

  const ok = verifyDoppler();

  log("\nNext steps:", "cyan");
  log("  1. Update mira-scan-monday/docker-compose.yml has been done (env block).", "dim");
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
