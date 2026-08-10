# eval-fixer run — 2026-08-10 (charlienodes-mac-mini)

- Scorecard: 50/65 passing (77%) — `tests/eval/runs/2026-08-10T0207-offline-text.md`
- **Graded SHA `2dc836c7`** (run started ~2026-08-09 21:34 EDT; filename is UTC *write* time,
  so subtract the 1951.7s runtime). **Parity verified CLEAN** against `origin/main` on
  `engine.py` / `guardrails.py` / `quality_gate.py` / `prompts/diagnose/` / `tests/eval/` —
  only deploy files drifted. Tonight's scorecard grades current diagnostic code.
- Action: issue-filed (comment on rolling tracker #1876). No patch — 3 cluster keys (#2759).

## The one item needing a human: PR #3154

`safe-cron-pull: SKIP — working tree is dirty` fired **again** tonight (05:00:06Z) — the same
lone foreign untracked file `docs/prd/2026-08-03-cited-technician-turn.md`. That is ~7
consecutive nights (08-04 → 08-10). **The fix is PR #3154, open since 08-08, not a draft,
27/27 checks SUCCESS — simply unmerged.** Merging it retires the recurring stale-grading root
cause. Tonight survived on luck: parity was clean only because the sole intervening commits
were deploy-side. Left for a human — did not merge another agent's PR unprompted.

## Variance: confirming, not discovering

Last 6 runs: 50, 55, 55, 53, 50, 54 / 65. With parity now *verified* rather than inferred,
that is **8 consecutive runs of identical diagnostic code** spanning 50–55. #3116 already had
σ=2.46 at n=20. **Tonight's 50 is not a regression** — no diagnostic code changed, so there is
no candidate cause; it is the bottom of the band. The verify gate (`new_pass > baseline_pass`,
+1) still sits inside a ±4 band, so loosening #2759's cluster gate alone would buy ~1
noise-justified patch/night. Both halves must ship together.

## Taxonomy (all but one tracked)

FSM under-advancement / UNS gate **6** (#3086) · timeout phantoms **3** (#3085, ~11 nights
ownerless) · cross-vendor bleed **2** (#3049) · KB-gap footer on a non-diagnostic lane **1**
(**#3145**) · improvement-scored-as-loss **1** · fixture false positive **1**.

- **`control_refusal_clean_26` is the only genuine still-open engine defect — already filed as
  #3145** (opened 08-07, outside #3135's scope, zero comments until tonight). Confirmed verbatim
  tonight on parity-verified code: a session-reset reply with the KB-gap footer bolted on, no
  diagnostic content. Recurrence evidence added to #3145.
  ⚠️ **I nearly opened a duplicate.** Both my first tracker comment and my memory note called this
  "unattributed / needs an issue" — a `gh issue list --search` before filing caught #3145. **Always
  de-dup by fixture name before filing**; this repo has a 22-duplicate history.
- **`pilz_manual_miss_11` + `distribution_block_forensic_36`** = one cause, one fix: byte-identical
  response, both expected exactly IDLE, both got Q1 (unknown-model path enters the FSM). Under #3086.
- ⚠️ **Corrected mid-run: `gs3_ground_fault_14` is NOT a defect.** It is the known
  improvement-scored-as-a-loss — #3133 correctly suppresses Rockwell docs for an AutomationDirect
  asset, nothing indexed sits behind it, so MIRA refuses honestly. Do not "fix" it. My first
  tracker comment mis-framed this; edited within minutes, before any action.

## Watchdog precision bug (again)

Reported `skip_failures: 0`, but ≥2 are structurally unpatchable without editing fixtures:
`help_mid_session_no_kbgap_24` forbids `nameplate` where it appears in *legitimate* GS10
parameter advice, and `topic_switch_gs10_to_pf525_22` gave a correct PF525 procedure but sat in
IDLE vs expected Q1. **Zero** of tonight's keyword failures were genuine missing phrases
(3 timeout / 2 cross-vendor / 1 legitimate prose) — the standing #2759 argument.

## Deviation to note

Committed this fragment **directly to `main`** per the agent spec's Step 10; the push reported
`Bypassed rule violations` (4 required checks skipped). Prior practice in this repo is
branch → PR for wiki fragments. Docs-only, and `main` is not left diverged (local == origin),
but flagging the bypass rather than burying it.
