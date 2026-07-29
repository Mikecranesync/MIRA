#!/usr/bin/env bash
# vps_docker_gc.sh — weekly Docker garbage collection for the prod VPS.
#
# Each deploy rebuilds ~9 containers, leaving dangling images + build cache that
# re-accumulate (~a few GB/deploy; ~17 GB reclaimable was observed after 2 deploys
# on 2026-07-07). This reclaims build cache + images NOT backing a running
# container. Safe + idempotent; logs a before/after disk summary.
#
# Cron (VPS): 0 5 * * 0  /opt/mira/scripts/vps_docker_gc.sh >> /var/log/mira-agents/docker-gc.log 2>&1
set -uo pipefail
ts() { date -u +%FT%TZ; }
before=$(df -h / | awk 'END{print $4" free / "$5" used"}')
echo "[$(ts)] docker-gc start ($before)"
docker builder prune -af  >/dev/null 2>&1 || true
docker image   prune -af  >/dev/null 2>&1 || true
after=$(df -h / | awk 'END{print $4" free / "$5" used"}')
echo "[$(ts)] docker-gc done  ($after)"
