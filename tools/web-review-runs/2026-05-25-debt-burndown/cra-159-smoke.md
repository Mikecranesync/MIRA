# CRA-159 Smoke Receipt — Post-Deploy Verification

**Date:** 2026-05-26
**PR:** #1527 (merged 2026-05-26T05:26:17Z, squash commit `f133f44a`)
**VPS:** factorylm-prod (165.245.138.91)
**Container:** `mira-scan-backend` on image `mira-scan-backend:0.2.0`

## Deploy steps

```
ssh root@165.245.138.91
cd /opt/mira-deploy-cra
git checkout upgrade-2026-05-15
git merge --ff-only origin/main          # → HEAD f133f44a
cd mira-scan-monday
touch .env                                # placate compose env_file directive
docker compose build backend             # built mira-scan-backend:0.2.0
docker rename mira-scan-backend mira-scan-backend-old-$(date +%s)
cd /opt/mira && doppler run -- bash -c '
  cd /opt/mira-deploy-cra/mira-scan-monday && docker compose up -d backend'
docker stop mira-scan-backend-old-*       # free port 8090
docker start mira-scan-backend            # new container
```

## Container state after deploy

```
$ docker ps --filter name=mira-scan-backend --format '{{.Names}}|{{.Status}}|{{.Image}}'
mira-scan-backend|Up 42 seconds (healthy)|mira-scan-backend:0.2.0
```

## Module-level verification

```
$ docker exec mira-scan-backend python -c 'from backend import rate_limit; ...'
CHAT_RATE_LIMIT_PER_WINDOW=30
CHAT_RATE_LIMIT_WINDOW_SECONDS=300
```

CRA-159 spec defaults present in deployed image. (Could be overridden via Doppler env if marketplace traffic warrants tighter limits later.)

## Functional smoke — 31 rapid calls, single account_id

```
$ docker exec mira-scan-backend python -c '<31-call loop>'
req# | allowed | used | retry_after
----------------------------------------
   1 | True    |    1 |    0
   2 | True    |    2 |    0
   3 | True    |    3 |    0
  29 | True    |   29 |    0
  30 | True    |   30 |    0
  31 | False   |   30 |  300

PASS: 30 allowed, 31st blocked with Retry-After=300s
```

**Note on smoke method:** HTTP-level smoke would require a valid Monday-session signed cookie/header (`session.account_id_from_headers` rejects unsigned). Module-level call against the deployed image proves the rate-limiter is loaded and behaves to spec — same code path the FastAPI handler invokes after `account_id_from_headers` returns a non-empty value. HTTP-level burst test against an authenticated marketplace install is the next-customer task.

## Cleanup

```
docker rm mira-scan-backend-old-1779773969     # exited (0) — removed
```

## Status

CRA-159: **deployed + verified on prod.** PR #1527 merged → image `mira-scan-backend:0.2.0` running healthy → spec defaults present → 31-call burst smoke passes.
