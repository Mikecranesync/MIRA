#!/bin/bash

# Fetch all GitHub issues from gh-refs.json
# Output to gh-status.json

MIRA_REFS=$(jq -r '.mira[]' gh-refs.json | tr '\n' ' ')
FACTORYLM_REFS=$(jq -r '.factorylm[]' gh-refs.json | tr '\n' ' ')

> gh-status.json
echo "{" >> gh-status.json

FIRST=true
CALL_COUNT=0

# Fetch mira issues
for NUM in $MIRA_REFS; do
  if [ $CALL_COUNT -ge 60 ]; then
    echo "Hard cap reached (60 calls)" >&2
    break
  fi
  
  RESULT=$(gh issue view "$NUM" --repo Mikecranesync/mira --json number,state,closedAt,title,labels 2>/dev/null)
  if [ $? -eq 0 ]; then
    # Parse JSON response
    NUM_VAL=$(echo "$RESULT" | jq '.number')
    STATE=$(echo "$RESULT" | jq -r '.state')
    CLOSED_AT=$(echo "$RESULT" | jq -r '.closedAt // "null"')
    TITLE=$(echo "$RESULT" | jq -r '.title')
    LABELS=$(echo "$RESULT" | jq '.labels')
    
    if [ "$FIRST" = false ]; then echo "," >> gh-status.json; fi
    FIRST=false
    
    cat >> gh-status.json << ENTRY
  "mira#$NUM": {
    "repo": "mira",
    "num": $NUM_VAL,
    "state": "$STATE",
    "closedAt": $CLOSED_AT,
    "title": $TITLE,
    "labels": $LABELS
  }
ENTRY
  else
    # 404 or error
    if [ "$FIRST" = false ]; then echo "," >> gh-status.json; fi
    FIRST=false
    cat >> gh-status.json << ENTRY
  "mira#$NUM": {
    "repo": "mira",
    "num": $NUM,
    "state": "unknown",
    "closedAt": null,
    "title": null,
    "labels": []
  }
ENTRY
  fi
  
  CALL_COUNT=$((CALL_COUNT + 1))
  sleep 0.1
done

# Fetch factorylm issues
for NUM in $FACTORYLM_REFS; do
  if [ $CALL_COUNT -ge 60 ]; then
    echo "Hard cap reached (60 calls)" >&2
    break
  fi
  
  RESULT=$(gh issue view "$NUM" --repo Mikecranesync/factorylm --json number,state,closedAt,title,labels 2>/dev/null)
  if [ $? -eq 0 ]; then
    NUM_VAL=$(echo "$RESULT" | jq '.number')
    STATE=$(echo "$RESULT" | jq -r '.state')
    CLOSED_AT=$(echo "$RESULT" | jq -r '.closedAt // "null"')
    TITLE=$(echo "$RESULT" | jq -r '.title')
    LABELS=$(echo "$RESULT" | jq '.labels')
    
    if [ "$FIRST" = false ]; then echo "," >> gh-status.json; fi
    FIRST=false
    
    cat >> gh-status.json << ENTRY
  "factorylm#$NUM": {
    "repo": "factorylm",
    "num": $NUM_VAL,
    "state": "$STATE",
    "closedAt": $CLOSED_AT,
    "title": $TITLE,
    "labels": $LABELS
  }
ENTRY
  else
    if [ "$FIRST" = false ]; then echo "," >> gh-status.json; fi
    FIRST=false
    cat >> gh-status.json << ENTRY
  "factorylm#$NUM": {
    "repo": "factorylm",
    "num": $NUM,
    "state": "unknown",
    "closedAt": null,
    "title": null,
    "labels": []
  }
ENTRY
  fi
  
  CALL_COUNT=$((CALL_COUNT + 1))
  sleep 0.1
done

echo "" >> gh-status.json
echo "}" >> gh-status.json

echo "Fetched $CALL_COUNT issues"
