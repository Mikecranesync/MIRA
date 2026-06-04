# Tester-Install Walkthrough Runbook

**Use this once PR #1557 + #1558 are merged + deployed.** Every command is
copy-paste reproducible. Mike runs the steps marked **[MIKE]**; the rest
the agent can drive next session.

## Pre-flight (verify keystone PR landed)

```powershell
# Expect: HTTP/2 302 with Location: https://auth.monday.com/oauth2/authorize?...
curl -sI https://app.factorylm.com/api/scanbe/oauth/monday/install

# Extract redirect_uri to compare against Monday Dev Center
curl -sI https://app.factorylm.com/api/scanbe/oauth/monday/install `
  | findstr -i "location" `
  | ForEach-Object { [uri]::UnescapeDataString($_) }
```

If still `503 OAuth is not configured` → PR #1557 didn't deploy. Stop.

## Step 0 — Tester Monday workspace **[MIKE]**

Mike creates (or uses existing) a Monday workspace **other than his
main**. Note the workspace slug + account_id (visible in URL when
logged in to monday.com → `https://<slug>.monday.com/`).

Document creds in 1Password (NOT in repo):
- Workspace slug: __________
- Tester email: __________

Doppler additions (optional, only if agent needs to drive future
runs):

```bash
doppler secrets set --project factorylm --config prd `
  MONDAY_TESTER_ACCOUNT_ID="<numeric account_id>" `
  MONDAY_TESTER_SLUG="<slug>"
```

## Step 1 — Install from Dev Center **[MIKE]**

Monday Developer Center → MIRA Scan app → Sandbox → "Install on a
workspace". Pick the tester workspace from Step 0. Click Install.

**Open browser DevTools → Network tab → record HAR** before clicking.
After consent screen + redirect back, save HAR as:

```
tools/web-review-runs/2026-05-26-tester-install/01-oauth-callback.har
```

Expected flow in HAR:
1. `GET auth.monday.com/oauth2/authorize?...` → 302 to Monday consent
2. After click-allow → `GET https://app.factorylm.com/api/scanbe/oauth/monday/callback?code=...&state=...` → 200 HTML
3. Browser meta-refresh → `https://<slug>.monday.com/apps/installed_apps`

## Step 2 — Verify token persisted (NOT Mike's)

```sql
-- Run against Neon prod. Replace <tester_account_id> with the value
-- returned in the Step-1 HTML response (visible in the page body).
SELECT
  account_id,
  scope,
  user_id,
  installed_at,
  last_seen_at,
  revoked_at,
  subscription_status,
  LEFT(access_token, 10) AS token_prefix,
  LENGTH(access_token)   AS token_len
FROM monday_installations
WHERE account_id = '<tester_account_id>';
```

Save output → `tools/web-review-runs/2026-05-26-tester-install/02-db-row-after-install.txt`

**Assertion:** `account_id` is the **tester's**, not Mike's main
workspace id. `token_prefix` starts with `eyJ` (JWT) and is **not**
the same value as Mike's `MONDAY_API_KEY` (Doppler).

## Step 3 — Open item-view, verify sessionToken→account_id resolves

In the tester workspace, add a board with the MIRA Scan app to an
item view. Open any item. Open browser DevTools → Network. The first
calls go to `/api/scanbe/kb/lookup` or `/api/scanbe/queue/status`.

Inspect request headers:
```
X-Monday-Session-Token: eyJhbGciOi...
```

Then immediately probe backend logs (replace timestamp):

```bash
ssh root@165.245.138.91 `
  "docker logs mira-scan-backend --since 5m 2>&1 | grep -E 'account_id|session'" `
  > tools/web-review-runs/2026-05-26-tester-install/03-backend-session-logs.txt
```

**Assertion:** logs reference the tester's account_id, not Mike's. If
sessionToken is rejected (`session token rejected: ...`) the
`MONDAY_SIGNING_SECRET` aliasing in PR #1557 didn't land — escalate.

## Step 4 — Scan a nameplate

In the iframe, click "Scan". Use phone or upload a JPG of any
nameplate. Expected: AssetCard populates with make/model.

Save the rendered card screenshot → `04-assetcard-populated.png`.

```sql
-- Verify scan_queue insert carries tester's account_id
SELECT id, make, model, status, tenant_id, source, first_seen
FROM mira_scan_queue
WHERE tenant_id = '<tester_account_id>'
ORDER BY first_seen DESC
LIMIT 5;
```

Save → `04-scan-queue-rows.txt`.

## Step 5 — MiraChat

Open the chat tab. Ask: `What is the rated current of this asset?`
Save the reply + sources to `05-chat-response.json` (right-click →
"Copy response" in DevTools).

```sql
-- Verify chat_count bumped for tester
SELECT account_id, usage_date, scan_count, chat_count, last_seen_at
FROM account_usage_daily
WHERE account_id = '<tester_account_id>'
  AND usage_date = CURRENT_DATE;
```

Save → `05-usage-row.txt`.

## Step 6 — Save to monday item (CRITICAL — Monday GraphQL writes)

Click "Save to monday item" in AssetCard. Watch DevTools Network for
`POST /api/scanbe/monday/update-item`. Save response body →
`06-monday-update-response.json`.

**Assertion:** `{ok: true, monday_item_id: <numeric>}`. NOT
`reinstall_required` (would mean token broken). NOT
`monday_api.MondayError` (would mean GraphQL rejected the call).

**Verify in Monday's audit log, not just our DB:**
- `https://<slug>.monday.com/admin/audit` → filter on the item id →
  expect to see "Column value changed by MIRA Scan (app token)"
- Screenshot → `06-monday-audit-log.png`

If the audit log credits **Mike** as the actor → PR #1557 didn't take
effect and the standalone `MONDAY_API_TOKEN` fallback fired instead
of the tester's OAuth token. P0 escalation.

## Step 7 — Rate-limit + monthly-cap

Burst test (will trip the per-account rate limit after 30 requests):

```bash
for i in {1..35}; do
  curl -s -o /dev/null -w "%{http_code}\n" `
    -X POST https://app.factorylm.com/api/scanbe/chat/message `
    -H "Content-Type: application/json" `
    -H "X-Monday-Session-Token: <tester_session_token_from_step3>" `
    -d '{"message":"test","history":[]}'
done | tee tools/web-review-runs/2026-05-26-tester-install/07-rate-limit-burst.txt
```

**Assertion:** first ~30 requests return 200, rest return 429 with
JSON body containing `"error":"rate_limit_exceeded"` and
`"used":30,"limit":30`.

## Step 8 — Uninstall + reinstall CTA

In tester workspace: Settings → Installed Apps → MIRA Scan → Uninstall.

```sql
-- Webhook should mark revoked_at NOT NULL within seconds
SELECT account_id, revoked_at, last_seen_at
FROM monday_installations
WHERE account_id = '<tester_account_id>';
```

Save → `08-db-row-after-uninstall.txt`.

Now reload the iframe (still cached) or open scanner direct at
`https://app.factorylm.com/scan/`. Click "Save to monday item" again.

**Assertion:** AssetCard does NOT show a generic error. Browser
top-window redirects to `/api/scanbe/oauth/monday/install` (then on to
Monday consent). Screenshot → `08-reinstall-redirect.png`.

## Final report

Append to `tools/web-review-runs/2026-05-26-tester-install/REPORT.md`:

```markdown
# Tester-Install Receipts — <DATE>

**Tester workspace:** <slug>
**Tester account_id:** <numeric>

| Step | Result | Receipt |
|------|--------|---------|
| 1 OAuth | ✅ | 01-oauth-callback.har |
| 2 Token persisted | ✅ | 02-db-row-after-install.txt |
| 3 sessionToken | ✅ | 03-backend-session-logs.txt |
| 4 Scan | ✅ | 04-assetcard-populated.png + 04-scan-queue-rows.txt |
| 5 Chat | ✅ | 05-chat-response.json + 05-usage-row.txt |
| 6 Monday write | ✅ | 06-monday-update-response.json + 06-monday-audit-log.png |
| 7 Rate-limit | ✅ | 07-rate-limit-burst.txt |
| 8 Uninstall + reinstall CTA | ✅ | 08-db-row-after-uninstall.txt + 08-reinstall-redirect.png |

## Summary

<one paragraph: what worked, what broke first time, what unblocked it>
```

## When this runbook reports done

- All 8 receipts present in `tools/web-review-runs/2026-05-26-tester-install/`
- `monday_installations.account_id` for the tester is NOT Mike's
- Monday audit log shows the column write attributed to the app token (not Mike)
- `revoked_at` is NOT NULL after uninstall
- Reinstall CTA fires top-window redirect

Update `docs/wip/phase1-tester-install/AUDIT.md` "Done-when" checkboxes
and PR the result.
