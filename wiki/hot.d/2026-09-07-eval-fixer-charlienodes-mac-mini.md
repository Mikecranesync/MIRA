# eval-fixer run — 2026-09-07 (charlienodes-mac-mini)

- Scorecard: 49/65 passing (75%)
- Action: issue-filed (commented on rolling tracker #1876)
- **The suite is nondeterministic — 26/65 fixtures (40%) flip across the last 9 runs.**
  On engine code identical either side of the only relevant commit (`c748cd8ef`), the pass
  rate ranged 52–58; band across 9 runs is 49–58. Cause: `offline_run.py` defaults to
  `INFERENCE_BACKEND=cloud`, so "offline" means *no VPS*, not deterministic — it runs the
  live Groq→Cerebras→Together cascade.
- Consequence: **Step 7's autopatch gate (single before/after full-suite pass count) is
  statistically invalid** — ±6 noise swamps any plausible patch delta, so a no-op patch
  would "verify" ~half the time. Proposed valid gate: N=3 repeats on the 5 chronic fixtures.
- Deterministic residue is only **5 fixtures, all `cp_reached_state`** (4 fail 9/9,
  `gs20_cross_vendor_03` 8/9); 11 of tonight's 16 failures are flippers.
- Also found: 2 of 3 "needs human review" failures are a **grader false positive** —
  `120PSI`/`90°C` are placeholder examples in MIRA's own option menu (`engine.py:4319`);
  `answer_qc.py::_assertions_only()` already strips these, but `tests/eval/grader.py` has
  no equivalent guard. **Fix verified empirically** — the grader regex on MIRA's own menu
  yields exactly `['120PSI','90°C']` and `_assertions_only()` clears it to `[]`.
- Autopatch skipped: 3 `file_clusters` keys (hard stop) — plus that hard stop is
  effectively always true, which is a spec bug noted on the tracker.
- No patch applied; clean tree, `main` @ `9dd5057`.
