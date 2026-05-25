# tests/qa_regression — MIRA QA regression routine

Phase 1 boundary-level regression smoke for the staging Telegram bot.

- **Spec:** `docs/specs/mira-qa-regression-routine-spec.md`
- **Runner:** `tests/qa_regression.py`
- **Question set:** `tests/qa_regression_questions.yaml`
- **Baseline:** `tests/qa_regression_baseline.json`
- **CI:** `.github/workflows/qa-regression.yml` (every 2 hours)

## Local quickstart

```bash
# Smoke (no Telethon, no LLM keys, mock replies)
python tests/qa_regression.py --dry-run

# Live staging run
doppler run --project factorylm --config stg -- python tests/qa_regression.py

# Seed the locked baseline from a clean staging run
doppler run --project factorylm --config stg -- python tests/qa_regression.py --seed-baseline
```

`runs/` is gitignored — each run drops `<UTC-stamp>-raw.json` and
`<UTC-stamp>.md` here. CI uploads them as a workflow artifact instead.

## Why this exists

`tests/mira_bench.py` calls the engine directly. Production regressions in
2026 (the embedding-gate that killed BM25 — issue #1385; the VPS chat-path
crash-loop on 2026-05-15; the GS11 demo failure on 2026-05-18) all
manifested at the bot boundary, **not** inside the engine. This routine
treats the staging bot as a black box and grades it like a synthetic
technician would.
