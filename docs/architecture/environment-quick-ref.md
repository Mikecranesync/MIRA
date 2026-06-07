# Environment Quick Reference

**Full doctrine:** `docs/environments.md` — read it before any infra/migration/deploy work. This file is a compact pointer and command card only; it does not replace `docs/environments.md`.

---

## The three environments

| | DEV | STAGING | PROD |
|---|---|---|---|
| Where | CHARLIE local | CHARLIE + NeonDB staging branch | VPS `165.245.138.91` (DigitalOcean) |
| Compose | `docker-compose.yml` | `docker-compose.staging.yml` (**Gap-1 — does not exist yet**) | `docker-compose.saas.yml` |
| Doppler | `factorylm/dev` | `factorylm/stg` | `factorylm/prd` |
| NeonDB branch | `ep-lingering-salad` (dev endpoint) | `br-small-term-ahtkz61d` / `ep-polished-hall-ahcqtcxe-pooler` | `br-lively-bread-ahoa86se` |
| Telegram bot | `@MiraDevBot` or none | `@MiraStagingBot` (**Gap-3 — does not exist yet**) | `@FactoryLM_Diagnose` |
| VPS host | n/a | Same VPS, `stg-*` containers, port `4xxx`, `/opt/mira-staging` | `/opt/mira`, standard ports |
| Safe to break | YES | YES (gate before promotion) | **NEVER** |

Source: `docs/environments.md`. Gap-1 (staging compose) and Gap-3 (staging bot) are open as of this writing.

---

## Promotion workflow

```
feature branch → PR → smoke-test.yml + reviews pass
  → merge to main
  → deploy-vps.yml (staging gate required)
  → smoke against factorylm.com + app.factorylm.com
  → verify on @FactoryLM_Diagnose
```

Staging gate: `staging-gate.yml` (Gap-2 CLOSED — workflow exists). Only `staging-gate` is required for repo auto-merge. `smoke-test.yml` does NOT build saas images (CI gap — see memory `project_prod_deploy_incident_2026_06_02`).

Migration path: dev → staging → prod via `apply-migrations.yml` (dry-run first, then apply). Hub migrations only (`mira-hub/db/migrations/`). Engine migrations (`docs/migrations/`) must be applied manually.

KB seed path: staging first → verify BM25 retrieval → prod via `apply-seeds.yml` / `seed-oem-manuals.yml`. Never seed prod first (May 2026 BM25 outage: embedding gate silently returned `[]`; PR #1385).

---

## Hard rules (enforced by `tools/hooks/prod-guard.sh` via `.claude/settings.json` PreToolUse hook)

1. **Never run `psql` / raw SQL against prod NeonDB** from a code session. Use staging / dev / `db-inspect.yml`.
2. **Never restart, rebuild, or `docker compose` a VPS container directly.** Use `deploy-vps.yml`.
3. **Never point a feature-branch build at `@FactoryLM_Diagnose`.** Use a dev/staging/no-op adapter.
4. **Engine / RAG / retrieval / classifier changes** must pass the staging gate before deploy.
5. **Migrations** go dev → staging → prod. Never hand-edit prod schema.
6. **KB seeds** go staging first. Verify BM25 retrieval before bulk insert to prod.

**Slack tokens shared stg↔prd:** `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` are identical in Doppler `factorylm/stg` and `factorylm/prd`. Never run `mira-bot-slack` (or `mira-bot-slack-saas`) in a staging environment without a separate Slack workspace. Source: memory `project_slack_token_stg_prd_shared`.

---

## Override and hotfix commands

**Prod-guard override (human-only, per-shell):**
```bash
MIRA_ALLOW_PROD=1 <command>
```

**Sanctioned hotfix bypass** (file a follow-up PR within 24h):
```bash
gh workflow run deploy-vps.yml \
  -f services="mira-hub" \
  -f skip_staging_gate=true \
  -f skip_reason="<brief reason>"
```

**VPS SSH:**
```bash
ssh prod        # via Tailscale alias
ssh prod-public # via ATL1 public IP (root@165.245.138.91, id_ed25519)
```
Source: memory `reference_vps_ssh`. Permission set in `.claude/settings.local.json`.

**Deploy a single service:**
```bash
gh workflow run deploy-vps.yml -f services="mira-hub mira-pipeline-saas"
```

**Migrations (Hub only, dry-run first):**
```bash
gh workflow run apply-migrations.yml -f environment=staging -f dry_run=true
gh workflow run apply-migrations.yml -f environment=staging -f dry_run=false
gh workflow run apply-migrations.yml -f environment=production -f dry_run=true
gh workflow run apply-migrations.yml -f environment=production -f dry_run=false
```

---

## What can go wrong

| Failure mode | Details |
|---|---|
| **Slack tokens shared stg↔prd** | Running mira-bot-slack in staging sends to prod Slack workspace. Separate workspace required (Gap open). |
| **Staging compose doesn't exist** | `docker-compose.staging.yml` is Gap-1. Staging today means `docker-compose.saas.yml` variant on port 4xxx, not a fully separate compose. |
| **Staging bot doesn't exist** | `@MiraStagingBot` is Gap-3. Feature testing against Telegram means using a dev bot or no-op adapter. |
| **Engine migrations not run by CI** | `docs/migrations/` is NOT touched by `apply-migrations.yml`. Must be run manually. Easy to forget after branching from a clean staging DB. |
| **Dev NeonDB mis-wired** | Was pointed at prod endpoint until 2026-05-30. After any environment reset, verify `NEON_DATABASE_URL` in `factorylm/dev` Doppler. |
| **Self-healer can't recreate removed containers** | `docker restart` can't recreate a removed container. Recovery requires `gh workflow run deploy-vps.yml`. See memory `project_self_healer_recreate_gap`. |
| **Smoke test false alarm on deploy** | `deploy-vps.yml` reports `conclusion=failure` due to a mira-pipeline health-probe false alarm even on successful deploys. Verify `curl https://app.factorylm.com/api/health` returns 200 independently. Source: memory `project_self_healer_recreate_gap`. |
| **`mira-ask-saas` only on Tailscale** | Bound to `100.68.120.99:8011` — unreachable if Tailscale is down on CHARLIE or the VPS. |
