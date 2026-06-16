# MIRA Google Chat Bot — Customer Install Runbook

**Audience:** Google Workspace admin or IT contact at customer site  
**Time required:** ~30 minutes  
**Prerequisites:** Google Workspace admin access, GCP project, MIRA credentials from FactoryLM

---

## Overview

MIRA's Google Chat bot uses a service account for authentication (no per-user OAuth required).
The bot receives messages via a synchronous HTTP webhook — Google Chat POSTs the event to
your server and expects the reply in the HTTP response body.

---

## Step 1 — Create a GCP project (or use existing)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project: **MIRA Bot** (or use your existing project)
3. Note the **Project ID** for later

---

## Step 2 — Enable required APIs

In your GCP project, enable:
- **Google Chat API** — for receiving and sending messages
- **Google Drive API** — for downloading file attachments sent in Chat

```bash
gcloud services enable chat.googleapis.com drive.googleapis.com \
  --project=YOUR_PROJECT_ID
```

Or via Console: APIs & Services → Library → search and enable each.

---

## Step 3 — Create a service account

1. IAM & Admin → Service Accounts → **Create Service Account**
2. Name: `mira-bot`, Description: `MIRA Chat bot service account`
3. Click **Done** (no project roles needed — Chat API permissions come from app config)
4. Click the service account → **Keys** → **Add Key** → **Create new key** → JSON
5. Download the JSON key file — store it securely

**Store in Doppler:**
```bash
doppler secrets set GCHAT_SERVICE_ACCOUNT_JSON \
  --project factorylm --config prd \
  "$(cat path/to/service-account-key.json)"
```

---

## Step 4 — Configure domain-wide delegation (for Drive file access)

If you need MIRA to download files shared in Chat:

1. In Workspace Admin Console → Security → API Controls → Domain-wide Delegation
2. **Add new** → paste the service account Client ID (from the JSON key file)
3. OAuth scopes:
   ```
   https://www.googleapis.com/auth/chat.bot
   https://www.googleapis.com/auth/drive.readonly
   ```
4. **Authorize**

---

## Step 5 — Create the Chat app in Google Cloud Console

1. In your GCP project → APIs & Services → **Google Chat API** → **Configuration**
2. Fill in:
   - **App name**: MIRA
   - **Avatar URL**: `https://app.factorylm.com/static/mira-avatar.png`
   - **Description**: AI-powered industrial maintenance assistant
3. **Connection settings**: select **App URL**
   - **App URL**: `https://<mira-domain>/gchat/events`
4. **Slash commands**: click **Add slash command** for each:
   | ID | Name | Description |
   |----|------|-------------|
   | 1 | /mira | Ask MIRA anything |
   | 2 | /workorder | Create a work order |
   | 3 | /asset | Look up an asset |
   | 4 | /reset | Reset conversation |
5. **Visibility**: Specific people and groups in your domain → add the maintenance team group
6. **Save**

---

## Step 6 — (Optional) Set verification token

Google Chat sends a `token` field in each request that matches a secret you configure.
To enable simple token verification:

1. In the Chat API configuration page, note the **Verification token**
2. Store in Doppler:
   ```bash
   doppler secrets set GCHAT_VERIFICATION_TOKEN \
     --project factorylm --config prd "your-verification-token"
   ```

For production, consider full JWT Bearer verification (see `mira-bots/gchat/bot.py`).

---

## Step 7 — Install MIRA in Google Chat

After the app is published:

1. In Google Chat → **Add people, bots, or channels**
2. Search for **MIRA**
3. Click **Chat** to open a DM with MIRA

For a space (channel):
1. Open the space → People & bots → **Add**
2. Search "MIRA" → **Add**

Or use Admin Console for org-wide rollout:
- Workspace Admin → Apps → Google Workspace Marketplace → Manage apps → MIRA

---

## Step 8 — Verify installation

1. In a DM with MIRA, type `Hello` — MIRA should respond
2. Send a photo of equipment — MIRA should analyze it
3. Try a slash command: `/mira VFD fault OC1`

If MIRA does not respond, check the troubleshooting table below.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| No response | Webhook URL unreachable | Verify `https://<domain>/gchat/events` returns 200 on POST |
| "MIRA error: ..." | Service account not configured | Check `GCHAT_SERVICE_ACCOUNT_JSON` in Doppler |
| "invalid token" | Verification token mismatch | Sync `GCHAT_VERIFICATION_TOKEN` with Chat API config |
| File download fails | Drive API not enabled or delegation missing | Re-check Step 2 + Step 4 |
| Bot not findable | App visibility restricted | Chat API Configuration → Visibility → expand to group/domain |

**Health check:**
```bash
curl https://<mira-domain>/health
# Expected: {"status": "ok", "platform": "gchat"}
```

**Logs:**
```bash
docker logs mira-bot-gchat -f
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GCHAT_SERVICE_ACCOUNT_JSON` | Service account key JSON | (Doppler managed) |
| `GCHAT_VERIFICATION_TOKEN` | Optional request verification | `abc123xyz` |
| `GCHAT_PORT` | Bot server port | `8030` |
| `MIRA_TENANT_ID` | Customer tenant slug | `acme-widgets` |
| `OPENWEBUI_BASE_URL` | MIRA core URL | `http://mira-core:8080` |
| `MAX_VISION_PX` | Image resize limit | `512` |

All secrets managed via Doppler project `factorylm`, config `prd`.

---

## Architecture Note

Unlike Slack and Teams (which use asynchronous webhooks), Google Chat expects a **synchronous response**:
the bot's reply is returned directly in the HTTP response body. MIRA's GChat bot takes advantage
of this — no separate API call is needed for simple message replies, reducing latency.

For proactive messages (e.g. fault alerts), `GoogleChatAdapter.render_outgoing()` calls the
Chat API directly via `WorkspaceClient.send_message()`.
