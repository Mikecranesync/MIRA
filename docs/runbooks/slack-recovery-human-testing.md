# Slack Recovery Human Testing Guide

Use this guide after deploying the Slack recovery change to production for human validation of `mira-maintenance-agent`.

Companion rollback runbook: `docs/runbooks/slack-recovery-rollback.md`.

## Scope

This test proves the production Slack bot can:

- connect to Slack Socket Mode with the intended app identity;
- answer plain DMs instead of silently dropping them;
- respond in approved shared channels;
- preserve fast paths for photos, PDFs, and slash commands;
- fail in a diagnosable way without printing secrets or message bodies.

Do not use staging for this pass. Staging intentionally does not run the shared production Slack bot token.

## Before Testing

1. Confirm the deploy action finished.

```bash
gh run list --workflow deploy-vps.yml --branch main --limit 5
```

2. Confirm production health from outside the VPS.

```bash
curl -sS https://factorylm.com/api/health
curl -sS https://app.factorylm.com/api/health
```

3. Optional operator identity check. Run only under Doppler, and do not paste token values into issues or Slack.

```bash
doppler run --project factorylm --config prd -- \
  python3.12 mira-bots/slack/doctor.py --expected-user-id "${SLACK_EXPECTED_BOT_USER_ID:-U0B3V3QLUFP}"
```

Healthy shape:

```json
{"app_token_ok": true, "bot_token_ok": true, "expected_user_id": "U0B3V3QLUFP", "ok": true, "team_id": "T...", "user_id": "U0B3V3QLUFP"}
```

## Test Matrix

Record the Slack timestamp, channel/DM, prompt, and observed response for every row. Do not paste private production tokens or raw customer documents into the report.

| ID | Surface | Action | Expected Result |
|---|---|---|---|
| S1 | DM | DM `hello` to `mira-maintenance-agent`. | Bot replies in the DM thread with a normal MIRA response or context question. No silent drop. |
| S2 | DM | Ask `what can you help with?` | Bot replies without requiring asset confirmation for the general question. |
| S3 | `#all-mira` | Mention the app: `@mira-maintenance-agent hello`. | Bot replies in thread. |
| S4 | `#all-factorylm` | Mention the app: `@mira-maintenance-agent hello`. | Bot replies in thread. |
| S5 | Slash command | Run `/mira-help`. | Command returns the Slack command/help summary. |
| S6 | Image fast path | Upload an equipment/nameplate photo with a short caption. | Bot posts `Analyzing equipment...`, then a grounded fast-path response or a clear fallback. |
| S7 | PDF path | Upload a small non-sensitive PDF manual or sample PDF. | Bot posts `Processing PDF...`, then a success/failure message in thread. |
| S8 | Allowlist guard | Mention the app in a channel that should not be allowed, if one is configured and safe to use. | Bot stays quiet; operator logs show `channel_not_allowed` without message text. |

## Pass Criteria

Pass for human testing when:

- S1, S3, S4, and S5 respond within a normal Slack wait window;
- S6 and S7 either complete or return actionable error text instead of hanging;
- no response includes Slack token values, websocket URLs, or raw environment dumps;
- the bot does not respond outside the allowed channel set when `SLACK_ALLOWED_CHANNELS` is configured;
- any failure has enough route/decision logging to separate code, Slack dashboard, Doppler, and allowlist causes.

## Failure Triage

| Symptom | Likely Area | First Action |
|---|---|---|
| DM `hello` gets no reply | Socket Mode, event subscription, bot identity, or runtime dispatch | Run the doctor under Doppler and check deploy logs for `slack_event_accepted` / `slack_event_handled`. |
| Shared channels work but DM does not | Slack app event subscriptions or DM permission | Verify Slack app bot scopes and event subscriptions. |
| DM works but shared channels do not | channel allowlist or app membership | Check `SLACK_ALLOWED_CHANNELS`; invite the app to the channel if needed. |
| `/mira-help` fails but messages work | slash command registration/dashboard config | Verify the Slack dashboard command target and app install. |
| Photo/PDF path fails only | file permissions or Slack file download auth | Check for safe error text; verify file download scopes. |
| Doctor reports `bot_user_id_mismatch` | Doppler token points at the wrong Slack app | Fix `SLACK_BOT_TOKEN` or `SLACK_EXPECTED_BOT_USER_ID`, then redeploy `mira-bot-slack`. |

## Rollback Trigger

Start rollback if the recovery deploy makes Slack worse than pre-deploy, if Socket Mode cannot authenticate after Doppler values are confirmed present, or if responses leak secret/runtime data.

Rollback runbook: `docs/runbooks/slack-recovery-rollback.md`.
