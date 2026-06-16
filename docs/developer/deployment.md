# Deployment

How MIRA code reaches production.

> **Note:** CD automation is on the roadmap (issue #392). Today, deploys are manual SSH-driven rebuilds. This document describes the current manual flow.

## Environments

| Environment | Host | Purpose |
|---|---|---|
| **Development** | Your laptop | Feature work, testing, learning |
| **Bravo** (Mac Mini M4) | Tailscale `100.86.236.11` | Internal dogfood, model testing, Ollama |
| **Charlie** (Mac Mini) | Tailscale `100.70.49.126` | KB host, Telegram bot, Qdrant |
| **Production (VPS)** | DigitalOcean, `app.factorylm.com` | Customer-facing SaaS |

## The canonical deploy path

**Production lives on the VPS.** Bravo and Charlie are internal-only.

Production deploys must use `docker-compose.saas.yml` (NOT `mira-core/docker-compose.yml`). The SaaS compose attaches services to the `mira_mira-net` Docker network and uses the `-saas` container suffix.

> **Hard-learned gotcha:** There was once a second copy of `mira-pipeline` running from the wrong compose file. Open WebUI routed through Docker DNS, which pointed at the wrong container, and a "deployed" fix silently no-op'd for 20 minutes. **Always verify with `docker exec` after deploy.** See `docs/runbooks/factorylm-vps.md` for the full postmortem.

## Deploy to production (VPS)

```bash
# SSH to the VPS (via Charlie as jump box, or directly if your Tailscale is connected)
ssh factorylm-prod

# Pull the latest main
cd /opt/mira
git pull origin main

# Rebuild and recreate — use the SaaS compose, always
doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.saas.yml build <service-name>

doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.saas.yml up -d --force-recreate <service-name>

# Verify the fix is actually live
docker exec mira-<service>-saas <verification-command>

# Tail logs for 60 seconds to catch startup errors
docker compose -f docker-compose.saas.yml logs --tail 100 -f <service-name>
```

## Verification is non-optional

`docker compose up` succeeding does NOT mean the fix is running. Always verify:

| Service | Verification |
|---|---|
| `mira-pipeline` | `docker exec mira-pipeline-saas grep <fix-signature> /app/main.py` |
| `mira-mcp` | `docker exec mira-mcp-saas python -c "import fastmcp; print(fastmcp.__version__)"` |
| `mira-core` | `curl app.factorylm.com/health` (public) or `docker exec mira-core-saas curl localhost:8080/health` |
| `mira-web` | `curl app.factorylm.com/api/health` or browser test |

**Rule of thumb:** if you can't verify the fix is in the running container with a `docker exec`, you haven't actually deployed.

## Deploy to Bravo (internal)

Docker build over SSH to Mac Minis often fails due to a keychain-locked Docker config. Two workarounds:

### Option A — `DOCKER_CONFIG` override (preferred)

```bash
ssh bravo "cd /path/to/mira && DOCKER_CONFIG=/tmp/docker-config docker compose build <service>"
ssh bravo "cd /path/to/mira && docker compose up -d --force-recreate <service>"
```

### Option B — `docker cp` + restart

```bash
# On your local machine
docker build -t mira-<service>:latest mira-<service>/

# Save and ship the image
docker save mira-<service>:latest | ssh bravo "docker load"
ssh bravo "docker compose up -d --force-recreate <service>"
```

### Option C — Doppler token-storage fix (one-time)

On Bravo:

```bash
doppler configure set token-storage file
```

This makes Doppler persist tokens to disk instead of the locked keychain, and lets `docker build` work normally over SSH.

## Rollback

```bash
# On production VPS
cd /opt/mira
git log --oneline -20                 # find the prior good commit
git checkout <prior-commit-hash>
doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.saas.yml up -d --force-recreate <service>
```

After rollback, return to the `main` branch:

```bash
git checkout main
```

## Deployment checklist

Before pushing a deploy:

- [ ] CI is green on `main` for the commit you're deploying
- [ ] You've tested the change locally with `doppler run --config dev -- docker compose up -d`
- [ ] You know exactly which service(s) you're rebuilding
- [ ] You've identified the verification command for this change
- [ ] You've checked [wiki/hot.md](../../wiki/hot.md) for any active incidents or in-flight changes

After deploying:

- [ ] `docker exec` verification confirmed the fix is live
- [ ] Logs tailed for 60+ seconds with no new errors
- [ ] Smoke test against the live site (chat works, login works)
- [ ] Updated [wiki/hot.md](../../wiki/hot.md) with deploy details (commit SHA, time, what shipped)

## Runbooks

| Runbook | Purpose |
|---|---|
| [factorylm-vps.md](../runbooks/factorylm-vps.md) | Full VPS deploy recipe, SSH access, container topology |
| [bravo-deploy.md](../runbooks/bravo-deploy.md) | Bravo Mac Mini deploy workflow (if exists) |
| [neon-recovery.md](../runbooks/neon-recovery.md) | Restoring NeonDB from backup (if exists) |

## Where to go next

- [Architecture overview](architecture.md) — what's running where
- [Local setup](local-setup.md) — reproduce production behavior locally
- [Contributing](contributing.md) — how to ship a change
- [docs/adr/](../adr/) — the "why" behind deployment topology choices
