#!/bin/bash
# ============================================================
# FactoryLM Master Crontab Installer — "Master of Puppets"
# Source of truth for ALL digital employee cron schedules.
#
# Usage:
#   ssh factorylm-prod "cd /opt/mira && bash scripts/install_crons.sh"
#
# Schedule (all times ET, stored as UTC):
#   02:00 Carlos — KB Growth          (06:00 UTC)
#   04:00 Sarah  — QA Benchmark       (08:00 UTC)
#   05:00 Dana   — Morning Brief      (09:00 UTC)
#   06:00 Linda  — Safety Scan        (10:00 UTC)
#   08:00 Alex   — Inbox Triage       (12:00 UTC)
#   10:00 Scout  — Lead Discovery     (14:00 UTC)
#   12:00 Team   — Content Draft      (16:00 UTC)
#   14:00 Marcus — Billing Health     (18:00 UTC)
#   16:00 CMMS   — Data Sync          (20:00 UTC)
#   18:00 Intel  — Asset Enrichment   (22:00 UTC)
#   20:00 Research — Corpus Refresh   (00:00 UTC next day)
#   22:00 PM Agent — Escalation Check (02:00 UTC next day)
#   00:00 System — Daily Digest       (04:00 UTC)
#
# Each agent reads shared state from /opt/mira/agent_state/daily_context.json
# and writes results back so later agents can build on earlier work.
#
# Idempotent — re-running replaces the full crontab cleanly.
# ============================================================
set -euo pipefail

MIRA_DIR="${MIRA_DIR:-/opt/mira}"
LOG_DIR="${LOG_DIR:-/var/log/mira-agents}"
PYTHON="${PYTHON:-python3}"
AGENTS_DIR="\$MIRA_DIR/mira-crawler/agents"

echo "=== FactoryLM Crontab Installer — Master of Puppets ==="
echo "MIRA_DIR : $MIRA_DIR"
echo "LOG_DIR  : $LOG_DIR"

mkdir -p "$LOG_DIR"
mkdir -p "$MIRA_DIR/agent_state"

INSTALLED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

TMPFILE="$(mktemp /tmp/mira_crontab.XXXXXX)"
trap 'rm -f "$TMPFILE"' EXIT

cat > "$TMPFILE" << CRONTAB
# ═══════════════════════════════════════════════════════════════
# FactoryLM Digital Employee Roster — Master of Puppets
# Managed by: $MIRA_DIR/scripts/install_crons.sh
# Last installed: $INSTALLED_AT
# DO NOT edit this crontab manually — edit install_crons.sh instead.
#
# Agents communicate through /opt/mira/agent_state/daily_context.json
# Each agent reads what earlier agents wrote. Later agents build on it.
# ═══════════════════════════════════════════════════════════════

MIRA_DIR=$MIRA_DIR
LOG_DIR=$LOG_DIR
PATH=/usr/local/bin:/usr/bin:/bin

# ─── 24-HOUR SEQUENTIAL CYCLE ───────────────────────────────────────────────
# Times shown are ET. Stored as UTC (ET + 4h in summer / +5h in winter).
# Summer (EDT, UTC-4):

# 02:00 ET — Carlos (KB Growth): ingest next manual from queue
0 6 * * *    cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_kb_growth.py >> \$LOG_DIR/kb_growth.log 2>&1

# 04:00 ET — Sarah (QA Benchmark): run intelligence loop post-ingest
0 8 * * *    cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_qa_benchmark.py >> \$LOG_DIR/qa_benchmark.log 2>&1

# 05:00 ET — Dana (Morning Brief): compile overnight summary
0 9 * * *    cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_morning_brief.py >> \$LOG_DIR/morning_brief.log 2>&1

# 06:00 ET — Linda (Safety Scan): scan new KB content for safety procedures
0 10 * * *   cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_safety_scan.py >> \$LOG_DIR/safety_scan.log 2>&1

# 08:00 ET — Alex (Inbox Triage): categorize email
0 12 * * *   cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_inbox_triage.py >> \$LOG_DIR/inbox_triage.log 2>&1

# 10:00 ET — Scout (Lead Discovery): find ICP facilities
0 14 * * *   cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_lead_scout.py >> \$LOG_DIR/lead_scout.log 2>&1

# 12:00 ET — Content Team (Social Draft): draft LinkedIn post
0 16 * * *   cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_content_draft.py >> \$LOG_DIR/content_draft.log 2>&1

# 14:00 ET — Marcus (Billing Health): check Stripe MRR + issues
0 18 * * *   cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_billing_health.py >> \$LOG_DIR/billing_health.log 2>&1

# 16:00 ET — CMMS Sync: bidirectional Atlas sync
0 20 * * *   cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_cmms_sync.py >> \$LOG_DIR/cmms_sync.log 2>&1

# 18:00 ET — Asset Intelligence: enrich new assets
0 22 * * *   cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_asset_intel.py >> \$LOG_DIR/asset_intel.log 2>&1

# 20:00 ET — Research (Corpus Refresh): pull new Reddit Q&A
0 0 * * *    cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_corpus_refresh.py >> \$LOG_DIR/corpus_refresh.log 2>&1

# 22:00 ET — PM Escalation: flag overdue PMs + due tomorrow
0 2 * * *    cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_pm_escalation.py >> \$LOG_DIR/pm_escalation.log 2>&1

# 00:00 ET — System Daily Digest: summarize all 12 agents
0 4 * * *    cd \$MIRA_DIR && doppler run -- $PYTHON $AGENTS_DIR/run_daily_digest.py >> \$LOG_DIR/daily_digest.log 2>&1

# ─── WEEKLY / SPECIAL ────────────────────────────────────────────────────────

# Social publisher: Tue + Thu 7:30 AM ET (11:30 UTC)
# Reads linkedin_queue.json, posts approved items
30 11 * * 2,4  cd \$MIRA_DIR && doppler run -- $PYTHON mira-crawler/social/publisher.py --publish >> \$LOG_DIR/social_publish.log 2>&1

# Weekly benchmark suite: Friday 10 PM ET (Saturday 2 UTC)
# Full 39-case golden eval against live pipeline
0 2 * * 6     cd \$MIRA_DIR && doppler run -- $PYTHON -m pytest tests/eval/ -q --tb=short >> \$LOG_DIR/benchmark_weekly.log 2>&1

# YouTube transcript harvester: Monday 4 AM UTC
0 4 * * 1     cd \$MIRA_DIR && doppler run -- $PYTHON mira-bots/benchmarks/corpus/youtube_harvester.py --source manual --limit 20 >> \$LOG_DIR/youtube_harvest.log 2>&1

CRONTAB

LINE_COUNT=$(grep -c '^[^#[:space:]]' "$TMPFILE" || true)
echo "Active jobs in new crontab: $LINE_COUNT"

crontab "$TMPFILE"
echo ""
echo "✓ Crontab installed at $INSTALLED_AT"
echo ""
echo "=== Active schedule ==="
crontab -l
echo ""
echo "=== Log directory ==="
ls -la "$LOG_DIR"
