# 2026-04-26 — factorylm.com customer-journey audit

Synthetic-user audit driven by Playwright 1.59, no MCP server. Routes:
`/` → `/cmms` → `/pricing` → `/activated`.

## Reproducing

```bash
cd tools/web-review-runs/2026-04-26
npm install
node audit.cjs            # 4 routes, headless Chromium, 1366x900 + 375x812
node probe-ctas.cjs        # CTA destinations + form structure
node probe-activated.cjs   # /activated token-gate behavior
node probe-signup-source.cjs  # handleSignup() source (no submission — never POST)
```

## Output

- `route-{landing,cmms,pricing,activated}.json` — per-route DOM scan + console + network
- `audit-summary.json` — combined
- `probe-*.json` — targeted CTA / activated / signup source captures
- `seen-merges.txt` — watcher log for the 7-PR sweep

## Findings → GitHub issues

12 actions filed against `Mikecranesync/MIRA` — see `file-issues.sh` for the
exact reopens / comments / new-creates. Severity-sorted summary at the time
of run is in the canary-overwritten wiki note (the `chore(web-review): daily
canary` cron clobbers `wiki/reviews/<date>-<host>.md` hourly, so this dir is
the durable artifact).

Issues filed: #615 (reopen), #620 (reopen), #616/#625/#619 (comment),
#657–#663 (new).

## Limits

- Did NOT submit signup form (would create real HubSpot lead)
- Did NOT verify `/activated?token=…` flow (needs real Stripe checkout)
- No Lighthouse run (not installed in this env)
- No axe-core color contrast check
