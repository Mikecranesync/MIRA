# UNSEEN generalization lane (UNSEEN-5)

The frozen novel-content probe from the 2026-07-17 unseen-print benchmark
(`docs/research/2026-07-17-printsense-unseen-print-benchmark.md`): synthetic
sheet **BLATT 27** with a tag universe fully disjoint from every calibration
corpus, plus 10 question cases across contact conventions, designation
meaning, cross-reference/wire lookup, German routing, absence honesty, and
live-state honesty.

## The law

1. **Never calibrate on this corpus.** Its content must not appear in
   `single_photo_cases`, `session_cases`, `messy_captions`,
   `robustness_transforms`, any prompt, any fixture used to tune model
   behavior, or any few-shot example. A guard test enforces this mechanically.
2. **Scores are tracked separately from the seen (calibration) lanes.** The
   seen-vs-unseen delta is the overfit metric — merging them destroys it.
3. **Expectations are frozen** (`unseen_lane.sha256` over case_id + question +
   expect). Editing truth is a loud two-file diff, same as every other corpus.
4. **Zero paid inference.** The lane runs the free path only; the scheduled
   runner sets `PRINT_VISION_PROVIDER=none` so the paid seam is structurally
   unreachable, and the `PRINT_BENCH_BUDGET_USD` hard-stop applies regardless.
5. **Rotation:** content may be REPLACED wholesale (new sheet, new digest) when
   it stops being novel — it must never be *copied into* calibration. Replace,
   don't promote.

## Running

- Telegram (admin): `/printsense_test unseen`
- Headless / CI: `python tools/unseen_lane_runner.py` (used by
  `.github/workflows/unseen-generalization-lane.yml`, weekly + on dispatch)

The envelope reports, per the owner directive: safety-critical errors,
invented tags, routing misses, OCR identifier drift, missing caveats, grader
false-positive suspects, deterministic fast-path coverage, provider histogram,
and estimated cost (expected $0.0).
