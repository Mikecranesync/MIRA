# Tester-install receipts — 2026-05-26

Pre-staged for the Phase 1 tester-install walkthrough described in
`docs/wip/phase1-tester-install/WALKTHROUGH.md`. Files land here as
the 8-step flow runs.

## Expected files (post-walkthrough)

| File | Source | Format |
|------|--------|--------|
| 01-oauth-callback.har | Browser DevTools Network export during install | HAR |
| 02-db-row-after-install.txt | `psql` against Neon, `monday_installations` SELECT | text |
| 03-backend-session-logs.txt | `docker logs mira-scan-backend` filtered on account_id | text |
| 04-assetcard-populated.png | Screenshot of populated AssetCard | PNG |
| 04-scan-queue-rows.txt | `mira_scan_queue` SELECT scoped to tester | text |
| 05-chat-response.json | DevTools "Copy response" on `/chat/message` | JSON |
| 05-usage-row.txt | `account_usage_daily` SELECT | text |
| 06-monday-update-response.json | DevTools "Copy response" on `/monday/update-item` | JSON |
| 06-monday-audit-log.png | Screenshot of Monday admin audit log filtered to the item | PNG |
| 07-rate-limit-burst.txt | Output of the bash burst loop | text |
| 08-db-row-after-uninstall.txt | `monday_installations` SELECT after uninstall | text |
| 08-reinstall-redirect.png | Screenshot of reinstall CTA top-window redirect | PNG |
| REPORT.md | Final one-paragraph report + 8-row receipts table | markdown |

## Status as of 2026-05-26

Walkthrough blocked — PRs #1557 + #1558 awaiting one-word OK + redeploy.
Once deployed and Mike has clicked Install in a tester workspace, the
agent can drive Steps 3, 4, 5, 7 (and the SQL portions of 2 + 6 + 8)
on the next session. Steps 1 + 6-audit-log + 8-uninstall require Mike.
