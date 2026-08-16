# eval-fixer run — 2026-08-07

- Scorecard: 47/65 passing (72%) — `tests/eval/runs/2026-08-07T0124-offline-text.md`
- Action: issue-filed (no patch — Step 2 hard stop: 3 file clusters)
- **The scorecard graded an ~11h-stale checkout. At least 3 of its 18 "failures" pass on current `main`.**

## Why no patch

Two independent blocks, either sufficient:

1. Failures span **3 file clusters** (`engine.py`, `guardrails.py`, `prompts/diagnose/active.yaml`)
   → Step 2 hard stop. Same structural reason as #2759 (keyword failures always emit both
   `guardrails.py` and `active.yaml`, so the single-cluster gate is unsatisfiable by construction).
2. The graded tree is **superseded**. Patching against it would target a baseline that no longer exists.

## The finding: #2952 is live, and the mechanism is fixable

The 08-07 scorecard (written 08-06 21:24 EDT, runtime 2388s → started ~20:44 EDT) graded
`52bfdccb` from **08-05 18:55 EDT**, missing four fixes that landed 08-06 morning:
#3131 CTX-001, #3135 CON-001, #3133 cross-vendor filter, #3136 RTE-001/002.

Two independent gaps cause it:

- **The eval producer never pulls.** `com.factorylm.mira-offline-eval.plist` fires every 4h and runs
  `offline_run.py` with no `fetch`/`pull`/`checkout` — it grades whatever the shared checkout sits on.
- **The fixer's pull guard counts untracked files as "active work."** `safe-cron-pull.sh:47` uses bare
  `git status --porcelain`, which includes untracked. One foreign untracked file
  (`docs/prd/2026-08-03-cited-technician-turn.md`, created 08-03 07:14, still present) has SKIPped the
  pull on **08-04, 08-05, 08-06, 08-07** — four consecutive nights. Nothing ages it out.

Suggested (not applied — outside the 4-file patch whitelist): `--untracked-files=no` on the guard
(a `merge --ff-only` cannot clobber an untracked file — git refuses outright), and grade a detached
worktree pinned to `origin/main` rather than the shared tree. Full receipt on #2952.

## Bounded re-verification on fresh `origin/main`

Targeted re-run of the 6 fixtures whose failure signature matched an 08-06 fix. Read as
presence/absence of a forbidden token, not marginal pass/fail — those survive the #3116 noise floor
(σ=2.46), a full re-run would not.

| Fixture | Stale grade | Fresh `origin/main` |
|---|---|---|
| `greeting_mid_session_no_citations_23` | FAIL — forbidden `KB-gap` | **PASS 7/7** ✅ #3135 |
| `gs1_undervoltage_12` | FAIL 5/7 — forbidden `PowerFlex` + wrong-vendor | **PASS 7/7** ✅ #3133 |
| `vfd_abb_03_acs355_cross_load` | FAIL 6/7 — forbidden `PowerFlex`/`Rockwell` | **PASS 7/7** ✅ #3133 |
| `gs3_ground_fault_14` | FAIL 5/7 — forbidden `PowerFlex`/`Rockwell` | FAIL 6/7 — **signature changed** |
| `symptom_switch_after_fault_lookup_25` | FAIL — forbidden `CE10`/`Modbus` | FAIL — **signature changed** |
| `control_refusal_clean_26` | FAIL — forbidden `KB-gap` | FAIL — **unchanged** |

Two of those are not the same defect any more:

- **`gs3_14`** no longer leaks Rockwell (#3133 works). It now *refuses*: "I couldn't find anything
  matching your description." The cross-vendor filter correctly suppresses Rockwell docs for an
  AutomationDirect asset, and there is no AutomationDirect GS3 content behind it. **A wrong-vendor
  hallucination became an honest refusal — a product improvement that still scores as a fixture
  failure.** Worth a deliberate call on whether the fixture or the corpus is wrong.
- **`symptom_switch_25`** no longer leaks `CE10`/`Modbus` (#3131 works), but now retrieves an
  unrelated doc entirely ("User Manual MultiControl EN, p. 1") and misses every expected keyword.
  Retrieval-precision class, adjacent to #3049.
- **`control_refusal_26`** is a genuine still-open defect on current `main`: the `KB-gap` footer still
  attaches to the control-refusal lane. #3135 covered greeting/help (fixtures 61/62); the refusal
  lane (64) was outside its scope. This is the one clean, unclaimed CON-001 follow-up.

## Rest of the 18, all previously tracked

| Signature | Issue | Count |
|---|---|---|
| Wrong-vendor citation (`cp_citation_vendor_relevance`) | #3049 | 5 (= exactly the `skip_failures`) |
| Harness timeout — `engine.py:372` defaults 30s vs Slack 60s (`mira-bots/docker-compose.yml:85`) | #3085 | 2 |
| FSM under-advancement (`cp_reached_state`) | #3086 | 3 |
| Quality-gate substitution wipes keywords (`quality_gate.py:69` `GRACEFUL_FALLBACK`) | #3137 | 2 |

#3137 names only fixture 65; `pf520_hw_overcurrent_17` is a second member of the same class.

## Not a regression

57 → 65 fixtures (#3129 added 60–67). Passed 43 → 47. The percentage dip 75% → 72% is the denominator
growing by 8, not behaviour degrading — and **6 of the 8 new fixtures are the very defect arc
#3131/#3135/#3136 fixed on 08-06**, which the graded tree predates entirely.

## Standing asks, still ownerless

- **#3085** — 8 nights, one env var.
- **#3049** — gated on the fail-open grader (`grader.py:376-407`); note `gs3_14` above is the live
  counter-example, where suppressing the wrong vendor produced a refusal the grader scores as a loss.
- **#2952** — now has a dated receipt and a two-line fix.
