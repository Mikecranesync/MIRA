# Slack Recovery Rollback Runbook

Use this if the Slack recovery deploy makes the canonical production `FactoryLM` Slack app worse or leaves the bot unresponsive after the acceptance probes in `docs/runbooks/slack-recovery-human-testing.md`.

## Rules

- Do not print token values.
- Do not run direct VPS `docker compose up`, `restart`, `down`, or `stop` from Claude sessions.
- Use GitHub Actions `deploy-vps.yml` for production changes.
- Keep all live identity checks under Doppler and redact Slack API output.

## Fast Rollback

1. Find the last known-good commit before the Slack recovery merge.

```bash
git fetch origin
git log --oneline --decorate origin/main -- docs/runbooks/slack-recovery-rollback.md mira-bots/slack/bot.py mira-bots/slack/doctor.py docker-compose.saas.yml docs/env-vars.md
```

2. Revert the Slack recovery merge commit on a rollback branch.

```bash
git switch -c rollback/slack-recovery-YYYYMMDD origin/main
git revert <slack-recovery-merge-sha>
git push -u origin rollback/slack-recovery-YYYYMMDD
gh pr create --title "rollback(slack): revert Slack recovery deployment" --body "Reverts the Slack recovery merge. No secret values included."
```

3. After review and merge, deploy only the Slack bot service.

```bash
gh workflow run deploy-vps.yml --ref main -f services='mira-bot-slack' -f skip_staging_gate=false
```

4. Watch the deploy.

```bash
gh run list --workflow deploy-vps.yml --branch main --limit 5
gh run watch <run-id>
```

## Secret-Safe Diagnosis Before Or After Rollback

Run the doctor under Doppler. It prints token status and Slack identity only, never token values or Socket Mode websocket URLs.

```bash
doppler run --project factorylm --config prd -- \
  env PYTHONPATH=mira-bots:mira-bots/slack \
  python3.12 mira-bots/slack/doctor.py --expected-user-id "${SLACK_EXPECTED_BOT_USER_ID:-U0AM3EZBSNQ}"
```

Expected healthy shape:

```json
{"app_token_ok": true, "bot_id": "B0ALXRE4CDU", "bot_token_ok": true, "expected_user_id": "U0AM3EZBSNQ", "ok": true, "team": "FactoryLM", "team_id": "T0AK2CU16T1", "user_id": "U0AM3EZBSNQ"}
```

If `bot_user_id_mismatch` appears, rollback code may not help. Fix the Doppler value for `SLACK_BOT_TOKEN` or `SLACK_EXPECTED_BOT_USER_ID`, then redeploy `mira-bot-slack`.

## Acceptance After Rollback

Ask Mike to test:

- DM `hello` to `FactoryLM` in `factorylm.slack.com`.
- Mention `@FactoryLM hello` in `#all-factorylm`.
- Run `/mira-help`.

If only `mira-maintenance-agent (local)` in the separate `MIRA` workspace is failing, rollback production only after proving production `FactoryLM` is also worse. Otherwise handle the local/dev app as a separate configuration issue.

Rollback is complete only when the bot is at least as responsive as it was before the recovery deploy, or the remaining failure is proven to be Slack dashboard/Doppler config rather than code.
