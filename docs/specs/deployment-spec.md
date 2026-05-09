# Deployment Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Single-stop reference for **how MIRA is deployed**: which docker-compose profile lives where, what nginx routes for `factorylm.com` and `app.factorylm.com`, which node runs what, and how secrets reach a container. Intended to be followed by anyone bringing a fresh node online or debugging routing.

## Scope
**IN scope**
- Compose files: `docker-compose.yml`, `docker-compose.saas.yml`, `mira-core/docker-compose.oracle.yml`, per-module compose files
- Nginx config under `deployment/nginx-factorylm-marketing.conf`
- VPS layout (factorylm.com + app.factorylm.com)
- Per-node service map (Alpha / Bravo / Charlie / Travel)
- Doppler injection (`doppler run -- docker compose up -d`)

**OUT of scope**
- Kubernetes (not used; explicit no per `docs/known-issues.md` style)
- Per-service container internals (see each service spec)

## Architecture

### Node map
| Node | Tailscale | LAN | Role | Services |
|---|---|---|---|---|
| Alpha | 100.107.140.12 | 192.168.4.28 (`192.168.4.x`) | Orchestrator | celery-worker, celery-beat, docker-desktop |
| Bravo | 100.86.236.11 | 192.168.1.11 (`192.168.1.x`) | Compute | Ollama (`:11434`), mira-mcp |
| Charlie | 100.70.49.126 | 192.168.1.12 (`192.168.1.x`) | KB host | mira-core, mira-ingest, mira-bots, atlas-cmms, open-webui |
| Travel | Tailscale only | — | Mobile | Claude Code CLI, no local mounts |

Connectivity rules:
- Alpha ↔ Bravo/Charlie: Tailscale only (different subnets).
- Bravo ↔ Charlie: LAN preferred, Tailscale fallback.
- All nodes: SSH keys via Doppler `factorylm/prd` as `SSH_{NODE}_{PRIVATE_KEY,PUBLIC_KEY,CONFIG,AUTHORIZED_KEYS}`.
- Canonical source: `deployment/network.yml`.

### VPS routing (factorylm.com)
Nginx (`deployment/nginx-factorylm-marketing.conf`):
- `factorylm.com` → marketing site (mira-web)
- `app.factorylm.com` → mira-web app surface, including `/sample`, `/activated` (added 2026-04-26)
- Hub on its own subdomain (e.g., `hub.factorylm.com`) when wired; otherwise behind `app.` path prefix.

### Compose layout
| File | Purpose |
|---|---|
| `docker-compose.yml` (repo root) | Local dev / on-node MIRA stack |
| `docker-compose.saas.yml` | SaaS overlay — adds `mira-relay`, `mira-ingest-saas` |
| `mira-core/docker-compose.yml` | mira-core internal compose |
| `mira-core/docker-compose.oracle.yml` | Oracle Cloud overrides; needs `BRAVO_HOST` |
| Module-level (`mira-bots`, `mira-bridge`, `mira-cmms`, `mira-mcp`, `mira-web`) | Per-module standalone runs |

## API Contract (deploy commands)
```bash
# Standard local / on-node
doppler run --project factorylm --config prd -- docker compose up -d
doppler run --project factorylm --config prd -- docker compose down
doppler run --project factorylm --config prd -- docker compose logs -f <service>
bash install/smoke_test.sh

# SaaS overlay (factorylm.com)
doppler run --project factorylm --config prd -- docker compose -f docker-compose.yml -f docker-compose.saas.yml up -d
```

Conventions:
- `restart: unless-stopped` + healthcheck on every service (CLAUDE.md hard constraint #5).
- Pinned image versions (no `:latest` / `:main`).
- Named networks; never `network_mode: host`; never `privileged: true`.

## Configuration
| Var / Setting | Purpose |
|---|---|
| Doppler project/config | `factorylm/prd` (production) — single source of truth for all secrets |
| `MIRA_MCPO_VERSION` | Bump on `Dockerfile.mcpo` change |
| `BRAVO_HOST` | Required for Oracle Cloud overrides |
| `ATLAS_PUBLIC_*_URL` | Public URLs for Atlas surfaces |
| `MIRA_INGEST_URL` | mira-web → mira-ingest-saas in saas overlay |
| `INBOX_DOMAIN` | Magic-inbox URL builder (default `factorylm.com`) |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Smoke test green after deploy | required | enforced via `install/smoke_test.sh` |
| Container restart MTTR | unmeasured | ≤ 60 s |
| Image scanning | trivy in CI | maintain |
| Schema migration safety | uses CREATE IF NOT EXISTS pattern | maintain |
| Time to bring up new node | unmeasured | ≤ 30 minutes following `bootstrap.sh` |

## Acceptance Criteria
1. **Cold start:** Following the README on a clean Charlie node yields all 11 containers in `running (healthy)` state.
2. **Healthchecks present:** Every service in every compose file has a `healthcheck:` block.
3. **No `:latest`:** `grep -E "image:.*:latest" $(git ls-files '*compose*.yml')` returns nothing.
4. **No `network_mode: host`:** Same grep returns nothing.
5. **Doppler injection:** No secret string from `docker compose config` matches a real value (verified locally).
6. **nginx routing:** `app.factorylm.com/sample`, `/activated`, `/cmms` all return 200 from `mira-web`.
7. **SaaS overlay:** `docker-compose.saas.yml` adds `mira-relay` only when invoked; not present in default compose.
8. **Smoke test passes:** `install/smoke_test.sh` exits 0 within 90 s of compose up.
9. **Registered models:** Open WebUI shows "MIRA Diagnostic" pointing at `mira-pipeline:9099`.

## Known Issues
- macOS keychain over SSH breaks `docker build` and `doppler` on remote nodes; Bravo workaround: `doppler configure set token-storage file`. Generic workaround: `docker cp` + restart.
- NeonDB SSL fails on Windows due to `channel_binding`; deploy from macOS hosts.
- A single Telegram bot token cannot be served by two pollers; CHARLIE specifically has hosted stale pollers in the past.

## Change Log
- 2026-05-04 — nginx routes `/sample` + `/activated` to mira-web on `app.factorylm.com`.
- 2026-04 — Oracle Cloud overrides via `BRAVO_HOST`.
- 2026-04 — SaaS overlay adds `mira-relay` for factory→cloud Ignition tag streaming.
