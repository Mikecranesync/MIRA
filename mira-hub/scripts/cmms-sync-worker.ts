#!/usr/bin/env bun
/**
 * NeonDB ↔ Atlas CMMS sync worker (P1).
 *
 * Two run modes:
 *
 *   --once         Run a single tick (forward + reverse) and exit.
 *                  Use this from cron.
 *
 *   --interval-ms  Loop forever, sleeping `--interval-ms` between ticks.
 *                  Use this when running as a long-lived sidecar.
 *                  Default: 60000 (60s).
 *
 *   --skip-reverse Run forward sync only (NeonDB → Atlas). Useful while
 *                  diagnosing reverse-sync issues.
 *
 *   --skip-forward Run reverse sync only.
 *
 * Env vars (read by AtlasClient + pg pool):
 *   NEON_DATABASE_URL   — required
 *   HUB_CMMS_API_URL    — Atlas API base, default https://cmms.factorylm.com
 *   ATLAS_API_USER      — admin email for Atlas auth
 *   ATLAS_API_PASSWORD  — admin password
 *   CMMS_SYNC_ENABLED   — must be "true" or worker is a no-op (safety flag
 *                         so we don't accidentally mix tenants while shared-
 *                         admin Atlas creds are still in use)
 *
 * Exit codes:
 *   0  — clean exit (only meaningful with --once)
 *   1  — fatal error (missing env, signin failure, unhandled exception)
 *
 * Spec context: docs/specs/hub-cmms-integration-spec.md §4 P1 + P1b.
 */

import { AtlasClient } from "@/lib/atlas/client";
import { runForwardSync, runReverseSync, syncEnabled } from "@/lib/atlas/sync";

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseValue(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

if (!process.env.NEON_DATABASE_URL) {
  console.error("[cmms-sync] NEON_DATABASE_URL is required");
  process.exit(1);
}

const ONCE = parseFlag("once");
const SKIP_FORWARD = parseFlag("skip-forward");
const SKIP_REVERSE = parseFlag("skip-reverse");
const INTERVAL_MS = Number(parseValue("interval-ms") ?? 60_000);

if (!syncEnabled()) {
  console.warn(
    "[cmms-sync] CMMS_SYNC_ENABLED is not 'true'. The worker will run a tick and report stats, " +
      "but every sync function will short-circuit. Set CMMS_SYNC_ENABLED=true in Doppler when " +
      "ready to actually push to Atlas.",
  );
}

const client = new AtlasClient();
if (!client.configured) {
  console.error(
    "[cmms-sync] Atlas client unconfigured. Set ATLAS_API_USER and ATLAS_API_PASSWORD in Doppler.",
  );
  process.exit(1);
}

let stopping = false;
process.on("SIGINT", () => {
  console.log("[cmms-sync] SIGINT received — stopping after current tick.");
  stopping = true;
});
process.on("SIGTERM", () => {
  console.log("[cmms-sync] SIGTERM received — stopping after current tick.");
  stopping = true;
});

async function tick(): Promise<void> {
  const t0 = Date.now();
  if (!SKIP_FORWARD) {
    await runForwardSync(client);
  }
  if (!SKIP_REVERSE) {
    await runReverseSync(client);
  }
  console.log(`[cmms-sync] tick complete in ${Date.now() - t0}ms`);
}

if (ONCE) {
  try {
    await tick();
    process.exit(0);
  } catch (err) {
    console.error("[cmms-sync] fatal:", err);
    process.exit(1);
  }
} else {
  console.log(`[cmms-sync] running every ${INTERVAL_MS}ms — Ctrl-C to stop.`);
  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      console.error("[cmms-sync] tick error:", err);
    }
    if (stopping) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
    if (stopping) break;
  }
  process.exit(0);
}
