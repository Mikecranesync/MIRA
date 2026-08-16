# eval-fixer run — 2026-08-16 (charlienodes-mac-mini)

- Scorecard: **38/65 (58%) raw** — joint-lowest of the 18-run series (ties `2026-08-15T1643`).
  **38/49 (77.6%) gradeable**, excluding 16 fixtures that never produced an answer.
- Evaluated tree: `5d6fc452e` (shared checkout on `ops/orphan-health-detection`, **not `main`** —
  see "Failure 4 still latent" below). Card: `2026-08-16T0216-offline-text.md`, runtime 2820.7s.
- Action: **issue-filed, no patch** — hard stop. Reported to rolling tracker #1876.

## Report BOTH denominators — 16 of 27 failures are timeouts, not wrong answers

16 of tonight's 27 failures ended on the `TIMEOUT_WARNING` placeholder ("This is taking longer
than usual…"). Those fixtures emitted **no diagnostic content at all**, so they are ungradeable —
they say nothing about answer quality. Raw 58% vs gradeable 77.6% is a ~20pt gap that is pure
latency artifact.

Pre-registered ungradeable set (16): `gs10_overcurrent_01`, `full_diagnosis_happy_path_07`,
`asset_change_mid_session_08`, `pf525_ground_fault_19`, `yaskawa_v1000_oc_22`,
`yaskawa_j1000_thermal_24`, `yaskawa_ga500_gf_25`, `sew_overcurrent_29`,
`danfoss_motor_overload_31`, `self_critique_low_instruction_35`, `narrative_start_no_refusal_27`,
`vfd_ab_01_pf525_f004_undervoltage`, `vfd_ab_03_pf525_wrong_model`, `vfd_abb_01_acs580_fault_2310`,
`vfd_abb_03_acs355_cross_load`, `vfd_siemens_03_sinamics_cross_vendor`.

Genuine gradeable failures (11): `pf525_f004_02`, `pf520_hw_overcurrent_17`, `pf527_phase_loss_20`,
`pf40_undervoltage_21`, `yaskawa_a1000_ov_23`, `danfoss_vlt_undervoltage_27`,
`self_critique_low_groundedness_34`, `topic_switch_gs10_to_pf525_22`, `control_refusal_clean_26`,
`vfd_danfoss_01_vlt_fc102_alarm4`, `vfd_siemens_04_v20_startup`.

## ✅ DEAD END CLOSED — the 57→65 denominator change is NOT the story

Prior memory flagged that every published number (83.9→80.2, the "44–51/57 band", 35/36 of 57) sits
on the **old /57 denominator**. Settled tonight by diffing the last /57 card
(`2026-08-06T0206`) against tonight's /65:

- The suite grew by **exactly 8, none removed**, at `2026-08-06T0646` — the **phone-battery**
  fixtures from #3129 (`8155aedbc`): `topic_switch_gs10_to_pf525_22`,
  `greeting_mid_session_no_citations_23`, `help_mid_session_no_kbgap_24`,
  `symptom_switch_after_fault_lookup_25`, `control_refusal_clean_26`,
  `narrative_start_no_refusal_27`, `unknown_identity_symptom_first_28`,
  `educational_not_safety_stopped_29`.
- **They are not the failure driver: 5/8 pass tonight (62.5%), above the 58% overall rate.**
- ⚠️ The `vfd_*` fixtures were **already in the /57 set** — do not attribute them to the growth.

⇒ The suite is not harder; the denominator shifted on 08-06 and every pre-08-06 figure must be
restated before it is compared to a /65 card. **Do not re-derive this.**

## Structural finding — the autopatch gate is unsatisfiable, 5th+ consecutive night (#2759)

Name the mechanism, not tonight's count. Excluding the 16 latency artifacts, patchable drops
**27 → 11 — under the >15 limit** — and the run *still* hard-stops, because `cp_keyword_match`
maps to **two** files by construction (`guardrails.py` + `active.yaml`), so a single keyword miss
emits 2 cluster keys by itself. Recount excluding timeouts:

| cluster | fixtures |
|---|---|
| `mira-bots/shared/engine.py` | 9 |
| `mira-bots/shared/guardrails.py` | 5 |
| `prompts/diagnose/active.yaml` | 5 |

Only a **pure-`cp_reached_state`** run could ever fire the gate. The genuine signal is one dominant
cluster of **9 engine.py FSM-pacing failures**. Watchdog precision bug also recurs:
`skip_failures: 0` while several failures are structurally unpatchable.

## Experiment launched — pre-registered readout (do NOT read it as a pass rate)

The `MIRA_PROCESS_TIMEOUT=90` discriminator, proposed 08-14, has still never actually been run.
Launched tonight. **The n=1 aggregate is uninterpretable** — the series is 38–54/65 across 18 runs
with no code changes, a 16pt noise band, and memory's own rule is that the real signal is a
multi-run mean. So the readout is deliberately **not** the pass rate:

> Of the **16 named fixtures** above that timed out at the 30s default, how many complete at 90s?
> Mostly pass ⇒ pure latency artifact, #3190 cost no answer quality.
> Complete but still miss keywords ⇒ genuine degradation underneath the timeouts.

Env var set **on the command line only**. Did NOT commit a `MIRA_PROCESS_TIMEOUT` change — that
alters production bot behaviour to paper over an eval-harness budget. Wrong lever.

⚠️ **Rename the experiment card out of the glob.** A full 65-fixture card produced under a
non-default config looks completely legitimate to `tests/eval/runs/*offline-text.md`, so tomorrow's
watchdog would parse it and the PRE/POST table published to #3085/#1876 would silently ingest a
90s-budget row. Worse than the `--only` poisoning trap of 08-14, because nothing about its shape
looks wrong.

## 🔴 Failure 3, THIRD variant: five nights stranded in open PRs — fixed by consolidation

`origin/main:wiki/hot.d/` ended at **08-12**. Every eval-fixer fragment PR was open and **`BEHIND`**:
**#3144** (08-07), **#3186** (08-11), **#3216** (08-13), **#3231** (08-14), **#3246** (08-15).
The leak has now moved twice — committed-but-unpushed (fixed 08-06) → pushed-but-unmerged
(found 08-14) → **branch-per-night backlog that grows one PR every night**.

- ✅ **The two-read rule applies to your own PRs.** A bulk `gh pr list` returned `UNKNOWN` for #3144
  and #3186; a direct `gh pr view` on each returned **`BEHIND`**. `UNKNOWN` means *uncomputed*, not
  clean — never resolve it to CLEAN. 4th night this rule has paid.
- **Fixed structurally, not per-PR:** all six nights (08-07, 08-11, 08-13, 08-14, 08-15, 08-16) are
  consolidated onto ONE branch cut off `origin/main`, and the five superseded PRs are closed with a
  pointer. Rebasing five branches would have cleared `BEHIND` while leaving the mechanism that
  regenerates it.
- Branch cut off **`origin/main`, not `HEAD`** — the shared tree sits on
  `ops/orphan-health-detection`, so branching from HEAD would have dragged `5d6fc452e` into a
  docs-only PR. Work done in an isolated worktree; the foreign untracked
  `docs/prd/2026-08-03-cited-technician-turn.md` was never touched.

## ⚠️ Host state confounds the timeout attribution

`tools/orphan-health.sh` (shipped `5d6fc452e`) reports **2 findings** on the measuring host:
two Claude sessions from **07-28, 18 days old** (pid 3108, 11102), holding pre-08-09 hook config,
and **1915 MB free**. Memory records one orphan thrashing CHARLIE via paging. So tonight's 16
timeouts are being attributed to #3190's three added reasoning round-trips **while measuring on a
possibly-paging host** — the confound is unquantified. Free memory captured at experiment start/end
so the number stays interpretable. **Not killed — stale sessions on a shared host are a human call.**

## Failure 4 still latent, and it bit tonight

The shared tree was on `ops/orphan-health-detection`, so `safe-cron-pull.sh` no-op'd (it pulls only
when clean **and** on `main`) and the card grades `5d6fc452e`, not `main`. It is only ~1 commit off
main this time, so tonight's numbers stand — but this is the exact configuration-not-construction
failure #2952 describes, and it recurs whenever a session leaves a branch checked out. The
`main`-pinned dedicated worktree in #2952 is still the real fix and is still open.
