#!/usr/bin/env bash
# Polls every 30s for merge state changes on the watch-list. Emits one line per new merge.
WATCH="608 642 643 644 646 652 728 732"
SEEN=seen-merges.txt
touch "$SEEN"
echo "[$(date -u +%H:%M:%S)] watching: $WATCH"
while true; do
  for pr in $WATCH; do
    line=$(gh pr view "$pr" --json state,mergedAt,mergeCommit --jq '.state + "|" + (.mergedAt // "") + "|" + (.mergeCommit.oid // "")' 2>/dev/null || echo "ERR||")
    if [[ "$line" == MERGED* ]]; then
      if ! grep -q "^$pr|" "$SEEN"; then
        echo "[$(date -u +%H:%M:%S)] MERGED: PR #$pr | $line"
        echo "$pr|$line" >> "$SEEN"
      fi
    fi
  done
  sleep 30
done
