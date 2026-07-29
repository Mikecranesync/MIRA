# Tower OP (Kid Power Towers) Real-Print Benchmark — 2026-07-18

Reproducible benchmark of the REAL Telegram print-translator path against 12 phone photos of the
Heege "Tower OP" electrical print set (doc 53-075-113-3 EN + PLC LED tables 53-075-101-4 EN).
Results + analysis: **`REPORT.md`**. Verbatim per-case captures: `evidence-laneA/` (first run,
parallel waves of 3) and `evidence-laneB/` (sequential re-run; proved run-to-run failure-class
stability). Judged verdicts are embedded in REPORT.md.

## What "the real path" means

`bench_submit.py` → `tools/internet_print_test/submit.py` → imports the actual
`mira-bots/telegram/bot.py` and calls the LITERAL production handler
`_try_print_translator_reply(raw_bytes, vision_bytes, caption, update, context)`.
No mocks, no live Telegram connection, no bot token. Spies capture classification, OCR items,
the byte-for-byte user-facing reply, provider/latency, and the structured graph.

## Prerequisites

1. **Repo state:** any checkout of `main` (this run: `2e6fdd0e`, includes the #2788 vision fix).
2. **Python env:** repo `.venv` (3.12) **plus** `mira-bots/telegram/requirements.txt`
   (`python-telegram-bot` is NOT in the default venv — this bit us):
   `uv pip install --python .venv/bin/python -r mira-bots/telegram/requirements.txt`
3. **Secrets:** `doppler -p factorylm -c stg` (cascade provider keys). Never prod.
4. **tesseract** on PATH (`brew install tesseract`; on CHARLIE prefix `/opt/homebrew/bin`).
   NOTE: tesseract only feeds the backup `tesseract_text` channel — `ocr_items` (what the
   deterministic layer consumes) come exclusively from glm-ocr via `OLLAMA_BASE_URL`. If that
   endpoint is unreachable/disabled you are measuring **cascade-freestyle mode** (see REPORT.md
   "deployment smoking gun"). State which mode you measured.
5. **Photos:** NOT committed (stamped PROPRIETARY). Re-download from Mike's Drive using
   `photos.manifest.json` (gdrive file ids) and **verify each sha256 before use** — a wrong or
   re-compressed photo invalidates comparisons.

## Re-run

```bash
# from repo root; photos in $PHOTOS; results into $OUT
export PATH="/opt/homebrew/bin:$PATH"
jq -c '.[]' tools/internet_print_test/benchmarks/2026-07-18-towerop/cases.json |
while read -r c; do
  id=$(jq -r .id <<<"$c"); photo=$(jq -r .photo <<<"$c"); q=$(jq -r .question <<<"$c")
  doppler run -p factorylm -c stg -- .venv/bin/python \
    tools/internet_print_test/benchmarks/2026-07-18-towerop/bench_submit.py \
    "$PHOTOS/$photo" "$q" "rerun-$id" "$OUT/$id.json"
done
```

Run **sequentially** (free-tier rate limits). ~20–35 s per case that reaches the pipeline;
~0.3 s cases were dropped by the caption gate (bug R1 in REPORT.md) — that speed IS the finding.

## Judging protocol (what produced the verdicts in REPORT.md)

One independent vision judge per case (Claude agent — deliberately NOT any provider in the
answer path). The judge: (1) Reads the actual photo; (2) reads `final_text` from the evidence
JSON; (3) grades adversarially against the question and the `expected` field in `cases.json`
(which came from an independent OCR pass — the judge re-verifies against the photo, never
trusts `expected` blindly). Schema per case:
`verdict pass|partial|fail · correctness_0_10 · question_answered_directly ·
invented_tags[] · coordinate_or_lookup_accuracy · honesty_caveat_present ·
grounded_in_print · key_failure · notes`.
Scoring stance: plausible-but-unverifiable claims score low; every device tag the reply names
must exist on that sheet; state claims require the "a print never shows live state" caveat.

The original run orchestrated submits (waves of 3) + 12 judges via a Workflow
(run `wf_b33ab427-1de`, 20 agents). Any equivalent harness works — the protocol above is
what matters.

## Comparing a new run

Failure classes to track (stable across our two lanes): fabricated device tags · confident
wrong-device answers (S7.1→S5.1) · "not labeled" refusals for printed text · wrong coordinate
convention (German sheet/column grid) · routing drops (caption gate / EQUIPMENT_PHOTO
misclassification). A fix claims credit only if its class disappears while the others hold —
report per-class, not a single number (multi-cause discipline).
