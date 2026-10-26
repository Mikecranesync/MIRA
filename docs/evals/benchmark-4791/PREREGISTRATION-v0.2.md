# Pre-registration — IMIB v0.2: benchmarking without a human answer key

Committed and pushed **before** any arm runs on the new sets. The commit that adds this file is the timestamp.
The v0.1 verdicts on #4791 stay under `PREREGISTRATION.md`, unchanged. Everything here is new evidence with its
own rules.

## New sets (frozen at this commit)

| Set | n | Answer key | Status |
|---|---|---|---|
| `oem-fault` | 174 (7 manuals, ≤ 30 each, seed 4791) | The manufacturer's fault/alarm/error table: the page where the code starts a table row. Row kept only if its name is on that page. | `oem_derived` (machine-extracted, page-checked) |
| `oem-index` | 162 (8 manuals) | The manufacturer's back-of-book index, mapped through printed page numbers. Kept only if every word of the entry is on the page. | `oem_derived` |
| `robust` | 1,264 variants of 251 base questions | Same pages as the base question; six fixed rewrite rules (lower, alias, typo, code, chatter, terse). | `oem_derived` / inherited |
| `forum-resolved` | registered later, in its own commit before its run | A real thread where the asker confirmed the fix; the identifier in the fix is matched to the manual by code | `community_resolved` |

**Known bias:** fault and index questions use the manual's own vocabulary and fixed templates. That makes them
easier than real wording, and is why `robust` and `forum-resolved` exist. Results are reported per set and never
pooled with real-wording sets.

## Arms

As in v0.1:
- `pre` b980d42db, `parent` e28bb182d, `post` cc0d26c1d, all with production flags, k=6;
- `bm25`, the outside baseline.

New in v0.2:
- `random`: pages of the question's manual in a seeded random order (seed 4791). This is the floor.
- `noexactlane`: cc0d26c1d with the doc-scoped exact-token lane disabled (`return [];` in `runExactLane`). This is a
  planted defect.

Runs: k=6 (the production call), 2 repeats each (determinism check).

## Validation tests: the benchmark must pass these before it is used to judge MIRA or to shrink Mike's queue

| Test | Pass when | If it fails |
|---|---|---|
| V1 discrimination | On `oem-fault`: `bm25` top-5 ≥ 0.50 **and** `random` top-5 ≤ 0.10 | The set cannot tell good retrieval from chance: unusable |
| V2 planted-defect sensitivity | On `oem-fault`: `post` vs `noexactlane` paired top-5 b − c ≥ 2 (the v0.1 NO-GO rule fires) | Reported as a coverage gap; the set is not a regression gate |
| V3 known-change sensitivity | On `oem-fault`: `pre` vs `post` differ on at least one top-5 hit, or the report says plainly that #4791 did not move this set | Descriptive; no verdict |
| V4 determinism | Every arm identical across its 2 repeats | The run is invalid; nothing scored |
| V5 key quality | `v02/test_v02_truth.py` green: known rows, every label page-checked, byte-reproducible build | No set is used |

## MIRA results on the new sets (decision rules)

- **#4791 on `oem-fault` and `oem-index`:**
  - **NO-GO** if b − c ≥ 2 at top-5 on either;
  - **GO** if c > b with exact McNemar p < 0.05, pooled over both;
  - otherwise **INCONCLUSIVE**.
- **Robustness:** for each rewrite rule, report top-5 hit retention (base hit kept under the variant) per arm,
  with Wilson 95% CIs. No verdict. A rule that keeps under 80% of base hits on `post` is flagged as a defect.

## AI labelers (paid; budget declared in `v02/BUDGET.md` before the first call)

- Non-Claude model families only, via OpenRouter, with prices read from its `/models` endpoint.
- **Calibration first:** each labeler labels `oem-fault` (blind, candidate pages shuffled).
- A labeler is **qualified** only if its chosen page matches the manufacturer page on **≥ 90%** of `oem-fault`
  cases. A disqualified labeler's forum labels are not used.
- Calibration on easy, manual-worded questions is necessary, not sufficient; the report says so.

## Mike's reduced queue (fixed now)

Mike is asked only about:
1. every `forum-new` case where the qualified methods (labelers and `forum-resolved` where it applies) disagree
   on the answer page;
2. **all 32 safety calls**, because nothing automated replaces a technician there;
3. a **seeded random audit sample of 10** cases the methods agree on (seed 4791). This is what measures how often
   the automation is wrong.

The audit sample is not optional. Without it, "you don't need to look at these" is unproven.

## SimLab (paid; budget in `v02/BUDGET.md`)

- 11 scenarios, run in-process against the mira-bots Supervisor with the **dev** Doppler config, at one revision.
  #4791 did not change this engine.
- 3 repeats.
- Report the per-scenario checkpoint pass rate. The scenarios are hand-written; their "known" root causes are
  labelled `scenario_authored`.
