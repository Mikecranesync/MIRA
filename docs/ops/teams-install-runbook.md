# MIRA Teams Bot — Customer Install Runbook

**Audience:** Teams admin or IT contact at customer site  
**Time required:** ~20 minutes  
**Prerequisites:** Microsoft Teams admin access, MIRA bot credentials from FactoryLM

---

## What you'll need from FactoryLM

Before starting, FactoryLM will provide:
- `MIRA-teams-app.zip` — the Teams app package (manifest + icons)
- `TEAMS_APP_ID` — the Azure Bot application ID
- `TEAMS_APP_PASSWORD` — the bot client secret (store in Doppler, not .env)

---

## Step 1 — Download the app package

FactoryLM delivers `MIRA-teams-app.zip`. It contains:
```
manifest.json
color.png   (192×192 MIRA logo)
outline.png (32×32 outline icon)
```

If building from source: `cd mira-bots/teams/manifest && zip -r MIRA-teams-app.zip .`

---

## Step 2 — Upload to Teams Admin Center

1. Go to **Microsoft Teams Admin Center** → [admin.teams.microsoft.com](https://admin.teams.microsoft.com)
2. Navigate to **Teams apps → Manage apps**
3. Click **Upload new app** → **Upload**
4. Select `MIRA-teams-app.zip`
5. Review the permissions dialog → click **Allow**

The app will appear in your tenant's app catalog as "MIRA".

---

## Step 3 — Assign to users (optional: org-wide)

### Option A — Assign to specific users
1. In Admin Center → **Teams apps → Setup policies**
2. Click **Add apps** → search "MIRA" → **Add**
3. Assign the policy to the relevant users or groups (maintenance team, supervisors, etc.)

### Option B — Org-wide install (all users)
1. In Admin Center → **Teams apps → Manage apps**
2. Find "MIRA" → click the app name
3. Click **Add to all users** *(requires Teams admin role)*

---

## Step 4 — Pin the bot in the sidebar (recommended)

1. In Admin Center → **Teams apps → Setup policies** → select or create a policy
2. Under **Pinned apps** → **Add apps** → search "MIRA" → **Add**
3. Drag MIRA to the desired position in the pinned list
4. **Save** the policy and assign it to the maintenance team group

---

## Step 5 — Verify the bot is working

1. In Teams, open a new chat and search for **MIRA**
2. Start a conversation: type `Hello` — MIRA should respond
3. Test photo diagnosis: send a photo of equipment or a fault display
4. Test a command: type `diagnose` — MIRA should start the guided fault flow

If MIRA does not respond, check Step 6 (troubleshooting).

---

## Step 6 — Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Bot does not respond | Messaging endpoint not configured | In Azure Portal → Bot resource → Settings → Messaging endpoint → set to `https://<mira-domain>/api/messages` |
| "Sorry, there was an error" | App ID/password mismatch | Verify `TEAMS_APP_ID` and `TEAMS_APP_PASSWORD` in Doppler match the Azure Bot registration |
| File uploads fail | `supportsFiles: true` not in manifest | Rebuild the app package from latest manifest |
| Bot visible but can't message | App not approved in tenant | Teams Admin Center → Manage apps → find MIRA → set status to **Allowed** |
| Photo analysis returns generic response | Vision model not running | Check `mira-core` container logs and `VISION_MODEL` env var |

**Logs:**  
```bash
docker logs mira-bot-teams -f
```

**Health check:**  
```bash
curl https://<mira-domain>/health
# Expected: {"status": "ok", "platform": "teams"}
```

---

## Step 7 — Channel setup (optional)

To add MIRA to a Teams channel (not just personal chat):

1. Open the target channel → **+** (Add a tab) or **…** → **Add apps**
2. Search "MIRA" → **Add**
3. Members can now `@MIRA` mention in the channel

---

## Environment Variables (for ops)

| Variable | Description | Example |
|----------|-------------|---------|
| `TEAMS_APP_ID` | Azure Bot app ID | `00000000-0000-...` |
| `TEAMS_APP_PASSWORD` | Bot client secret | (Doppler managed) |
| `TEAMS_PORT` | Bot server port | `8020` |
| `MIRA_TENANT_ID` | Customer tenant slug | `acme-widgets` |
| `OPENWEBUI_BASE_URL` | MIRA core URL | `http://mira-core:8080` |
| `MAX_VISION_PX` | Image resize limit | `512` |

All secrets managed via Doppler project `factorylm`, config `prd`.

---

## Updating the bot

To push a new version of the app manifest (e.g. new commands):

1. Increment `version` in `manifest.json`
2. Rebuild the zip: `cd mira-bots/teams/manifest && zip -r MIRA-teams-app.zip .`
3. In Teams Admin Center → **Manage apps** → find MIRA → **Update**
4. Upload the new zip

The bot server itself updates automatically via `docker compose pull && docker compose up -d`.
