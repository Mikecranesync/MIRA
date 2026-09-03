# Cloud Agent Integration with Foreman Bot Identity

This document explains how cloud agents launched by the Foreman should post back to Slack using the Foreman bot identity (not the user's identity).

## Problem Statement

**Before (Self-Echo Loop)**:
```
Human message → #factorylm-foreman
    ↓
Cursor Cloud Agent launched
    ↓
Cloud Agent posts using Mike's identity (via Cursor Slack Tools)
    ↓
Listener sees "Mike's message" → Launches ANOTHER agent
    ↓
Infinite loop
```

**After (Infrastructure-Level Prevention)**:
```
Human message → #factorylm-foreman
    ↓
Foreman Bot (listener with bot_id check) → Launches Cloud Agent
    ↓
Cloud Agent posts using Foreman Bot identity
    ↓
Listener sees bot_id → Ignores (no loop)
```

## Solution: Post as the Foreman Bot

When a cloud agent needs to post back to Slack, it MUST use the Foreman bot's credentials, NOT the Cursor Slack Tools (which post as the user).

### Option A: Direct Slack API Call (Recommended)

The cloud agent makes a direct HTTP POST to the Slack API using the Foreman bot token.

**Python Example**:
```python
import httpx
import os

async def post_as_foreman(channel: str, text: str, thread_ts: str | None = None):
    """Post a message to Slack as the Foreman bot."""
    foreman_token = os.getenv("FOREMAN_SLACK_BOT_TOKEN")
    if not foreman_token:
        raise ValueError("FOREMAN_SLACK_BOT_TOKEN not set")
    
    url = "https://slack.com/api/chat.postMessage"
    headers = {
        "Authorization": f"Bearer {foreman_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "channel": channel,
        "text": text,
    }
    if thread_ts:
        payload["thread_ts"] = thread_ts
    
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        if not data.get("ok"):
            raise RuntimeError(f"Slack API error: {data.get('error')}")
        return data
```

**Usage**:
```python
# Post a message
await post_as_foreman(
    channel="C0BTXHXBKML",  # #factorylm-foreman
    text="Task complete: PR #1234 is ready for review",
)

# Reply in a thread
await post_as_foreman(
    channel="C0BTXHXBKML",
    text="Additional details here",
    thread_ts="1234567890.123456",  # Parent message timestamp
)
```

### Option B: Slack MCP Server (If Configured)

If the Slack MCP server is configured with the Foreman bot's credentials, you can use `slack_send_message`.

**Prerequisites**:
- Slack MCP server must be configured with `FOREMAN_SLACK_BOT_TOKEN`
- Namespace must be accessible to the cloud agent

**Usage**:
```python
from mcp import CallDynamicTool

await CallDynamicTool(
    namespace="Slack",
    toolName="slack_send_message",
    arguments={
        "channel_id": "C0BTXHXBKML",
        "message": "Task complete: PR #1234 is ready for review",
    },
)
```

### Option C: Cursor Slack Tools (NOT RECOMMENDED)

❌ **DO NOT USE** `send_slack_message` from "Cursor Slack Tools" - it posts as the user (Mike), not as the Foreman bot.

This is what we're trying to AVOID:
```python
# ❌ WRONG - Posts as Mike, triggers self-echo loop
await CallDynamicTool(
    namespace="Cursor Slack Tools",
    toolName="send_slack_message",
    arguments={"message": "..."},
)
```

## Environment Variables

Cloud agents need access to the Foreman bot token:

```bash
# Add to Doppler factorylm/prd or pass to the cloud agent
FOREMAN_SLACK_BOT_TOKEN=xoxb-your-bot-token
```

## Verifying the Message Author

After posting, verify the message appears with the Foreman bot identity:

1. **In Slack UI**: The message should show:
   - Name: "FactoryLM Foreman"
   - Badge: "APP" (bot indicator)
   - Avatar: Foreman bot avatar (not Mike's)

2. **Via API**: Call `conversations.history` and check:
   ```json
   {
     "bot_id": "B0ABCDEF123",
     "username": "FactoryLM Foreman",
     "app_id": "A0ABCDEF123"
   }
   ```

3. **Listener Logs**: The Foreman listener should show:
   ```
   decision=ignored reason=bot_event
   ```

## Testing the Integration

### Test 1: Cloud Agent Posts as Foreman

1. Launch a cloud agent (manually or via the Foreman listener)
2. Have it post a message using Option A (direct API call)
3. Check Slack UI: message should show "FactoryLM Foreman" as author
4. Check Foreman logs: `decision=ignored reason=bot_event`

### Test 2: No Self-Echo Loop

1. Post a message to #factorylm-foreman as a human
2. Foreman launches a cloud agent
3. Cloud agent posts back as Foreman bot
4. Verify: NO second cloud agent is launched
5. Foreman logs should show only ONE `decision=accepted` (for the human message)

### Test 3: Thread Replies

1. Post a message and start a thread
2. Cloud agent replies in the thread using `thread_ts`
3. Verify: Reply appears in the thread as Foreman bot
4. Verify: No self-echo

## Integration Checklist

- [ ] Cloud agent has access to `FOREMAN_SLACK_BOT_TOKEN`
- [ ] Cloud agent uses Option A (direct API) or Option B (Slack MCP)
- [ ] Cloud agent does NOT use Cursor Slack Tools for Foreman messages
- [ ] Test: Human message → agent posts → no self-echo
- [ ] Test: Thread replies work
- [ ] Test: Foreman bot identity appears in Slack UI
- [ ] Logs: `decision=ignored reason=bot_event` for Foreman's messages
- [ ] Logs: `decision=accepted` only for human messages

## Common Issues

### Issue: "Invalid token" error

**Cause**: Cloud agent doesn't have access to `FOREMAN_SLACK_BOT_TOKEN`

**Fix**: Add the token to Doppler or pass it via environment variables

### Issue: Message still shows as Mike

**Cause**: Cloud agent is using Cursor Slack Tools instead of Foreman bot token

**Fix**: Use Option A (direct API) with `FOREMAN_SLACK_BOT_TOKEN`

### Issue: Self-echo loop still happening

**Cause**: Cloud agent is not posting with the Foreman bot identity

**Fix**: Verify the message has a `bot_id` field (check via API or logs)

## Next Steps

1. **Wire cloud agent launching**: Modify `foreman/bot.py` `handle_message` to launch cloud agents
2. **Pass Foreman token to agents**: Ensure agents have `FOREMAN_SLACK_BOT_TOKEN` in their environment
3. **Update agent code**: Replace Cursor Slack Tools with direct API calls (Option A)
4. **Test end-to-end**: Human message → agent → Foreman bot reply → no loop
5. **Monitor**: Check Foreman logs for `decision=ignored reason=bot_event`

## References

- Slack API: https://api.slack.com/methods/chat.postMessage
- Bot tokens: https://api.slack.com/authentication/token-types#bot
- Socket Mode: https://api.slack.com/apis/connections/socket
