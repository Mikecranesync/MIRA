#!/usr/bin/env bash
# publish-bulk.sh — produce + upload N consecutive videos from the queue.
#
# Usage:
#   ./tools/yt-pipeline/publish-bulk.sh <count>
#
# Each video takes ~3-5 min (Groq + OpenAI TTS + ffmpeg + YouTube upload).
# Logs land in /tmp/yt-pipeline-bulk.log so you can tail progress.
#
# If a run fails (token revoked, OpenAI quota, etc.), the failure is
# logged and we KEEP GOING — main.py already preserves the MP4 to
# drafts on upload failure, so no video is lost. The loop stops only on
# 3 consecutive failures (matches main.py's pause-sentinel threshold).

set -uo pipefail  # NOT -e; we want to handle errors per-iteration

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

COUNT="${1:?usage: publish-bulk.sh <count>}"
LOG="/tmp/yt-pipeline-bulk.log"
: > "$LOG"

echo "[$(date)] starting bulk publish: $COUNT videos" | tee -a "$LOG"

successes=0
failures=0
consecutive_failures=0

for i in $(seq 1 "$COUNT"); do
  echo "[$(date)] === video $i / $COUNT ===" | tee -a "$LOG"

  doppler run --project factorylm --config prd -- \
    python3.12 -m tools.yt_pipeline.main --force >>"$LOG" 2>&1

  rc=$?
  if [ "$rc" -eq 0 ]; then
    # Pull the latest YouTube URL from the log (last line matching the upload-success pattern)
    latest_url=$(grep -oE 'https://youtube\.com/watch\?v=[A-Za-z0-9_-]+' "$LOG" | tail -1)
    echo "[$(date)] OK video $i: $latest_url" | tee -a "$LOG"
    successes=$((successes + 1))
    consecutive_failures=0
  else
    echo "[$(date)] FAIL video $i (rc=$rc)" | tee -a "$LOG"
    failures=$((failures + 1))
    consecutive_failures=$((consecutive_failures + 1))
    if [ "$consecutive_failures" -ge 3 ]; then
      echo "[$(date)] STOP: 3 consecutive failures. Inspect $LOG and Doppler." | tee -a "$LOG"
      exit 1
    fi
  fi

  # Brief pause so YouTube API quotas don't think we're hammering them.
  sleep 5
done

echo "[$(date)] done. successes=$successes failures=$failures" | tee -a "$LOG"
