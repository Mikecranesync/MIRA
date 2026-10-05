# FactoryLM Foreman — Fleet Orchestration Bot

**Identity:** FactoryLM Foreman  
**Purpose:** Slack bot for orchestrating fleet operations via Grok + Fleet Gateway MCP  
**Channel:** #factorylm-foreman  

## Architecture

```
Mike
  ↓ (Slack message in #factorylm-foreman)
FactoryLM Foreman (this bot)
  ↓ (reuses warm Grok session)
Grok (Cursor cloud agent, grok-4.6 model)
  ↓ (calls MCP tools, retains conversation context)
Fleet Gateway MCP Server
  ↓ (dispatches to physical nodes)
Alpha | Bravo | Charlie
  ↓ (node-local CAO)
Claude | Codex
```

**Standing Grok specialist:** [Repo Archaeologist](../../.claude/agents/repo-archaeologist.md) — read-only, search-before-create, used constantly by Foreman / Answer Radar. Not a Slack bot and not a Gateway node. Skill: `.claude/skills/repo-archaeologist/`.

### Warm Session Management

- **One agent, many messages:** Foreman creates a single Cursor cloud agent on the first accepted message, then reuses it for subsequent messages
- **Conversation context:** Grok retains conversation history across messages (per Cursor SDK design)
- **Recovery:** If the agent dies (network error, timeout, etc.), the next message automatically creates a new agent
- **Clean shutdown:** On exit, Foreman tears down the warm agent gracefully (no leaks)

## Safety Guarantees

1. **Pre-Grok bot filter:** ALL bot messages (including Foreman's own) are rejected BEFORE invoking the cloud agent
2. **No infinite loops:** Foreman cannot trigger itself
3. **Proof:** See `_is_bot_message()` in `bot.py` — checks `bot_id`, `user == bot_user_id`, and bot subtypes
4. **Channel isolation:** Only responds in #factorylm-foreman (configurable via `FOREMAN_ALLOWED_CHANNEL`)

## Prerequisites

### 1. Create Slack App "FactoryLM Foreman"

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. App Name: **FactoryLM Foreman**
4. Workspace: Select your workspace

### 2. Configure Bot Permissions

In the Slack app settings:

**OAuth & Permissions:**
- Add Bot Token Scopes:
  - `app_mentions:read`
  - `channels:history`
  - `channels:read`
  - `chat:write`
  - `groups:history` (for private channels)
  - `groups:read`

**Socket Mode:**
- Enable Socket Mode
- Generate App-Level Token with scope `connections:write`
- Save the token (starts with `xapp-`)

**Event Subscriptions:**
- Subscribe to bot events:
  - `message.channels`
  - `message.groups`

### 3. Install to Workspace

1. Click "Install to Workspace" in the Slack app settings
2. Authorize the requested permissions
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### 4. Add Bot to Channel

In Slack:
1. Navigate to #factorylm-foreman
2. Type: `/invite @FactoryLM Foreman`

### 5. Get Cursor API Key

1. Go to https://cursor.com/dashboard
2. Navigate to API Keys
3. Generate a new key (or use existing)
4. Copy the key (starts with `crsr_`)

### 6. Get Fleet Gateway MCP Token

The Fleet Gateway bearer token is on Bravo in the Gateway's `.env` file:

```bash
# SSH to Bravo
ssh bravonode@100.86.236.11

# Read the token
grep FLEET_GATEWAY_TOKEN ~/fleet-gateway/.env
```

## Configuration (Doppler or .env)

Add these secrets to Doppler `factorylm/prd` or create `.env`:

```bash
# Slack tokens (from steps 2-3 above)
# Bot token: prefers FOREMAN_BOT_SLACK_TOKEN, falls back to FOREMAN_SLACK_BOT_TOKEN
FOREMAN_BOT_SLACK_TOKEN=xoxb-...
FOREMAN_SLACK_APP_TOKEN=xapp-...

# Cursor API key (from step 5)
# Prefers CURSOR_API_KEY, falls back to CURSOR_API
CURSOR_API_KEY=crsr_...

# Fleet Gateway MCP
FLEET_GATEWAY_MCP_URL=https://ultra-manufacturers-goat-enquiries.trycloudflare.com/mcp
# Gateway token: prefers FLEET_GATEWAY_TOKEN, falls back to FLEET_GATEWAY_BEARER
FLEET_GATEWAY_TOKEN=<from Bravo .env>

# Optional: Override defaults
FOREMAN_GROK_MODEL=grok-4.6  # live-proven Cursor id; not cursor-grok-4.6-medium
FOREMAN_ALLOWED_CHANNEL=C0BTXHXBKML        # #factorylm-foreman
FOREMAN_REPO_URL=https://github.com/Mikecranesync/MIRA
FOREMAN_REPO_BRANCH=main
```

**Environment Variable Aliases:**
- **Slack bot token:** `FOREMAN_BOT_SLACK_TOKEN` (preferred) or `FOREMAN_SLACK_BOT_TOKEN` (fallback)
- **Cursor API key:** `CURSOR_API_KEY` (preferred) or `CURSOR_API` (fallback, current Doppler name)
- **Fleet Gateway token:** `FLEET_GATEWAY_TOKEN` (preferred) or `FLEET_GATEWAY_BEARER` (fallback, live Gateway worktree)

## Running

### Local (development)

```bash
cd mira-bots/foreman
pip install -r requirements.txt

# Export secrets (using preferred Doppler names)
export FOREMAN_BOT_SLACK_TOKEN="xoxb-..."
export FOREMAN_SLACK_APP_TOKEN="xapp-..."
export CURSOR_API_KEY="crsr_..."
export FLEET_GATEWAY_MCP_URL="https://..."
export FLEET_GATEWAY_TOKEN="..."

python bot.py
```

### Docker

```bash
cd mira-bots/foreman
docker build -t factorylm-foreman .

docker run -d \
  --name foreman \
  --restart unless-stopped \
  -e FOREMAN_BOT_SLACK_TOKEN="xoxb-..." \
  -e FOREMAN_SLACK_APP_TOKEN="xapp-..." \
  -e CURSOR_API_KEY="crsr_..." \
  -e FLEET_GATEWAY_MCP_URL="https://..." \
  -e FLEET_GATEWAY_TOKEN="..." \
  factorylm-foreman
```

### Docker Compose (recommended)

Add to `docker-compose.saas.yml`:

```yaml
  factorylm-foreman:
    build:
      context: ./mira-bots/foreman
      dockerfile: Dockerfile
    container_name: factorylm-foreman
    restart: unless-stopped
    environment:
      - FOREMAN_BOT_SLACK_TOKEN=${FOREMAN_BOT_SLACK_TOKEN}
      - FOREMAN_SLACK_APP_TOKEN=${FOREMAN_SLACK_APP_TOKEN}
      - CURSOR_API_KEY=${CURSOR_API_KEY}
      - FLEET_GATEWAY_MCP_URL=${FLEET_GATEWAY_MCP_URL}
      - FLEET_GATEWAY_TOKEN=${FLEET_GATEWAY_TOKEN}
      - FOREMAN_GROK_MODEL=${FOREMAN_GROK_MODEL:-grok-4.6}
      - FOREMAN_ALLOWED_CHANNEL=${FOREMAN_ALLOWED_CHANNEL:-C0BTXHXBKML}
      - FOREMAN_REPO_URL=${FOREMAN_REPO_URL:-https://github.com/Mikecranesync/MIRA}
      - FOREMAN_REPO_BRANCH=${FOREMAN_REPO_BRANCH:-main}
    networks:
      - mira-net
```

Then:

```bash
doppler run --project factorylm --config prd -- docker compose -f docker-compose.saas.yml up -d factorylm-foreman
```

## Acceptance Test

Once running, test the full path:

### 1. Mike posts in #factorylm-foreman

```
fleet_status
```

### 2. FactoryLM Foreman receives it

Bot logs show:
```
→ Foreman received: channel=C0BTXHXBKML user=U0AKME57B9A text='fleet_status'
Launching Grok cloud agent: model=grok-4.6
Cloud agent created: agent_id=bc-...
```

### 3. Grok processes via Fleet Gateway MCP

Agent calls `fleet_status` tool, gets:
```json
{
  "node_health": "ok",
  "cao_health": "ok",
  "claude_readiness": "ready",
  "codex_readiness": "ready"
}
```

### 4. FactoryLM Foreman replies

Slack shows message FROM "FactoryLM Foreman" (NOT Mike, NOT "Sent using @Cursor"):
```
Node Health: OK
CAO Health: OK
Claude: Ready
Codex: Ready
```

### 5. Foreman's reply does NOT trigger another agent

Bot logs show:
```
✓ Pre-Grok safety gate: rejected bot message ts=1725345678.123456
```

## Verification Checklist

- [ ] Slack app "FactoryLM Foreman" created
- [ ] Bot added to #factorylm-foreman
- [ ] `FOREMAN_BOT_SLACK_TOKEN` and `FOREMAN_SLACK_APP_TOKEN` in Doppler
- [ ] `CURSOR_API_KEY` (or `CURSOR_API`) in Doppler
- [ ] `FLEET_GATEWAY_TOKEN` from Bravo `.env` added to Doppler
- [ ] Container running: `docker ps | grep foreman`
- [ ] Logs healthy: `docker logs -f factorylm-foreman`
- [ ] Mike posts "fleet_status" in #factorylm-foreman
- [ ] FactoryLM Foreman replies (visible sender is the bot, not Mike)
- [ ] No "Sent using @Cursor" footer
- [ ] Bot's own reply does NOT trigger another agent (check logs for "Pre-Grok safety gate")
- [ ] `fleet_status` MCP call succeeds: `docker logs factorylm-foreman | grep fleet_status`

## Troubleshooting

### Bot doesn't respond

1. Check logs: `docker logs -f factorylm-foreman`
2. Verify tokens: `docker exec factorylm-foreman env | grep FOREMAN`
3. Verify bot is in channel: `/invite @FactoryLM Foreman` in #factorylm-foreman
4. Check Slack app settings: Socket Mode enabled, event subscriptions active

### "Pre-Grok safety gate" rejects user messages

Check `bot_user_id` in logs. If it's empty or wrong:
1. Bot failed `auth_test` during startup
2. Check `FOREMAN_SLACK_BOT_TOKEN` is valid

### Fleet Gateway MCP calls fail

1. Check Gateway is running on Bravo: `ssh bravonode@100.86.236.11 'curl http://localhost:5000/health'`
2. Check cloudflared tunnel is alive: `ssh bravonode@100.86.236.11 'pgrep cloudflared'`
3. Test MCP endpoint: `curl -H "Authorization: Bearer $FLEET_GATEWAY_TOKEN" $FLEET_GATEWAY_MCP_URL`
4. Check `FLEET_GATEWAY_TOKEN` matches Bravo's `.env`

### Agent launches but MCP tools not available

Verify `mcp_servers` on `AgentOptions` (not `CloudAgentOptions`) in agent launch:
- Check bot logs for "Fleet Gateway MCP configured"
- If missing, check `FLEET_GATEWAY_MCP_URL` and `FLEET_GATEWAY_TOKEN` are set
- Test agent manually via Cursor SDK to verify MCP config

## Code Proof — Self-Event Rejection

The CRITICAL safety gate is in `bot.py`, method `_is_bot_message()`:

```python
def _is_bot_message(self, event: dict[str, Any]) -> bool:
    """Return True if this event is from ANY bot (including Foreman itself)."""
    
    # Check 1: Explicit bot_id field
    if event.get("bot_id"):
        logger.debug("Rejecting bot message (bot_id=%s)", event.get("bot_id"))
        return True

    # Check 2: Message from Foreman's own user_id
    if event.get("user") == self.config.bot_user_id:
        logger.debug("Rejecting own message (user=%s)", event.get("user"))
        return True

    # Check 3: Bot message subtypes
    if event.get("subtype") in {"bot_message", "message_changed", "message_deleted"}:
        logger.debug("Rejecting subtype=%s", event.get("subtype"))
        return True

    return False
```

This runs BEFORE `_invoke_grok()` is called. If it returns `True`, the event is logged and dropped:

```python
if self._is_bot_message(event):
    logger.info("✓ Pre-Grok safety gate: rejected bot message ts=%s", ts)
    return  # <-- Agent is NEVER launched
```

**Proof in logs:**

```
2026-09-03 05:25:12 [INFO] foreman: → Foreman received: channel=C0BTXHXBKML user=U0AKME57B9A text='fleet_status'
2026-09-03 05:25:13 [INFO] foreman: Launching Grok cloud agent: model=grok-4.6
2026-09-03 05:25:20 [INFO] foreman: ← Foreman posted response: 142 chars
2026-09-03 05:25:20 [INFO] foreman: ✓ Pre-Grok safety gate: rejected bot message ts=1725345920.123456 channel=C0BTXHXBKML
```

The second message (Foreman's own reply) is rejected BEFORE any agent launch attempt.

## Autonomous Management Loop (Mission Policy)

The Foreman management loop is encoded as pure, offline-testable policy in
`mission_loop.py`. No Slack Socket, no Doppler, no Gateway HTTP is required
to run or test the policy.

Key guarantees (AC A–H, issue #3566):
- Manager ≠ implementer — `ForemanPolicy` has no `open_worktree`, `edit_file`, or `commit`
- Max one implementer worker at a time
- Charlie/Codex reviewer requires an exact 40-char commit SHA
- `can_merge()` and `can_deploy()` always return `allowed=False`
- PRs #3533 and #3558 (and any HELD-titled PR) are refused by `can_touch_pr()`
- Hard-boundary actions (gateway, tunnels, Doppler, secrets) are refused by `validate_action()`
- `MissionState` round-trips to JSON for durable GitHub storage
- `evaluate_go_no_go()` returns exactly `"GO"` or `"NO-GO"` with human gates

Tests: `python3.12 -m pytest mira-bots/foreman/test_mission_loop.py -v` (73 tests)

Mission spec: `docs/missions/AUTONOMOUS-FOREMAN-V1.md`

## Support

- **Logs:** `docker logs -f factorylm-foreman`
- **Slack:** #factorylm-foreman
- **Fleet Gateway health:** `curl -H "Authorization: Bearer $FLEET_GATEWAY_TOKEN" $FLEET_GATEWAY_MCP_URL/../health` (if Gateway exposes `/health`)
- **Cursor agent dashboard:** https://cursor.com/agents
