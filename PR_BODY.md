## Current production state
FactoryLM/MIRA runs on OVH `40.160.141.61` as a **minimal Hub+web** stack: `mira-hub` (`127.0.0.1:3101`) + `mira-web` (`127.0.0.1:3200`), both healthy, behind nginx (`app.factorylm.com`→hub, `factorylm.com`→web), on **production Neon** (`ep-purple-hall-ahimeyn0…`). It was restored via a recovery overlay and is pinned at `1aed7d44a` (detached). `deploy-vps.yml` still targeted the **dead** DigitalOcean host and the full 9-service SaaS stack.

## Problem
Pointing the existing `deploy-vps.yml` at OVH unchanged would (a) `git checkout --force` off the recovery SHA — and `compose.recovery.yml` isn't on `main`, so the overlay vanishes; (b) `docker compose -f docker-compose.saas.yml up` the **full 9-service set** without the overlay (base Hub attaches an absent `cmms-ext` network; pipeline/bots/etc. have no deps here) → `up --wait` fails → `docker rm -f` fallback → **outage**; (c) SSH `root@165.245.138.91` (wrong, dead host); (d) fail the nginx hygiene guard (which doesn't allow `recovery-ovh`).

## Architecture decision
**Reconciled-minimal (Hub+web).** It's the only proven-working production set; the full stack depends on services/data not yet restored (Atlas/CMMS, Nango, Redis, pipeline, PrintSense). The recovery overlay is promoted — audited, not copied blindly — to a permanent, provider-neutral `docker-compose.production.yml`. Additional services are re-enabled later, each with its own evidence.

## Changes (4 commits)
- **`docker-compose.production.yml`** (new): promoted overlay for `mira-hub` only — `!override` localhost `127.0.0.1:3101`, `networks: [mira-net]` (drops absent `cmms-ext`), `disabled://` + `.invalid` fail-closed stubs for deferred integrations, `OLLAMA_BASE_URL` from env, preserves the `mira-hub-upload-buffers` named volume, `AUTH_TRUST_HOST`, in-container `NEXTAUTH_URL_INTERNAL`, `mem 2g`. Audited departures from the recovery hack: emails use standard Doppler `RESEND_API_KEY` (not the test-mode gate); public URLs use the base `https://app.factorylm.com` defaults. **No secret is hardcoded; Neon still comes from Doppler.** `mira-web` needs no overlay (already normal from base saas).
- **`deploy-vps.yml`**: `workflow_run` auto-deploy **removed** → `workflow_dispatch` only; `TARGETS=mira-hub mira-web`; `build`/`up` use `-f docker-compose.saas.yml -f docker-compose.production.yml`; SSH `ubuntu@40.160.141.61` with `sudo bash -s` (no root login); nginx ALLOW gains `recovery-ovh`; `install_crons.sh` skipped in the minimal model. No `165.245.138.91`/`root@` remain.
- **`deployment/known_hosts.factorylm-prod`**: append the **verified** OVH ED25519 key (`SHA256:yslCH8KRVJu…`); strict host-key checking preserved.
- **`.github/workflows/ovh-preflight.yml`** (new): manual, **read-only** preflight (validate merged compose on runner; emit CI deploy public key; SSH read-only host/identity/health/Neon checks).

## Safety properties
- **A merge to `main` does NOT deploy.** The only production trigger is `workflow_dispatch`. (Proven in the YAML: `on:` has just `workflow_dispatch`.)
- **The first real production deploy has NOT been run** in this PR.
- **Deferred services stay deferred** — targets are only `mira-hub mira-web`; `--no-deps` prevents dependency cascade.
- **The preflight is read-only** — no checkout/pull/reset/build/up/restart/rm/migrate/nginx/DNS/Neon writes.

## Validation
- `actionlint` passes on both workflows; YAML valid; overlay `!override` is a valid Compose tag.
- Merged `docker compose config` validation + localhost-bind/`mira-net`-only assertion run in the preflight `validate-config` job (runner-only).
- Read-only OVH preflight evidence: **see "Remaining gate".**

## First real deployment impact (what the eventual authorized deploy does)
- **Containers recreated:** YES — `up --no-deps --force-recreate --wait mira-hub mira-web` (only these two).
- **Images rebuilt:** YES — from `main` HEAD (current live images were built at `0178b1b0`); code advances `0178b1b0 → main`.
- **Named volumes persist:** YES — `mira_mira-hub-upload-buffers`, `mira_mira-leads-data` survive force-recreate (not deleted). **No persistent data removed.**
- **Ports change:** NO — `127.0.0.1:3101` / `127.0.0.1:3200` unchanged.
- **Network attachment:** hub stays `mira-net` (overlay drops `cmms-ext`, matching current live behavior).
- **Hub env changes vs live:** code SHA; `RESEND_API_KEY` now from Doppler prd (emails enabled — flagged); mem 1g→2g. **Neon unchanged (production).**
- **Downtime:** brief — old containers keep serving through the build; swap at `--force-recreate --wait` is health-gated (≈ container boot, seconds–~2 min/target).
- **Health gates success:** `--wait`/`--wait-timeout 300` — compose blocks until hub+web healthchecks report healthy; timeout → `up` non-zero → deploy fails.
- **If Hub or Web fails:** the health-gated swap fails the deploy; retry-once only on a name conflict, else error-exit.
- **Restore current containers if deploy fails:** possible by redeploying the prior SHA, **but** the build overwrites `:latest`, so there is **no one-command image rollback** today — see risks.

## Remaining risks / blockers
- **CI deploy key not yet authorized on OVH `ubuntu`** — the preflight `emit-deploy-pubkey` job prints the exact key to authorize (append-only, preserve existing).
- **No saved rollback image** for the currently-working hub/web — recommend `docker save mira-mira-hub:latest mira-mira-web:latest` to `/opt` before the first deploy.
- **Emails**: minimal model now uses Doppler prd `RESEND_API_KEY` (behavior change from recovery test-mode).

## Remaining gate
**FIRST REAL OVH CI DEPLOY REQUIRES EXPLICIT MIKE APPROVAL.** This PR only makes CI OVH-aware and manual; it does not deploy.

## Rollback (of this PR, without disturbing the running OVH containers)
Revert/close this PR. The live OVH deployment was created manually (recovery scripts) and is **independent of CI** — nothing here touches running containers, nginx, DNS, or Neon. `deployment/known_hosts.factorylm-prod` only **adds** the OVH entry (old entry retained). No workflow runs on merge.
