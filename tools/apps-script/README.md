# MIRA Magic Inbox — Apps Script

Polls Gmail for unread `kb+<slug>@factorylm.com` messages and forwards them to mira-web's `/api/v1/inbox/email` webhook with HMAC-SHA256 signing. Free; uses Google Workspace plus-addressing — no DNS changes, no new vendor.

## Install (5 minutes, do once)

1. **Generate the shared secret** (any unix host):
   ```
   openssl rand -hex 32
   ```
   Save the value — you'll paste it in two places below.

2. **Set it on mira-web**:
   ```
   doppler secrets set INBOUND_HMAC_SECRET=<value> --project factorylm --config prd
   ssh vps "cd /opt/mira && doppler run --project factorylm --config prd -- docker compose -f docker-compose.saas.yml up -d --force-recreate mira-web"
   ```

3. **Create the Apps Script project**:
   - Open https://script.google.com → **New project**
   - Delete the default `function myFunction()` boilerplate
   - Paste the entire contents of `inbox-poller.gs` as `Code.gs`
   - Save (Ctrl/Cmd + S)

4. **Set the script property**:
   - Click the gear icon (Project Settings) in the left sidebar
   - Scroll to **Script Properties** → click **Add script property**
   - Property name: `HMAC_SECRET`
   - Value: (the same value from step 1)
   - Save

5. **Add the trigger**:
   - Click the clock icon (Triggers) in the left sidebar
   - **Add Trigger** (bottom right)
   - Function: `processInbox`
   - Deployment: `Head`
   - Event source: `Time-driven`
   - Type: `Minutes timer`
   - Interval: `Every minute`
   - Save → review the OAuth consent → **Allow**
     (You'll see a "Google hasn't verified this app" warning — that's normal for personal scripts. Click **Advanced** → **Go to (project name)**.)

6. **Test the connection** without sending real email:
   - In the editor, dropdown next to ▶ Run → select `testWebhook` → click Run
   - View → Logs → expect `Response: 200 {"ok":true,"ignored":"unknown-recipient"}`
   - If you see 401 → secret mismatch between Doppler and Script Property
   - If you see 500 → mira-web doesn't have `INBOUND_HMAC_SECRET` set yet (redo step 2 + restart)

7. **End-to-end test** (after step 6 returns 200):
   - Hit `https://factorylm.com/activated?token=<your JWT>` → copy your `kb+<slug>@factorylm.com` address
   - Forward an OEM PDF from your Gmail to that address
   - Within 60–90 seconds: receipt email arrives ("Got it. Here's what landed in your knowledge base just now: …")
   - Within 2 minutes: that manual is searchable in Telegram

## How it works

```
Customer Gmail
    │  forward message with PDF
    ▼
kb+<slug>@factorylm.com
    │  Gmail plus-addressing routes mike+anything@factorylm.com → mike@factorylm.com
    ▼
Mike's Workspace inbox (apex MX = Google, untouched)
    │  Apps Script time-trigger every 1 min
    ▼
processInbox() searches "is:unread to:(kb+@) newer_than:1d"
    │  for each unread kb+ message:
    │    extract attachments, base64-encode
    │    HMAC-SHA256 sign body with HMAC_SECRET
    │    UrlFetchApp.fetch POST → mira-web
    │    on 2xx: msg.markRead()
    │    on non-2xx or throw: leave unread (auto-retry next minute)
    ▼
mira-web /api/v1/inbox/email
    │  verifySignedRequest(body, X-Hmac-Signature, X-Hmac-Timestamp, INBOUND_HMAC_SECRET)
    │   - HMAC over `<unix-timestamp>.<body>`
    │   - reject if timestamp >5 min off (replay-window guard)
    │  extract slug, look up tenant
    │  forward each attachment to mira-ingest /ingest/document-kb
    │  fire receipt email
    ▼
KB chunks in NeonDB; receipt in customer's inbox
```

## Operational notes

- **Latency**: 30–90s end-to-end (1-min poll + 30s ingest). Fine for "forward a manual" UX.
- **Quotas**: Workspace allows 20K script-runs/day. 1-min trigger = 1,440/day, well under.
- **Retry safety**: a message stays unread until the webhook returns 2xx. If mira-web is down, the next run picks it up. Idempotency is guarded by mira-ingest's content-hash dedup ledger (migration 007), so a duplicate webhook from a re-run is silently skipped.
- **Plus-addressing edge case**: some upstream MTAs strip `+slug` from the local-part. Gmail/iCloud/Outlook 365 preserve it; obscure relays may not. If a customer reports their email "didn't arrive," check Gmail's All Mail filter — a stripped `+slug` lands at `mike@factorylm.com` instead of being dropped.
- **OAuth re-auth**: about once a year Google may invalidate the token. Symptom: the trigger stops firing. Fix: open script.google.com → Triggers → re-save the trigger (re-prompts OAuth).
- **Stop the script**: in the script's Triggers panel, delete the trigger. mira-web's webhook will simply receive no traffic — nothing else to disable.

## Files

| File | Purpose |
|---|---|
| `inbox-poller.gs` | Paste this into script.google.com as `Code.gs` |
| `README.md` | This file |
