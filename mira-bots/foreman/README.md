# FactoryLM Foreman - Fleet Orchestration Slack Bot

The Foreman is a distinct Slack bot that monitors `#factorylm-foreman` and orchestrates work across the MIRA fleet by launching cloud agents.

## Key Features

- **Distinct Bot Identity**: Posts as "FactoryLM Foreman" bot, not as a user
- **Infrastructure-Level Self-Echo Prevention**: Filters out its own messages by `bot_id` check
- **No Prefix Required**: Accepts normal human messages (no `FLEET:` prefix needed)
- **Thread Support**: Replies work in threads
- **Stay-Out Channels**: Respects `#cursor-enterprise` and other excluded channels
- **Dry-Run Mode**: Test without launching agents

## Architecture

```
Human Message → #factorylm-foreman
                    ↓
              Foreman Bot (listener)
                    ↓
              [Filter: bot_id check]
                    ↓
              Launch Cloud Agent (TODO)
                    ↓
              Agent Posts via Foreman Bot Identity
```

## Setup: Create the Slack App

### Step 1: Create a New Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name: `FactoryLM Foreman`
4. Workspace: Your FactoryLM workspace
5. Click "Create App"

### Step 2: Configure Bot Token Scopes

1. Navigate to **OAuth & Permissions**
2. Under **Bot Token Scopes**, add:
   - `channels:history` - Read messages in public channels
   - `channels:read` - View basic channel info
   - `chat:write` - Post messages
   - `groups:history` - Read messages in private channels (if needed)
   - `groups:read` - View private channel info (if needed)
   - `im:history` - Read DM messages (optional)
   - `im:read` - View DM info (optional)
   - `mpim:history` - Read group DM messages (optional)
   - `mpim:read` - View group DM info (optional)

### Step 3: Enable Socket Mode

1. Navigate to **Socket Mode** in the sidebar
2. Toggle "Enable Socket Mode" to **On**
3. Give it a token name: `Foreman Socket Token`
4. Click "Generate"
5. **Copy the `xapp-` token** - this is your `FOREMAN_SLACK_APP_TOKEN`

### Step 4: Enable Event Subscriptions

1. Navigate to **Event Subscriptions**
2. Toggle "Enable Events" to **On**
3. Under **Subscribe to bot events**, add:
   - `message.channels` - Listen to messages in channels
   - `message.groups` - Listen to messages in private channels (if needed)
   - `message.im` - Listen to DM messages (optional)
   - `message.mpim` - Listen to group DM messages (optional)
4. Click "Save Changes"

### Step 5: Install the App

1. Navigate to **OAuth & Permissions**
2. Click "Install to Workspace"
3. Review permissions and click "Allow"
4. **Copy the `xoxb-` token** - this is your `FOREMAN_SLACK_BOT_TOKEN`

### Step 6: Get the Bot User ID (Optional but Recommended)

1. In Slack, go to `#factorylm-foreman`
2. Type `/msg @FactoryLM Foreman` or mention the bot
3. Click on the bot's name to open its profile
4. Click the three dots (…) → "Copy member ID"
5. This is your `FOREMAN_SLACK_BOT_USER_ID` (format: `U0ABCDEF123`)

### Step 7: Invite the Bot to the Channel

1. In Slack, go to `#factorylm-foreman`
2. Type `/invite @FactoryLM Foreman`
3. The bot is now a member and can read/post messages

## Configuration

Set these environment variables (add to Doppler `factorylm/prd`):

```bash
# Required
FOREMAN_SLACK_BOT_TOKEN=xoxb-your-bot-token
FOREMAN_SLACK_APP_TOKEN=xapp-your-app-token

# Optional
FOREMAN_SLACK_BOT_USER_ID=U0ABCDEF123              # Bot's user ID for validation
FOREMAN_SLACK_CHANNEL=factorylm-foreman            # Channel to monitor (default)
FOREMAN_EXCLUDED_CHANNELS=cursor-enterprise        # Comma-separated stay-out channels
FOREMAN_DRY_RUN=0                                  # Set to 1 to test without launching agents
```

## Running the Bot

### Docker (Recommended)

```bash
# Build the image
docker build -t mira-foreman:latest -f mira-bots/foreman/Dockerfile mira-bots/foreman/

# Run with Doppler
doppler run --project factorylm --config prd -- \
  docker run --rm \
    -e FOREMAN_SLACK_BOT_TOKEN \
    -e FOREMAN_SLACK_APP_TOKEN \
    -e FOREMAN_SLACK_BOT_USER_ID \
    -e FOREMAN_SLACK_CHANNEL \
    -e FOREMAN_EXCLUDED_CHANNELS \
    -e FOREMAN_DRY_RUN \
    mira-foreman:latest
```

### Local (Development)

```bash
cd mira-bots/foreman
pip install -r requirements.txt
doppler run --project factorylm --config dev -- python bot.py
```

## Testing the Self-Echo Prevention

### Test 1: Human Message (Should Process)

1. In `#factorylm-foreman`, post: `Hello Foreman`
2. Expected: Foreman acknowledges the message
3. Logs: `decision=accepted reason=message_handler`

### Test 2: Foreman's Own Message (Should Ignore)

1. Foreman posts a message (via the bot)
2. The listener receives the event
3. Expected: Foreman ignores it (no reply)
4. Logs: `decision=ignored reason=bot_event`

### Test 3: Thread Reply (Should Work)

1. Post a message and start a thread
2. Foreman should reply in the thread
3. Expected: Thread reply works

### Test 4: Excluded Channel (Should Ignore)

1. Invite the bot to `#cursor-enterprise` (or another excluded channel)
2. Post a message there
3. Expected: Foreman ignores it
4. Logs: `decision=ignored reason=excluded_channel:cursor-enterprise`

## Proof Artifacts

### 1. Slack Identity Path

- **Bot App**: FactoryLM Foreman (created at api.slack.com/apps)
- **Bot Token**: `FOREMAN_SLACK_BOT_TOKEN` (xoxb- token, stored in Doppler)
- **App Token**: `FOREMAN_SLACK_APP_TOKEN` (xapp- token, stored in Doppler)
- **Bot User ID**: `FOREMAN_SLACK_BOT_USER_ID` (optional validation)

### 2. Message Authorship

- **Mike's messages**: Show Mike's name + avatar
- **Foreman's messages**: Show "FactoryLM Foreman" bot name + bot avatar (APP badge)

### 3. Self-Echo Prevention

- **Mechanism**: Line 172 in `bot.py`: `if event.get("bot_id"):`
- **NOT prompt-level**: No checking for "Sent using Cursor" text
- **Infrastructure-level**: Slack event filtering before orchestration

### 4. Thread Behavior

- **Function**: `_thread_ts(event)` extracts thread_ts
- **Reply**: `say(..., thread_ts=thread)` posts in the thread

### 5. Excluded Channels

- **Config**: `FOREMAN_EXCLUDED_CHANNELS=cursor-enterprise` (comma-separated)
- **Filter**: Lines 183-194 in `bot.py`

## Integration with Cloud Agents (TODO)

The `handle_message` function currently has a TODO to launch cloud agents. The integration will:

1. **Receive human message** in `#factorylm-foreman`
2. **Launch cloud agent** (via Cursor API or fleet-gateway MCP)
3. **Cloud agent posts back** using:
   - **Option A**: Slack MCP server with Foreman bot credentials
   - **Option B**: Direct Slack API call with `FOREMAN_SLACK_BOT_TOKEN`

The key is that the cloud agent MUST post using the Foreman bot token, NOT the Cursor Slack Tools (which post as the user).

## Known Limitations

1. **Cloud Agent Integration Not Wired**: The bot currently just acknowledges messages. The actual cloud agent launching is a TODO.
2. **No Retry Logic**: If Slack API fails, the message is dropped (add retry for prod).
3. **No Rate Limiting**: If flooded with messages, the bot may hit Slack rate limits.
4. **No Persistence**: Bot state (seen_events) is in-memory and lost on restart.

## Next Steps

1. Wire cloud agent launching (via Cursor API or fleet-gateway MCP)
2. Configure cloud agents to post using the Foreman bot identity
3. Add retry/backoff for Slack API calls
4. Add rate limiting for message processing
5. Add persistent dedup (Redis/DB instead of in-memory set)
6. Add monitoring/alerting for bot health

## References

- Slack Bolt framework: https://slack.dev/bolt-python/
- Socket Mode: https://api.slack.com/apis/connections/socket
- Event types: https://api.slack.com/events
