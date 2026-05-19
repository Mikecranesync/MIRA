# `coolify/` — Staging deploy surface

Coolify-specific config for MIRA staging. Lives in the repo so PR previews track the same compose graph as prod.

## Files

- `docker-compose.staging.yml` — Phase 1 service subset (Hub + pipeline + MCP + web + Atlas).
  Pulls service definitions from existing module composes via `include:` so it
  does **not** fork production. Add new services to the canonical compose first
  (`docker-compose.saas.yml` or module-local), then opt them into staging here.

## Bring-up

Full runbook: `docs/runbooks/coolify-staging.md`.

Short version:

1. Mike creates a Linux droplet (DO Marketplace one-click or Hetzner CPX11 + install script).
2. Mike adds DNS A record `staging.factorylm.com → <droplet_ip>` and wildcard `*.staging.factorylm.com → <droplet_ip>`.
3. After Coolify boots, point a new project at `Mikecranesync/MIRA`, compose path `coolify/docker-compose.staging.yml`, branch `main`.
4. Inject Doppler `factorylm/stg` env vars (use a service token, not personal token).
5. Deploy.

## Security non-negotiables

- **Coolify admin (:8000) must not be public.** Bind to Tailscale or firewall to Mike's IP only.
- **Slack tokens are SHARED between `factorylm/stg` and `factorylm/prd`** — never run `mira-bot-slack` in staging without rotating the staging Slack app to a separate workspace first. Dual-polling = lost/duplicated messages in prod Slack.
- **Stripe in staging = test-mode keys only.** Confirm `STRIPE_SECRET_KEY` in `factorylm/stg` starts with `sk_test_`.
- **NeonDB writes hit the staging branch** `ep-polished-hall-ahcqtcxe-pooler`. Confirm `NEON_DATABASE_URL` resolves to that hostname before any deploy.

## Verify before declaring staging "up"

```bash
curl -sf https://staging.factorylm.com/api/health
curl -sf https://staging.factorylm.com/hub/api/health
curl -sf https://staging.factorylm.com/v1/health   # mira-pipeline behind nginx route
```

All three must return 200. Then load `https://staging.factorylm.com/hub` from a phone and confirm the garage namespace is visible.

## Per-PR preview deploys

Phase 1: all previews share the staging NeonDB branch. PR URL pattern: `pr-{number}.staging.factorylm.com`.

Phase 2 (future, not wired yet): per-PR Neon branch via Neon API + GitHub Action on PR open/close. `NEON_API_KEY` is in Doppler `factorylm/stg`. See runbook §5.
