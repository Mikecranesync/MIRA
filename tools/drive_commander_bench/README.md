# Drive Commander benchmark harness

Deterministic, `$0`, hermetic implementation of **Lane A** from
`docs/drive_commander/DRIVE_COMMANDER_BENCHMARK_SPEC.md` — the pack-lookup lane
(no vision, no LLM, no network). It drives the real `shared.drive_packs`
reuse-map callables against a sha256-frozen corpus and grades each case against
the spec's hard gates.

## Run

```bash
# from repo root (UTF-8 mirrors CI/Linux; Windows default cp1252 breaks the JSON read)
PYTHONUTF8=1 python tools/drive_commander_bench/runner.py

# self-tests (proves the grader has teeth + the corpus is frozen)
PYTHONUTF8=1 python -m pytest tools/drive_commander_bench/test_bench.py -q
```

Exit 0 iff every case passes all hard gates and the corpus hash is intact.
`runner.py --freeze` prints the current corpus hash (update `_FROZEN_SHA` only
when intentionally changing the corpus).

## What it measures

- **Hard gates** (auto-fail): fabrication, wrong/absent citation, non-pack
  answer presented as pack, code mutation, missing honest decline, silent
  family guess.
- **Lane F zero-token coverage:** % of answerable cases served by tier-1 exact
  lookup (no LLM). Lane A is 100% by construction.

## Corpus

`corpus/lane_a_v1.json` — truth seeded **only** from the human-verified source
pins in `mira-bots/tests/test_drive_pack_truth_pins.py` (#2777), so no expected
value is authored here that isn't already pinned against a hash-pinned public
manual. All source manuals are public (AutomationDirect / Rockwell); **no PDFs,
photos, or restricted material are committed.**

## Scope (honest)

This is **Lane A only** — the deterministic core. Lanes B/C (vision/OCR/full
path) and D/E (adversarial/Q&A) are specified in the benchmark doc but require
the metered photo pre-stage (or mocked workers per
`mira-bots/tests/test_engine_photo_fault_bridge.py`) and are **not** run here.
Extending this harness to the mocked-worker Lane C is the next `$0` step.
