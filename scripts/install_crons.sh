#!/bin/bash
# ============================================================
# FactoryLM Master Crontab Installer
# Source of truth for ALL digital employee cron schedules.
#
# Usage:
#   ssh factorylm-prod "cd /opt/mira && bash scripts/install_crons.sh"
#
# Idempotent — re-running replaces the full crontab cleanly.
# Add new agents here. Never edit crontab directly on the VPS.
# ============================================================
set -euo pipefail

MIRA_DIR="${MIRA_DIR:-/opt/mira}"
LOG_DIR="${LOG_DIR:-/var/log/mira-agents}"
PYTHON="${PYTHON:-python3}"

echo "=== FactoryLM Crontab Installer ==="
echo "MIRA_DIR : $MIRA_DIR"
echo "LOG_DIR  : $LOG_DIR"

mkdir -p "$LOG_DIR"

INSTALLED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Build crontab in a temp file — heredoc so the whole schedule is one place
TMPFILE="$(mktemp /tmp/mira_crontab.XXXXXX)"
trap 'rm -f "$TMPFILE"' EXIT

cat > "$TMPFILE" << CRONTAB
# ═══════════════════════════════════════════════════════════════
# FactoryLM Digital Employee Roster — Master Cron Schedule
# Managed by: $MIRA_DIR/scripts/install_crons.sh
# Last installed: $INSTALLED_AT
# DO NOT edit this crontab manually — edit install_crons.sh instead.
# ═══════════════════════════════════════════════════════════════

MIRA_DIR=$MIRA_DIR
LOG_DIR=$LOG_DIR
PATH=/usr/local/bin:/usr/bin:/bin

# ─── DATA ENGINEERING ───────────────────────────────────────────────────────

# KB Growth: process one PDF from manual_queue.json every 6 hours
# Closes #845 — CMMS/KB autonomous growth
0 */6 * * *   cd \$MIRA_DIR && doppler run -- $PYTHON mira-crawler/cron/kb_growth_cron.py >> \$LOG_DIR/kb_growth.log 2>&1

# Reddit corpus refresh: weekly Sunday 3 AM
# Populates mira-bots/benchmarks/corpus/ with fresh Q&A for evals
0 3 * * 0     cd \$MIRA_DIR && doppler run -- $PYTHON mira-bots/benchmarks/corpus/scraper.py --subreddits all --limit 500 --time-filter week >> \$LOG_DIR/corpus_refresh.log 2>&1

# YouTube transcript harvester: Monday 4 AM
# Adds expert video knowledge chunks to the corpus
0 4 * * 1     cd \$MIRA_DIR && doppler run -- $PYTHON mira-bots/benchmarks/corpus/youtube_harvester.py --source manual --limit 20 >> \$LOG_DIR/youtube_harvest.log 2>&1

# ─── MARKETING ──────────────────────────────────────────────────────────────

# Social publisher: Tue + Thu 7:30 AM ET (11:30 UTC)
# Reads linkedin_queue.json, posts approved items via Zernio/Buffer/clipboard
# Closes #838 — Social Media Publisher
30 11 * * 2,4  cd \$MIRA_DIR && doppler run -- $PYTHON mira-crawler/social/publisher.py --publish >> \$LOG_DIR/social_publish.log 2>&1

# ─── MAINTENANCE OPERATIONS (via Docker) ────────────────────────────────────

# Morning Brief: daily 5 AM ET (9 UTC)
# Sends overnight WO summary via Telegram
0 9 * * *     docker exec mira-bot-telegram $PYTHON /app/agents/morning_brief_runner.py >> \$LOG_DIR/morning_brief.log 2>&1

# PM Escalation: daily 8 AM ET (12 UTC)
# Flags overdue preventive maintenance tasks
0 12 * * *    docker exec mira-bot-telegram $PYTHON /app/agents/pm_escalation_runner.py >> \$LOG_DIR/pm_escalation.log 2>&1

# Safety Alert sweep: daily 6 AM ET (10 UTC)
# Checks for safety keyword triggers in recent conversations
0 10 * * *    docker exec mira-bot-telegram $PYTHON /app/agents/safety_alert_runner.py >> \$LOG_DIR/safety_alert.log 2>&1

# ─── QUALITY ASSURANCE ──────────────────────────────────────────────────────

# Weekly benchmark suite: Friday 10 PM ET (Saturday 2 UTC)
# Runs the 39 golden-case eval against the live pipeline
0 2 * * 6     cd \$MIRA_DIR && doppler run -- $PYTHON -m pytest tests/eval/ -q --tb=short >> \$LOG_DIR/benchmark_weekly.log 2>&1

# ─── FINANCE ────────────────────────────────────────────────────────────────

# Stripe billing health: Monday 8 AM ET (12 UTC)
# Checks failed payments, expiring cards, MRR — Closes #849
0 12 * * 1    cd \$MIRA_DIR && doppler run -- $PYTHON mira-crawler/tasks/billing_health.py >> \$LOG_DIR/billing_health.log 2>&1

CRONTAB

# Validate the temp file has content
LINE_COUNT=$(grep -c '^[^#[:space:]]' "$TMPFILE" || true)
echo "Active jobs in new crontab: $LINE_COUNT"

# Install
crontab "$TMPFILE"
echo ""
echo "✓ Crontab installed at $INSTALLED_AT"
echo ""
echo "=== Active schedule ==="
crontab -l
echo ""
echo "=== Log directory ==="
ls -la "$LOG_DIR"
