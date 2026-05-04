#!/bin/bash
# ============================================================
# FactoryLM Agent Deployment Script
# Deploys all built agents to the VPS and installs the
# master crontab. Closes #852.
#
# Usage (from local machine):
#   ssh factorylm-prod "cd /opt/mira && bash scripts/deploy_agents.sh"
#
# Or via make:
#   make deploy-agents
# ============================================================
set -euo pipefail

MIRA_DIR="${MIRA_DIR:-/opt/mira}"
BOT_CONTAINER="${BOT_CONTAINER:-mira-bot-telegram}"

echo "=== FactoryLM Agent Deployment ==="
echo "Dir: $MIRA_DIR"
echo "Bot container: $BOT_CONTAINER"
echo ""

# ─── 1. Pull latest code ──────────────────────────────────────────────────────
echo "--- Step 1: git pull ---"
cd "$MIRA_DIR"
git pull --rebase origin main
echo ""

# ─── 2. Copy agent runner scripts into bot container ─────────────────────────
# The mira-hub TypeScript agents are called by lightweight Python runner shims
# that live in mira-bots/agents/. Copy those into the running container.
echo "--- Step 2: Copy agent runners into $BOT_CONTAINER ---"

AGENT_RUNNERS="$MIRA_DIR/mira-bots/agents"
if [ -d "$AGENT_RUNNERS" ]; then
    docker cp "$AGENT_RUNNERS/." "$BOT_CONTAINER:/app/agents/" 2>/dev/null && \
        echo "✓ Agent runners copied" || \
        echo "⚠ docker cp failed (container may not be running) — skipping"
else
    echo "⚠ $AGENT_RUNNERS not found — skipping agent runner copy"
    echo "  Create mira-bots/agents/ with runner shims to enable this step."
fi
echo ""

# ─── 3. Verify agents are accessible inside container ────────────────────────
echo "--- Step 3: Verify container contents ---"
if docker exec "$BOT_CONTAINER" ls /app/agents/ 2>/dev/null; then
    echo "✓ Agents directory accessible"
else
    echo "⚠ Could not list /app/agents/ in $BOT_CONTAINER"
    echo "  Container may be restarting — agents will be available after next deploy."
fi
echo ""

# ─── 4. Log directory ────────────────────────────────────────────────────────
echo "--- Step 4: Ensure log directory ---"
mkdir -p /var/log/mira-agents
echo "✓ /var/log/mira-agents ready"
echo ""

# ─── 5. Install master crontab ───────────────────────────────────────────────
echo "--- Step 5: Install crontab ---"
bash "$MIRA_DIR/scripts/install_crons.sh"
echo ""

# ─── 6. Smoke check — verify publisher works ─────────────────────────────────
echo "--- Step 6: Publisher smoke check ---"
cd "$MIRA_DIR"
if doppler run -- python3 mira-crawler/social/publisher.py --status 2>/dev/null; then
    echo "✓ Publisher OK"
else
    echo "⚠ Publisher check failed — check doppler secrets"
fi
echo ""

echo "=== Deployment complete ==="
echo ""
echo "Active crons:"
crontab -l | grep -v '^#' | grep -v '^$' | sed 's/^/  /'
