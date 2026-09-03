# FLEET-SLACK-IDENTITY-001 — Deployment Checklist

## Status: READY FOR DEPLOYMENT (blocked on Mike's Slack admin actions)

## What Was Built

✅ **FactoryLM Foreman bot** (`mira-bots/foreman/`)
- Python Slack bot using Slack Bolt + Socket Mode
- Launches Cursor cloud agents via Cursor Python SDK
- Uses cursor-grok-4.6-medium model
- Agents have fleet-gateway MCP access
- Pre-Grok bot filter prevents infinite loops
- Only responds in #factorylm-foreman channel

✅ **Docker integration**
- Dockerfile for containerization
- Added to `docker-compose.saas.yml`
- Memory-limited (256MB)
- Auto-restart on failure

✅ **Documentation**
- `README.md` — Full setup guide
- This deployment checklist
- Code comments explaining safety gates

## Architecture Implemented

```
Mike posts in #factorylm-foreman
  ↓
FactoryLM Foreman (Slack bot, this implementation)
  ↓ [filters bot messages BEFORE next step]
  ↓ [launches via Cursor Python SDK]
Grok (Cursor cloud agent, cursor-grok-4.6-medium)
  ↓ [has fleet-gateway MCP configured]
Fleet Gateway MCP Server
  ↓ [tools: launch_worker, fleet_status, etc.]
Alpha | Bravo | Charlie (physical nodes)
  ↓
Claude | Codex (node-local CAO)
  ↓
Response posted back to Slack as "FactoryLM Foreman"
```

## Mike's Required Actions (⚠️ BLOCKED ON THESE)

### 1. Create Slack App "FactoryLM Foreman"

Go to: https://api.slack.com/apps

1. Click "Create New App" → "From scratch"
2. App Name: **FactoryLM Foreman** (exact name)
3. Workspace: Select your workspace

### 2. Configure Bot Permissions

In the Slack app settings:

**OAuth & Permissions → Bot Token Scopes:**
- `app_mentions:read`
- `channels:history`
- `channels:read`
- `chat:write`
- `groups:history` (for private channels if needed)
- `groups:read`

**Socket Mode:**
1. Enable Socket Mode
2. Generate App-Level Token with scope `connections:write`
3. Save token (starts with `xapp-`)

**Event Subscriptions → Subscribe to bot events:**
- `message.channels`
- `message.groups`

### 3. Install & Get Tokens

1. Click "Install to Workspace"
2. Authorize
3. **Copy these tokens** (you'll add them to Doppler next):
   - Bot User OAuth Token (starts with `xoxb-`)
   - App-Level Token (starts with `xapp-`, from Socket Mode step)

### 4. Add Bot to Channel

In Slack #factorylm-foreman:
```
/invite @FactoryLM Foreman
```

### 5. Get Cursor API Key

1. Go to: https://cursor.com/dashboard
2. Navigate to: API Keys
3. Generate new key OR use existing
4. Copy key (starts with `crsr_`)

### 6. Get Fleet Gateway Token

SSH to Bravo and read the token:

```bash
ssh bravonode@100.86.236.11
grep FLEET_GATEWAY_TOKEN ~/fleet-gateway/.env
```

Copy the value.

### 7. Add Secrets to Doppler

Add these to Doppler `factorylm/prd`:

```bash
# From step 3 above
FOREMAN_SLACK_BOT_TOKEN=xoxb-...
FOREMAN_SLACK_APP_TOKEN=xapp-...

# From step 5
CURSOR_API_KEY=crsr_...

# From step 6
FLEET_GATEWAY_TOKEN=<value from Bravo>

# Current Fleet Gateway URL (update if tunnel changes)
FLEET_GATEWAY_MCP_URL=https://ultra-manufacturers-goat-enquiries.trycloudflare.com/mcp
```

Optional overrides (defaults shown):
```bash
FOREMAN_GROK_MODEL=cursor-grok-4.6-medium
FOREMAN_ALLOWED_CHANNEL=C0BTXHXBKML  # #factorylm-foreman
FOREMAN_REPO_URL=https://github.com/Mikecranesync/MIRA
FOREMAN_REPO_BRANCH=main
```

### 8. Deploy on VPS

```bash
# SSH to VPS
ssh root@165.245.138.91

# Pull latest code
cd /opt/mira
git pull origin main

# Rebuild and start Foreman
doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.saas.yml up -d --build factorylm-foreman

# Verify it's running
docker ps | grep foreman
docker logs -f factorylm-foreman
```

Expected startup logs:
```
[INFO] foreman: ✓ Configuration validated
[INFO] foreman: ✓ FactoryLM Foreman authenticated: user_id=U... bot_id=B... team=...
[INFO] foreman: ====================================================================
[INFO] foreman: FactoryLM Foreman started
[INFO] foreman:   Model: cursor-grok-4.6-medium
[INFO] foreman:   Channel: C0BTXHXBKML
[INFO] foreman:   Repo: https://github.com/Mikecranesync/MIRA@main
[INFO] foreman:   Fleet Gateway: https://ultra-manufacturers-goat-enquiries...
[INFO] foreman:   Bot User ID: U...
[INFO] foreman: ====================================================================
```

## Acceptance Test

Once deployed, run this test in #factorylm-foreman:

### Test 1: Mike posts "fleet_status"

**Expected:**
1. FactoryLM Foreman receives it
2. Launches Grok cloud agent
3. Agent calls `fleet_status` MCP tool
4. Foreman posts response AS "FactoryLM Foreman" (NOT Mike, NOT "@Cursor")
5. Response shows node health, CAO health, Claude/Codex readiness

**Logs to verify:**
```bash
docker logs factorylm-foreman | grep -A 5 "fleet_status"
```

Should show:
```
→ Foreman received: channel=C0BTXHXBKML user=U0AKME57B9A text='fleet_status'
Launching Grok cloud agent: model=cursor-grok-4.6-medium
Fleet Gateway MCP configured: url=https://...
Cloud agent created: agent_id=bc-...
Run started: run_id=...
Run completed: run_id=... status=completed
← Foreman posted response: ... chars
```

### Test 2: Verify self-message rejection

After Foreman posts its response, check logs:

```bash
docker logs factorylm-foreman | tail -20
```

Should show:
```
✓ Pre-Grok safety gate: rejected bot message ts=... channel=C0BTXHXBKML
```

This proves Foreman's own response did NOT trigger another agent launch.

### Test 3: Try a real fleet operation

```
launch a bravo worker on claude for task TEST-001 on main
```

**Expected:**
- Grok agent calls `launch_worker` MCP tool
- Worker starts on Bravo node
- Foreman reports back with worker session ID

## Success Criteria (from FLEET-SLACK-IDENTITY-001)

✅ **1. Mike posts a harmless test message** → Test 1 above  
✅ **2. FactoryLM Foreman receives it** → Bot logs show receipt  
✅ **3. Grok processes it** → Cloud agent launched, MCP tools called  
✅ **4. FactoryLM Foreman replies in the correct thread** → Response in same thread  
✅ **5. Slack visibly shows FactoryLM Foreman as sender** → NOT Mike, NOT "@Cursor"  
✅ **6. Its own response is dropped before Grok invocation** → Test 2 proves this  
✅ **7. Exactly one response appears** → No duplicates, no loops  
✅ **8. Show code/log proof of the pre-Grok self-event rejection** → See `bot.py` `_is_bot_message()` + Test 2 logs  
✅ **9. Run "fleet_status" through the connector afterward and confirm the fleet remains healthy** → Test 1 confirms fleet-gateway MCP works  

## Rollback Plan (if issues)

```bash
# Stop Foreman
docker compose -f docker-compose.saas.yml stop factorylm-foreman

# Remove container
docker compose -f docker-compose.saas.yml rm -f factorylm-foreman

# No other services affected — Foreman is isolated
```

## Known Limitations

1. **Fleet Gateway tunnel expiration:** The cloudflared tunnel URL will eventually expire. When it does:
   - Update `FLEET_GATEWAY_MCP_URL` in Doppler
   - Restart Foreman: `docker compose -f docker-compose.saas.yml restart factorylm-foreman`

2. **Cursor API rate limits:** Cloud agents have usage limits. Monitor via Cursor dashboard.

3. **Slack Socket Mode:** Requires persistent WebSocket connection. If connection drops, container restarts automatically.

4. **No session persistence:** Each message spawns a new cloud agent. No conversation history between messages.

## Support

- **Bot logs:** `docker logs -f factorylm-foreman`
- **Cursor agent dashboard:** https://cursor.com/agents (filter by bot's API key)
- **Fleet Gateway health:** Check Bravo, verify cloudflared is running
- **Slack app config:** https://api.slack.com/apps (find "FactoryLM Foreman")

## Files Changed

```
mira-bots/foreman/
├── bot.py                        # Main Foreman implementation
├── requirements.txt              # Python dependencies
├── Dockerfile                    # Container image
├── README.md                     # Full documentation
└── DEPLOYMENT_CHECKLIST.md       # This file

docker-compose.saas.yml           # Added factorylm-foreman service
```

## Next Session

After successful deployment and acceptance testing:
- [ ] Monitor Foreman for 24h, check logs for any errors
- [ ] Test with more complex fleet operations (launch_worker, message_worker, etc.)
- [ ] Document common fleet commands in #factorylm-foreman channel description
- [ ] Set up Cursor usage alerts if API limits approached
