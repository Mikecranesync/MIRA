# Slack Production System Map

Last verified: 2026-07-19 from CHARLIE Slack desktop, production Doppler `factorylm/prd`, and the repo deploy contracts.

## Canonical Production Target

Production Slack should line up around one app install:

| Item | Canonical value |
|---|---|
| Workspace | `FactoryLM` |
| Workspace URL | `https://factorylm.slack.com/` |
| Team ID | `T0AK2CU16T1` |
| App/bot display | `FactoryLM` |
| Slack API username | `factorylm` |
| Bot user ID | `U0AM3EZBSNQ` |
| Bot ID | `B0ALXRE4CDU` |
| Primary production channel | `#all-factorylm` |
| Primary channel ID | `C0AKBEL8C4T` |
| Runtime service | `mira-bot-slack` |
| Secret source | Doppler `factorylm/prd` |

Do not use the `MIRA` workspace app `mira-maintenance-agent (local)` as the production acceptance target. It is a visible local/dev install in the separate `mira-gaq9414.slack.com` workspace, not the app authenticated by the current production `SLACK_BOT_TOKEN`.

## Slack UI Inventory

| Workspace | URL / team ID | Visible Slack surfaces | Production role |
|---|---|---|---|
| `FactoryLM` | `factorylm.slack.com` / `T0AK2CU16T1` | `#all-factorylm`; app/agent named `FactoryLM` has posted there. | Canonical production workspace. |
| `MIRA` | `mira-gaq9414.slack.com` / `T0B4021LFNV` | `#all-mira`, `#new-channel`; app `mira-maintenance-agent (local)` with service/config link `B0B4SPJ2D08`; DM `D0B3YF4DU1Y`. | Local/dev/stale production-candidate workspace. Do not use for prod acceptance unless production tokens are intentionally moved there. |
| `Catapult Lakeland` | `catapult-lakeland.slack.com` / `THK1KCUB0` | Community channels such as `#community_forum` and `#help-wanted-needed`; no FactoryLM/MIRA app visible. | External/community workspace. Not a production target. |

Chrome/admin caveat: the current browser Slack context redirected to `cranesync.slack.com/ssb/redirect` when opening the MIRA app configuration link. Operator app-dashboard checks must verify the workspace in the browser before changing app settings.

## Production API Inventory

Redaction-safe `auth.test` under Doppler `factorylm/prd` returned:

```json
{"bot_id":"B0ALXRE4CDU","ok":true,"team":"FactoryLM","team_id":"T0AK2CU16T1","url":"https://factorylm.slack.com/","user":"factorylm","user_id":"U0AM3EZBSNQ"}
```

The production bot token can list public channels and shows:

| Channel | ID | Bot member? | Notes |
|---|---:|---:|---|
| `#all-factorylm` | `C0AKBEL8C4T` | yes | Production human-test channel. |
| `#new-channel` | `C0AKEDNRHFX` | no | Public channel, not in current bot membership. |
| `#social` | `C0AKWPKB51P` | no | Public channel, not in current bot membership. |

`users.conversations` for public channels returns only `#all-factorylm` for the production bot. Full private-channel and bot-profile inventory is blocked by the current app scopes: `users.info` and `bots.info` need `users:read`; private channel inventory needs `groups:read`.

## Repo Slack Approaches

| Approach | Files | Current production state |
|---|---|---|
| Socket Mode technician bot | `mira-bots/slack/bot.py`, `mira-bots/slack/chat_adapter.py`, `mira-bots/slack/doctor.py`, `docker-compose.saas.yml` | Active production path. Requires `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`. Runs as `mira-bot-slack`. |
| Hub Slack connector | `mira-hub/src/app/api/auth/slack/route.ts`, `mira-hub/src/app/api/auth/slack/callback/route.ts`, `docker-compose.hub.yml`, `docker-compose.saas.yml` | Bot-token shortcut can mark FactoryLM connected when `SLACK_CLIENT_ID` is unset. Full OAuth is inactive until `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` are configured. |
| Scheduled Slack webhooks | `mira-bridge/flows/mira-scheduled-tasks.json` | Defined, but inactive in prod because `SLACK_WEBHOOK_URL` is unset in `factorylm/prd`. |
| Slack dashboard/manual config | Slack app admin UI | Hand-configured. No canonical Slack app manifest is checked in for this production app. |
| Product/spec surface | `docs/specs/mira-bots-spec.md`, `docs/specs/slack-technician-workflow-spec.md`, `docs/THEORY_OF_OPERATIONS.md`, `NORTH_STAR.md` | Slack is an adapter/front door to the shared MIRA engine. It should not become a separate chatbot architecture. |

## Production Environment Shape

As of the latest Doppler check:

| Var | State | Production meaning |
|---|---|---|
| `SLACK_BOT_TOKEN` | set | Authenticates to `FactoryLM` / `T0AK2CU16T1` as `U0AM3EZBSNQ`. |
| `SLACK_APP_TOKEN` | set | Socket Mode connection opens successfully. |
| `SLACK_SIGNING_SECRET` | set | Retained for request verification/OAuth-era compatibility. |
| `SLACK_EXPECTED_BOT_USER_ID` | set | Set to `U0AM3EZBSNQ` so startup diagnostics catch future token drift. Roll back with `doppler secrets delete SLACK_EXPECTED_BOT_USER_ID --project factorylm --config prd`. |
| `SLACK_ALLOWED_CHANNELS` | unset | Leave unset until channel policy is explicit. Current code applies this to DMs too, so setting only `C0AKBEL8C4T` would block DM tests. |
| `SLACK_CLIENT_ID` | unset | Hub full OAuth inactive. |
| `SLACK_CLIENT_SECRET` | unset | Hub full OAuth inactive. |
| `SLACK_WEBHOOK_URL` | unset | Node-RED Slack webhook alerts inactive. |

## Production Alignment Plan

1. Treat `FactoryLM` in `factorylm.slack.com` as the canonical production Slack app/workspace now.
2. Update acceptance tests and rollback docs to DM/mention `FactoryLM` in the FactoryLM workspace, with `#all-factorylm` as the shared-channel probe.
3. Keep `SLACK_EXPECTED_BOT_USER_ID=U0AM3EZBSNQ` in Doppler `factorylm/prd`; this is non-secret identity metadata and provides drift detection.
4. Keep `SLACK_ALLOWED_CHANNELS` unset unless DMs are not part of acceptance, or first change the adapter to exempt `channel_type=im` from the shared-channel allowlist.
5. Decide whether Hub should remain in bot-token shortcut mode or become a real customer-install OAuth flow. If OAuth is required, configure `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`, then verify callback storage.
6. Decide whether scheduled Slack webhooks should be revived. If yes, provision `SLACK_WEBHOOK_URL` for the intended FactoryLM channel and document the target channel.
7. Export or recreate the Slack app manifest for the `FactoryLM` production app so scopes, slash commands, events, Socket Mode, and display names are versioned in the repo.
8. Rename or clearly label `mira-maintenance-agent (local)` in the MIRA workspace as local/dev, or intentionally create a separate production MIRA workspace install with its own Doppler project/config. Do not mix the two under `factorylm/prd`.

## Human Acceptance Target

Production human testing should use:

- Workspace: `FactoryLM` (`factorylm.slack.com`)
- App/DM: `FactoryLM`
- Shared channel: `#all-factorylm`
- Slash command: `/mira-help`
- Doctor command:

```bash
doppler run --project factorylm --config prd -- \
  env PYTHONPATH=mira-bots:mira-bots/slack \
  python3.12 mira-bots/slack/doctor.py --expected-user-id U0AM3EZBSNQ
```
