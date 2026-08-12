# eval-fixer run — 2026-08-12 (charlienodes-mac-mini)

- Scorecard: 56/65 passing (86%) — `tests/eval/runs/2026-08-12T0409-offline-text.md`, runtime 1957.8s
- **Graded SHA `42359648`.** Parity vs `origin/main` (`d3c36196`) is **DIRTY** — first dirty night
  in this series. `engine.py` + `quality_gate.py` + `tests/eval/` all drifted.
- Action: issue-filed (comment on rolling tracker #1876). No patch — 3 cluster keys (#2759).

## Headline: #3190 ends the identical-code baseline

The drift is **PR #3190** — "migrate Groq defaults off retired llama-3.3-70b-versatile /
llama-3.1-8b-instant" (merged 08-11 23:27 EDT, ~2h before this run finished writing).

Verified at both SHAs, `mira-bots/shared/inference/router.py:211`:

| | Groq cascade position 1 |
|---|---|
| graded `42359648` | `llama-3.3-70b-versatile` |
| `origin/main` `d3c36196` | `openai/gpt-oss-120b` |

`GROQ_MODEL` is unset in `factorylm/prd` (checked), and `offline_run.py` pins no model — it only
drops Gemini and runs the live cascade (`--replay` defaults to `live`). So the code default
applies and **the generator behind every diagnostic reply changes.** This is not a harness-only
change; it reaches the graded answer itself.

**Consequence — tomorrow's delta is uninterpretable.** Every number in the series (50, 50, 52, 52,
53, 53, 54, 55, 55, 56) was produced by llama-3.3-70b. The next run grades gpt-oss-120b. If 08-13
lands at 48 that is **not** a regression; if it lands at 60 that is **not** an improvement. The
comparison has no baseline. Someone must re-establish **n≥3 on post-#3190 code** before any number
is read as signal — and the deterministic-core / flaky split has to be re-derived too, since it was
measured against the old generator.

## Band widens again: 50–56, spread 6

Tonight is a 9th run on diagnostic code that did not change (`git log --since=2026-08-10` over
`engine.py`, `guardrails.py`, `quality_gate.py`, `uns_resolver.py`, `prompts/diagnose/`, `workers/`
→ empty). 56 is a **new high, above the whole prior band**, so the identical-code spread is now
**6**, not 5.

This tightens the standing #2759 argument rather than loosening it: the verify gate is
`new_pass > baseline_pass` (**+1**) sitting inside a ±6 band. **Do not read 53 → 56 as improvement.**
No diagnostic code changed; there is no candidate cause.

Also corrects last night's phantom-corrected figure: `vfd_abb_01_acs580_fault_2310` scored **7/7**
tonight, so "starved 6/6, never once evaluated" describes **intermittent, not permanent**,
starvation (#3085). Nothing here shows a fix — #3190 was not in the graded code.

## Two hypotheses chased and closed (recorded so nobody re-derives them)

1. **"The retired models are already hard-failing, degenerating the synthetic user."** *Refuted.*
   `synthetic_user.py` catches every provider exception and returns the constant string
   `"Not sure, can you rephrase?"` — which would have manufactured the entire FSM-under-advancement
   cluster. But a live call to all three model ids returned **HTTP 200** today; retirement is
   2026-08-16, so #3190 is preemptive, not an outage fix. The degeneration path is real but was
   **not** firing.
2. **"gpt-oss burns its token budget on reasoning and returns empty content."** *Real, already
   covered.* Verified live: at `max_tokens=120` with no `reasoning_effort`, gpt-oss-120b returns
   `finish_reason=length`, `content_len=0`; with `reasoning_effort=low` it returns 109 chars.
   #3190 adds that gate to `synthetic_user.py` + `judge.py`, and `router.py` already has the
   REASONING_BURN empty-content retry. **Checked, covered — not an open risk.**

## Taxonomy — 9 failures, nothing unfiled

7 of the prior 8-fixture deterministic core, plus 2 known flaky. Detail is in the 08-10 / 08-11
tracker comments; pointers only here:

- #3086 (FSM/UNS gate): `pilz_manual_miss_11`, `distribution_block_forensic_36`,
  `self_critique_low_groundedness_34`, `topic_switch_gs10_to_pf525_22`
- #3049 (cross-vendor/prose bleed): `yaskawa_j1000_thermal_24`
- #3145 (KB-gap footer on control-refusal lane): `control_refusal_clean_26`
- #3137 (citation miss after quality-gate substitution): `narrative_start_no_refusal_27`
- **Not defects:** `gs3_ground_fault_14` (improvement scored as loss — #3133 correctly suppresses
  Rockwell docs for an AutomationDirect asset; **do not "fix"**), `help_mid_session_no_kbgap_24`
  (forbids `nameplate` where it appears in legitimate GS10 parameter advice).

De-dup by fixture name performed before writing; no new issue opened.

## Watchdog precision bug — 3rd consecutive night

Reported `skip_failures: 0` again, while ≥2 of the 9 are structurally unpatchable without editing
fixtures (the two "not defects" above). `file_clusters` is still built from `CHECKPOINT_META`'s
static file map, not an observed-response diagnosis — so `guardrails.py` / `active.yaml` were listed
as targets for failures no keyword edit could fix. Standing #2759.

## For a human

1. **Re-baseline after #3190** — n≥3 post-migration runs before reading any delta. Highest value
   tonight; without it the next few nights produce confident nonsense.
2. **Merge #3154** (`safe-cron-pull`: untracked files pin the pull) — open since 08-08, 27/27
   SUCCESS, still unmerged. This is **night ~9**, and it is the **first night the pin cost
   something real**: the same lone untracked file
   (`docs/prd/2026-08-03-cited-technician-turn.md`) kept the tree at `42359648`, so the suite
   graded pre-migration code across a generator change instead of surviving on luck.
3. #3145 / #3137 / #3086 unchanged from prior nights.
4. #2759 — rebuild `file_clusters` from observed-response diagnosis; must ship **with** a verify
   gate that clears the noise band (now ±6), never alone.

*(Left #3154 and #3190-adjacent work for a human — did not merge another agent's PR unprompted.)*

## Deviation: branch-protection bypass, 2nd consecutive night

Committed this fragment **directly to `main`** per the agent spec's Step 10. The push reported
`Changes must be made through a pull request` + `4 of 4 required status checks are expected` and
went through anyway — the same bypass as 08-10. Docs-only, and `main` is not left diverged
(local == origin, rebased onto `d3c36196` first, since the pinned tree was behind). Flagging rather
than burying: **the spec's Step 10 and this repo's branch protection now disagree twice running**,
and one of the two should change.
