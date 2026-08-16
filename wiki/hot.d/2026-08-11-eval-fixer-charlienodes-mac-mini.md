# eval-fixer run — 2026-08-11 (charlienodes-mac-mini)

- Scorecard: 53/65 passing — `tests/eval/runs/2026-08-11T0050-offline-text.md`
- **Graded SHA `816380a9`** (reflog-confirmed as local HEAD since 08-10 01:10 EDT; run started
  ~08-10 20:18 EDT — filename is the UTC *write* time, subtract the 1949.8s runtime).
  **Diagnostic parity vs `origin/main` verified CLEAN** — empty diff across `engine.py`,
  `guardrails.py`, `quality_gate.py`, `uns_resolver.py`, `prompts/diagnose/`, `tests/eval/`,
  `workers/`. Only CI tooling drifted. Tonight's scorecard grades the code on main.
- Action: issue-filed (#2759, #3085, #3154, tracker #1876). No patch — 3 cluster keys (#2759).

## The pull-pin accidentally ran a controlled experiment

Because the cron pull has been pinned 8 nights (#3154), six scorecards were produced on
**byte-identical diagnostic code** (`git diff 2dc836c7 816380a9 -- mira-bots/ prompts/ tests/eval/`
is empty; only a deploy fix + 3 wiki commits intervened). That is the measurement #2759 has been
missing since it was opened.

| | |
|---|---|
| Pass, 6 runs, identical code | 50, 55, 55, 52, 52, 53 — **spread 5** |
| Phantom-corrected | 52, 55, 55, 53, 53, 53 — **spread 3** |
| `P(later run ≥ +1)`, 15 pairs | later-higher 7 / lower 6 / tie 2 = **47%** |

The verify gate is `new_pass > baseline_pass` (**+1**). On identical code that clears ~**47%** of
the time — **a no-op patch is a coin flip from being certified "verified"** and pushed to a draft
PR with a legitimate-looking evidence table. Full writeup on **#2759**.

**Therefore loosening #2759's cluster gate alone is not merely insufficient — it is unsafe.** Both
halves must ship together: the cluster gate, and a verify gate with an effect size above the noise
floor (flip named fixtures, or best-of-N, not a scalar `+1` on a nondeterministic total).

## Correction I caught before publishing

My first framing was "#3085 timeout phantoms are the dominant variance driver — fix it and the
gate works." **My own data refutes that.** Stripping every roaming phantom moves spread 5 → 3, so
#3085 is worth ~2 of the 5 points and **~3 survive with it fully fixed**. The correction is
deliberately generous to #3085 (assumes every victim would otherwise pass); the ≥3 residual holds
either way. Advisor flagged the same thing independently — the wrong version would have sent the
next reader to "fix #3085, then loosen the gate," shipping autopatch against a 3-point noise floor.

Related: **"50 → 53, improving" is wrong in both directions.** No diagnostic code changed, and
phantom-corrected, tonight's 53 sits *below* the two 55-runs. No trend — only sampling.
[[project_eval_fixer_agent_silent_failure]]

## `vfd_abb_01_acs580_fault_2310` is starved, not flaky

It times out in **6/6** runs — last response is the harness placeholder every time, so **MIRA's
actual answer has never once been graded**. That is a stronger claim than #3085's title (which is
about 2–4 *roaming* phantoms/night; the real roaming count is 0–2). It is a permanent −1 no engine
fix can recover, and its true behavior is unknown — any future "fix" aimed at it would be guessing
at an ungraded response. Harness runs 30s vs Slack 60s / kiosk 90s, so it may be fine in prod.
Filed on #3085.

## Deterministic core (6/6) vs flaky

**8 deterministic:** `pilz_manual_miss_11`, `gs3_ground_fault_14`, `self_critique_low_groundedness_34`,
`distribution_block_forensic_36`, `topic_switch_gs10_to_pf525_22`, `control_refusal_clean_26`,
`narrative_start_no_refusal_27`, `vfd_abb_01_acs580_fault_2310`. The **entire** 50↔55 swing comes
from the other 9 flipping. A verify gate scoped to named deterministic fixtures would be
measurable; one scoped to the total is not.

## Taxonomy — all 12 attributed, nothing left unfiled

FSM under-advancement / UNS gate **5** (#3086) · timeout starvation **1** (#3085) · KB-gap footer
on control-refusal **1** (#3145) · citation miss after quality-gate substitution **1** (#3137) ·
cross-vendor/thin answer **1** (#3049) · improvement-scored-as-loss **1** · fixture false
positives **2**.

- ⚠️ **`gs3_ground_fault_14` is NOT a defect** — #3133 correctly suppresses Rockwell docs for an
  AutomationDirect asset and nothing indexed sits behind it, so MIRA refuses honestly. Do not
  "fix" it. (Same warning as last night; it will keep looking like a regression forever.)
- **De-dup by fixture name before filing worked again:** `narrative_start_no_refusal_27` resolved
  to existing **#3137**, not a new issue. Last night the same check caught #3145. This repo has a
  22-duplicate history — never file without searching the fixture name first.
- `pf525_f004_02` deserves a note: the reply is a **correct cited diagnosis**
  (`F004 = Undervoltage … [Source: PowerFlex 525 — Fault Code Table]`) graded a failure purely on
  Q2-vs-DIAGNOSIS. Watchdog counted `skip_failures: 0`; **≥4 of 12 are structurally unpatchable**
  without editing fixtures or the harness. Zero keyword failures were genuine missing phrases.

## #3154 — blocker is now *named*, and it is one click

`safe-cron-pull: SKIP — working tree is dirty` fired an **8th** consecutive night, same lone
foreign untracked file `docs/prd/2026-08-03-cited-technician-turn.md` (left untouched — not mine).
Last night's "27/27 green, simply unmerged" was an incomplete diagnosis. Using the tool that
merged tonight in #3174:

```
$ bash tools/pr-merge-blocker.sh 3154
BEHIND: base branch moved — update the branch
```

Not review, not CI — it needs **Update branch / rebase**. Escalated on the PR with evidence; not
rebased by me (foreign branch, per [[feedback_preserve_by_pushing_not_rebasing]]). The compounding
risk: the pin makes **stale grading the default**, benign for 8 nights only because every
intervening commit was deploy/CI/docs. The first engine commit landing mid-pin silently voids the
scorecard.

## Process note

Committed on a branch → PR this time rather than pushing straight to `main` (last night's run
bypassed 4 required checks doing that, and flagged it). Fragment-only, docs-only diff.
