# Runbook: Edge Deploy to BRAVO

Deploy a new MIRA version to the BRAVO Mac Mini (192.168.1.11 / 100.86.236.11).

## Pre-flight

```bash
# Verify working tree is clean
git status
# Should show: nothing to commit, working tree clean

# Confirm VERSION is updated in CLAUDE.md
grep "^Version" /c/Users/hharp/Documents/MIRA/CLAUDE.md

# Verify you are deploying from the correct repository
git remote -v
# Must show: origin  git@github.com:Mikecranesync/MIRA.git
```

## 1. SSH to BRAVO

```bash
ssh bravonode@100.86.236.11
# Or via LAN: ssh bravonode@192.168.1.11
```

## 2. Pull Latest

```bash
cd ~/Mira
git pull origin main
# Verify the commit you expect is now HEAD
git log --oneline -3
```

## 3. Start Services

```bash
bash install/up.sh
# This creates core-net and bot-net if missing, then runs:
# doppler run --project factorylm --config prd -- docker compose up -d
```

All secrets are injected by Doppler. Never pass `--env-file` or set vars manually.

## 4. Smoke Test

```bash
bash install/smoke_test.sh
# Checks /health on mira-core, mira-ingest, mira-mcp SSE
# Exits 0 on pass, non-zero on failure
```

## 5. Verify Logs

```bash
docker compose logs --tail 20
# Check for ERROR or CRITICAL lines in any container
# Expected: no errors, all containers show healthy startup messages

# Per-container check if needed:
docker compose logs mira-core --tail 30
docker compose logs mira-bot-telegram --tail 20
```

## 6. Confirm Healthchecks Pass

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
# All 7 containers should show: Up N minutes (healthy)
```

## Rollback

If smoke test fails or health checks don't pass:

```bash
# Find the previous stable tag
git tag --sort=-version:refname | head -5

# Check out previous version
git checkout v<previous-tag>
bash install/up.sh

# Verify rollback is running
bash install/smoke_test.sh
```

If services still fail after rollback: check `docker compose logs` for the specific
container that is unhealthy before escalating.

## Troubleshooting

### Docker keychain locked (cannot pull images over SSH)

Do not run `docker build` over SSH — macOS keychain is locked to the interactive
session. Use the `docker cp` workaround:

```bash
# On local machine: build and export image
docker build -t mira-core:local ./mira-core
docker save mira-core:local | gzip > /tmp/mira-core.tar.gz

# Copy to BRAVO
scp /tmp/mira-core.tar.gz bravonode@100.86.236.11:/tmp/

# On BRAVO: load
docker load < /tmp/mira-core.tar.gz
```

### Volume migration

If mira.db schema changes, run migrations before starting services:

```bash
# On BRAVO, with services stopped:
sqlite3 ~/Mira/mira-bridge/data/mira.db < migrations/NNNN_description.sql
```

### Port conflicts

If port 8080 or 3000 is already bound:

```bash
lsof -i :8080
# Identify the conflicting process and stop it, or change NODERED_PORT / port mapping in compose
```

### Doppler token not available

If `doppler run` fails with auth error:

```bash
doppler login
# Or set DOPPLER_TOKEN env var for non-interactive contexts
export DOPPLER_TOKEN=$(doppler configs tokens create deploy --plain)
DOPPLER_TOKEN=$DOPPLER_TOKEN docker compose up -d
```
