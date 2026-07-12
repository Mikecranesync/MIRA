#!/bin/bash
# ============================================================
# Host permission setup for SaaS containers (UID 1001 = mira)
#
# After PR #1219 added `USER mira` (UID 1001) to mira-pipeline,
# mira-mcp, and mira-core/mira-ingest Dockerfiles, the host bind-
# mounts under /opt/mira/data must be owned by 1001:1001 or the
# containers crash-loop on SQLite WAL writes (incident 2026-05-15).
#
# This script is idempotent — safe to run on every deploy. It only
# touches the specific paths the three saas containers write to.
# It does NOT chown:
#   /opt/mira/data/mira-bot-telegram/   (bot runs as root)
#   /opt/mira/data/pdfs/                (ingest staging, root)
#   /opt/mira/data/photo_batches.db*    (separate writer, root)
#   /opt/mira/data/session_photos/      (root-owned by design)
#   /opt/mira/data/_snapshots/          (manual backups, root)
#
# Invoked from .github/workflows/deploy-vps.yml between
# `git reset --hard origin/main` and `docker compose up`.
# ============================================================
set -euo pipefail

MIRA_UID="${MIRA_UID:-1001}"
MIRA_GID="${MIRA_GID:-1001}"
DATA_DIR="${DATA_DIR:-/opt/mira/data}"
SESSIONS_DIR="${SESSIONS_DIR:-/opt/mira/mira-bridge/data/sessions}"
VAR_LIB_MIRA="${VAR_LIB_MIRA:-/var/lib/mira}"

echo "=== host_perm_setup: chowning SaaS data paths to $MIRA_UID:$MIRA_GID ==="

# Parent data dir must be writable by UID 1001 so SQLite can create
# *-wal and *-shm sibling files during WAL-mode bootstrap.
chown "$MIRA_UID:$MIRA_GID" "$DATA_DIR"

# pipeline + mcp primary DB
[ -f "$DATA_DIR/mira.db" ]     && chown "$MIRA_UID:$MIRA_GID" "$DATA_DIR/mira.db"
[ -f "$DATA_DIR/mira.db-wal" ] && chown "$MIRA_UID:$MIRA_GID" "$DATA_DIR/mira.db-wal"
[ -f "$DATA_DIR/mira.db-shm" ] && chown "$MIRA_UID:$MIRA_GID" "$DATA_DIR/mira.db-shm"

# pipeline subdirs (mem0 conversation memory + agent run logs)
for sub in mem0 agent-runs; do
  if [ -d "$DATA_DIR/$sub" ]; then
    chown -R "$MIRA_UID:$MIRA_GID" "$DATA_DIR/$sub"
  fi
done

# ingest's isolated data dir (created here so the mount has somewhere to land)
mkdir -p "$DATA_DIR/ingest"
chown -R "$MIRA_UID:$MIRA_GID" "$DATA_DIR/ingest"

# pipeline's bridge-session recording path (separate tree)
if [ -d "$SESSIONS_DIR" ]; then
  chown -R "$MIRA_UID:$MIRA_GID" "$SESSIONS_DIR"
fi

# KB growth cron's runtime queue path — outside the repo tree so it survives
# git checkout --force on deploy. The cron runs as root so the dir is 755 (all-read).
mkdir -p "$VAR_LIB_MIRA"
chmod 755 "$VAR_LIB_MIRA"

echo "=== host_perm_setup: done ==="
