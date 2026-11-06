# scorecards/

- `t4-77-k6-scorecard.*`, `t4-77-k10-scorecard.*`, `t4-77-k*.jsonl`: produced by #4589's `scorecard.py`.
  - **Their "OFF" and "ON" columns mean the pre-fix and candidate REVISIONS** (`b980d42db` vs `cc0d26c1d`), both
    with lexical-v2 off.
  - They do **not** mean lexical-v2 off/on. The real lexical-v2-ON arm is `post-lexv2` in `../results.json`.
  - The "INCONCLUSIVE" headline there is #4589's release gate (it needs 100/20/20 cases). It is not this
    benchmark's verdict.
- `hist-off-k10.jsonl`: #4589's historical OFF receipt. Pre-fix t4-77 matches it 77/77 page for page.
- `scorer-red-runs.json`: output of `../scorer_red_runs.py`.
- `forum-verify-red-runs.txt`: output of `../forum_verify_red_runs.py`.
- `injected-defect-check.txt`: output of `../injected_defect_check.py`.
