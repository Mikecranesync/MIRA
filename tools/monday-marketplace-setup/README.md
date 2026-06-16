# MIRA Scan — monday.com marketplace setup (hybrid)

Walks the four Build-tab sections in monday.com's Developer Center for
the self-hosted MIRA Scan app, captures the generated OAuth + webhook
secrets, and pipes them straight into Doppler `factorylm/prd`.

## Why "hybrid"?

monday.com's Developer Center exposes **no API** for self-hosted-app
configuration — `@mondaycom/apps-cli` (`mapps`) only handles
`code:push`/`env:set`/`tunnel:create` for monday-*hosted* apps. So the
form-fill itself has to happen in a browser.

Initial design tried to drive Chrome via Playwright. **Microsoft
Defender on this Windows host blocks Playwright's CDP transports** —
both the default Pipe transport (verified earlier, see memory
`feedback_playwright_windows_chrome_screenshot.md`) and `connectOverCDP`
against an externally-launched Chrome (verified 2026-05-05, memory
`feedback_playwright_windows_cdp_websocket_blocked.md`). Pre-flight all
green, Chrome's `/json/version` returns OK, but the websocket-upgrade to
`ws://localhost:9222/devtools/browser/<id>` times out at 30s.

So the script is hybrid: **everything programmable is automated**;
**only the browser form-fill is manual** (1-3 minutes per section).

## What's automated vs. manual

| Step | Who |
|---|---|
| Pre-flight (bun + Doppler auth + healthz) | Script |
| Compute the exact values for each section | Script |
| Open Developer Center in your default browser | Script |
| Click + fill + save each section | You (Mike) |
| Capture generated OAuth client_id, client_secret, signing secret | You paste; script handles |
| Pipe secrets to Doppler `factorylm/prd` via stdin (no disk, no stdout, no shell history) | Script |
| Verify all three Doppler secrets are set | Script |

## Prerequisites

1. **bun 1.x** in PATH (`bun --version`)
2. **doppler CLI** authenticated to `factorylm/prd`
   (`doppler secrets --only-names --project factorylm --config prd`)
3. `https://app.factorylm.com/scan/healthz` returning **200**

## Run

```powershell
cd tools/monday-marketplace-setup
bun install
bun setup.ts
```

Modes:

| Flag | Behavior |
|---|---|
| (default) | live mode; writes secrets to Doppler |
| `--dry-run` | walks every step but skips Doppler writes |

## What it does, step by step

1. **Pre-flight**: refuses to run unless bun, Doppler, and the live
   `/scan/healthz` are all green.
2. **Opens Developer Center** in your default browser via `start chrome`
   (no automation control).
3. **Walks four sections** in order, each prompting you when ready:
   - **Features** → Item view, iframe URL `https://app.factorylm.com/scan/`
   - **OAuth** → redirect URI `https://app.factorylm.com/oauth/monday/callback`, scopes `me:read boards:read boards:write`, then prompts for the generated Client ID + Client Secret
   - **Webhooks** → URL `https://app.factorylm.com/monday/webhook`, events install / uninstall / app_subscription_*, then prompts for the signing secret if monday shows one
   - **App Onboarding** → recommend skip / leave blank
4. **Pipes each secret** straight into `doppler secrets set <NAME>` via
   stdin. Never echoes the value, never writes to a file, never enters
   shell history.
5. **Verifies** each Doppler secret by reading back its **length**
   (never the value).

## After running

1. Confirm the three Doppler secrets are set:
   ```
   doppler secrets get MONDAY_OAUTH_CLIENT_ID MONDAY_OAUTH_CLIENT_SECRET MONDAY_WEBHOOK_SIGNING_SECRET --project factorylm --config prd --plain
   ```
2. Redeploy mira-scan-monday so the new env reaches the container:
   ```
   ssh root@165.245.138.91 "cd /opt/mira/mira-scan-monday && doppler run --project factorylm --config prd -- docker compose up -d --force-recreate"
   ```
3. Test the install round-trip from a non-Mike monday workspace and
   confirm a row appears in `monday_installations` with the new
   account_id (per the verification section of the active plan in
   `~/.claude/plans/dev-api-key-for-optimized-badger.md`).

## What this does NOT do

- Submit the app to the marketplace (separate manual step in the
  Developer Center after listing artifacts are ready)
- Configure billing (Phase 1 ships with no in-app paywall — see active
  plan)
- Modify the running container (you redeploy yourself per step 2 above)
