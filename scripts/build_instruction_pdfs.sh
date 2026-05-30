#!/usr/bin/env bash
# Render every docs/instructions/*.html to a sibling .pdf via Chrome headless.
# Contract is set by ~/.claude/skills/plc-instruction-guide/references/build-pdf.md
# — do not change flag names or output naming without updating that reference.
#
# Usage:
#   scripts/build_instruction_pdfs.sh                      # build everything
#   scripts/build_instruction_pdfs.sh -f Conv_Simple_*.html
#   scripts/build_instruction_pdfs.sh -f Stub.html -o      # open after

set -euo pipefail

filter="*.html"
open_after=0

while getopts ":f:o" opt; do
  case $opt in
    f) filter="$OPTARG" ;;
    o) open_after=1 ;;
    *) echo "usage: $0 [-f FILTER] [-o]" >&2; exit 2 ;;
  esac
done

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
instructions_dir="$repo_root/docs/instructions"

if [[ ! -d "$instructions_dir" ]]; then
  echo "docs/instructions/ not found at $instructions_dir" >&2
  exit 2
fi

# Find Chrome.
chrome=""
for candidate in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/usr/bin/google-chrome" \
  "/usr/bin/chromium" \
  "/usr/bin/chromium-browser" \
  "/c/Program Files/Google/Chrome/Application/chrome.exe" \
  "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"; do
  if [[ -x "$candidate" ]]; then chrome="$candidate"; break; fi
done
if [[ -z "$chrome" ]] && command -v google-chrome >/dev/null 2>&1; then
  chrome="$(command -v google-chrome)"
fi
if [[ -z "$chrome" ]] && command -v chromium >/dev/null 2>&1; then
  chrome="$(command -v chromium)"
fi
if [[ -z "$chrome" ]]; then
  echo "Chrome not found. Install Google Chrome or edit the candidate list at the top of this script." >&2
  exit 3
fi

errors=0
shopt -s nullglob
matched=("$instructions_dir"/$filter)
if [[ ${#matched[@]} -eq 0 ]]; then
  echo "No HTML files matched filter '$filter' in $instructions_dir"
  exit 0
fi

for html in "${matched[@]}"; do
  [[ "$html" == *.html ]] || continue
  pdf="${html%.html}.pdf"

  # --headless=new is required since Chrome 109; legacy --headless produces blank PDFs.
  "$chrome" \
    --headless=new \
    --disable-gpu \
    --no-pdf-header-footer \
    --print-to-pdf-no-header \
    --print-to-pdf="$pdf" \
    "file://$html" >/dev/null 2>&1 || true

  if [[ ! -f "$pdf" ]]; then
    echo "FAIL: $(basename "$html")"
    errors=$((errors + 1))
    continue
  fi
  size=$(wc -c < "$pdf" | tr -d ' ')
  if [[ "$size" -lt 1024 ]]; then
    echo "WARN: $(basename "$html") -> only $size bytes (likely render failure; open the HTML in Chrome directly)"
    errors=$((errors + 1))
    continue
  fi
  echo "OK ($size bytes): $(basename "$html")"

  if [[ "$open_after" -eq 1 ]]; then
    if command -v open >/dev/null 2>&1; then open "$pdf"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$pdf"
    fi
  fi
done

if [[ "$errors" -gt 0 ]]; then
  echo "$errors file(s) failed." >&2
  exit 1
fi
