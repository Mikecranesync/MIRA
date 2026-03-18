# MIRA — Microsoft Teams Setup Guide

## Overview

MIRA integrates with Microsoft Teams via the Azure Bot Service (Bot Framework SDK). The bot receives messages at a webhook endpoint and responds using the same GSD engine as Telegram and Slack.

## Prerequisites

- Azure account (free tier F0 works for development)
- A publicly accessible domain or ngrok tunnel for the webhook
- Doppler CLI configured for `factorylm/prd`

## Setup Steps (~30 minutes)

### 1. Create Azure Bot Resource

1. Sign in to [portal.azure.com](https://portal.azure.com)
2. Search for **Azure Bot** → Create
3. Select:
   - **Bot handle:** `mira-factorylm` (or your org name)
   - **Subscription:** your subscription
   - **Resource group:** `mira-rg`
   - **Pricing tier:** F0 (free)
   - **Microsoft App ID:** Create new Microsoft App ID
4. Click **Create**

### 2. Get App ID + Password

1. In the Azure Bot resource → **Configuration** → note the **Microsoft App ID**
2. Go to **Manage** (link next to App ID) → **Certificates & secrets**
3. Click **New client secret** → copy the **Value** immediately (shown once only)

### 3. Set Secrets in Doppler

```bash
doppler secrets set \
  TEAMS_APP_ID=<your-app-id> \
  TEAMS_APP_PASSWORD=<your-client-secret> \
  --project factorylm --config prd
```

### 4. Set Messaging Endpoint

1. In Azure Bot → **Configuration** → **Messaging endpoint:**
   ```
   https://<your-domain>:8020/api/messages
   ```
2. If testing locally: use `ngrok http 8020` and set the ngrok URL

### 5. Deploy the Teams Bot

```bash
doppler run --project factorylm --config prd -- \
  docker compose up -d teams-bot
```

### 6. Connect to Teams

1. In Azure Bot → **Channels** → **Microsoft Teams** → Configure
2. Click **Save** → Open Teams
3. Search for your bot by name and start a chat

## Verify

```bash
curl http://localhost:8020/health
# Expected: {"status": "ok", "platform": "teams"}
```

Send a message to the bot in Teams — you should get a diagnostic response.

## Environment Variables

| Var | Description |
|-----|-------------|
| `TEAMS_APP_ID` | Azure Bot App ID (Doppler) |
| `TEAMS_APP_PASSWORD` | Azure Bot client secret (Doppler) |
| `TEAMS_PORT` | Host port (default: 8020) |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Bot doesn't respond | Check messaging endpoint URL in Azure portal |
| 401 Unauthorized | TEAMS_APP_ID or TEAMS_APP_PASSWORD incorrect |
| Bot unreachable | Ensure port 8020 is publicly accessible or ngrok is running |
