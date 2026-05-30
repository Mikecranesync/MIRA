#!/usr/bin/env bash
# Run 10 golden-question benchmark against the staging mira-pipeline (which
# wraps the same shared/engine.py Supervisor the Telegram bot uses). Saves
# raw JSON to /tmp/bench-staging-2026-05-20/, plus a CSV at
# tests/golden_staging_benchmark_2026-05-20.csv.
#
# Runs via `docker exec stg-mira-pipeline curl …` so the request comes from
# 127.0.0.1 inside the container — the pipeline auth middleware exempts
# localhost (mira-pipeline/main.py:307-310), so no PIPELINE_API_KEY needed.

set -euo pipefail

VPS=root@165.245.138.91
OUT_DIR=/tmp/bench-staging-2026-05-20
CSV=/Users/bravonode/Mira/tests/golden_staging_benchmark_2026-05-20.csv
mkdir -p "$OUT_DIR"

QUESTIONS=(
  "What are the modbus parameters for the GS11 drive?"
  "How do I wire RS-485 between a Micro820 and GS10?"
  "What is the default baud rate for the PowerFlex 525 serial port?"
  "My conveyor prox sensor shows occupied too long, what should I check?"
  "What are the fault codes for the GS10 VFD?"
  "How do I set up Modbus communication on the Micro820?"
  "What maintenance intervals does the Marathon Y56C motor require?"
  "I need the wiring diagram for panel E-12"
  "What safety procedures should I follow before working on a VFD?"
  "Compare the GS10 and GS11 drives"
)

printf 'idx,question,channel,answer,cites_sources,page_numbers,grounded_vs_generic,quality_score,notes\n' > "$CSV"

i=1
for q in "${QUESTIONS[@]}"; do
  echo "[bench] Q$i: $q"
  payload=$(jq -nc --arg q "$q" '{model:"mira-diagnostic",messages:[{role:"user",content:$q}]}')
  resp=$(ssh "$VPS" "docker exec stg-mira-pipeline curl -sS -X POST http://127.0.0.1:9099/v1/chat/completions -H 'content-type: application/json' -d '$payload'")
  printf '%s' "$resp" > "$OUT_DIR/q$i.json"
  ans=$(printf '%s' "$resp" | jq -r '.choices[0].message.content // .error // "(no content)"' | tr '\n' ' ' | sed 's/"/""/g')
  cites=$(printf '%s' "$ans" | grep -cE '\[[0-9]+\]|source:|cite|p\.[0-9]+' || true)
  pages=$(printf '%s' "$ans" | grep -cE 'p\.[0-9]+|page [0-9]+' || true)
  printf '%d,"%s",staging-pipeline,"%s",%d,%d,,,\n' "$i" "$q" "$ans" "$cites" "$pages" >> "$CSV"
  i=$((i+1))
done

echo
echo "Done. Raw JSON: $OUT_DIR"
echo "CSV:           $CSV"
