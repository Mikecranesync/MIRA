# Open WebUI — Role Hierarchy & Access Control

## Role Hierarchy

| Role | Access | How to get it |
|------|--------|---------------|
| `admin` | Full — models, users, settings, KB | First registered user (automatic), or promoted by another admin |
| `user` | Chat, KB, Tools | Promoted from `pending` by admin |
| `pending` | Login only — no chat | All new self-registered accounts start here |

## Current Configuration

`DEFAULT_USER_ROLE=pending` is already set in `docker-compose.yml` (mira-core service env block).

This means every new account must be manually approved — no open signup.

## Promoting a user

### Option A — Admin UI
1. Log in as admin → click avatar → **Admin Panel**
2. Go to **Users** → find the pending user
3. Click their role badge → change from **pending** to **user** or **admin**
4. User can now chat immediately

### Option B — API
```bash
# Get user list (replace token)
curl -s http://localhost:3000/api/v1/users \
  -H "Authorization: Bearer $OPENWEBUI_API_KEY" | jq '.[].role, .[].email'

# Promote user (replace <user_id> and token)
curl -s -X POST http://localhost:3000/api/v1/users/<user_id>/update \
  -H "Authorization: Bearer $OPENWEBUI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"role": "user"}'
```

## Adding an admin

Promote a user to `admin` via the Admin Panel UI, or via API with `"role": "admin"`.
Only do this for trusted users — admins can delete the KB, modify system prompts, and see all conversations.

## Notes

- The MIRA bot adapters (Telegram, Slack) do NOT go through Open WebUI auth — they call the pipeline API directly (`mira-pipeline :9099`).
- Open WebUI is only used for internal browser-based chat (staff, testing).
- Disabling self-registration entirely is not natively supported in Open WebUI, but `DEFAULT_USER_ROLE=pending` achieves the same effect since pending users cannot chat.
