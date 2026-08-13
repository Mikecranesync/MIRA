# eval-fixer run — 2026-08-13 (charlienodes-mac-mini)

- Scorecard: 47/65 raw (72%) — **47/61 gradeable (77%)** after excluding 4 ungradeable timeouts
- Action: issue-filed (no patch — two hard stops: 18 patchable > 15; 3 file clusters)
- Filed: escalation on **#3085** + run report on tracker **#1876**

## The finding: the raw pass-rate "regression" is mostly a measurement artifact

Raw pass dropped from a 50-56 band to 45-51 starting 08-12T0848. Measured across 20 consecutive
runs, that drop is dominated by **ungradeable timeouts**, not by the engine getting worse.

A timed-out fixture never produced an answer to grade, so it belongs out of the denominator:

| window | runs | raw | timeouts/run | **gradeable** |
|---|---|---|---|---|
| 08-09 → 08-12T0409 | 14 | 50-56 (76-86%) | 0-3 | 80-86%, mean **83.2%** |
| 08-12T0848 → 08-13 | 5 | 45-51 (69-78%) | 4-10 | 77-85%, mean **80.2%** |

The bands overlap heavily. `08-12T1327` reads as the second-worst night (70% raw) and is **83%
gradeable — inside the pre band.** So #3085 (eval inherits the 30s `MIRA_PROCESS_TIMEOUT` default vs
Slack 60 / kiosk 90) is no longer a "2-4 phantom failures a night" nuisance; it is currently the
**largest single distortion in the nightly scorecard**, and it is what trips the multi-cluster hard
stop each night by inflating all three clusters at once.

## Mechanism NOT isolated — do not repeat my first framing

The surge is coincident with **#3190** (Groq default → `openai/gpt-oss-120b`, merged 08-11 23:27,
picked up in this checkout 08-12 01:05 per reflog). #3190's own commit message supplies a plausible
mechanism: gpt-oss burns completion tokens on reasoning, and `router.py:558` fires a reasoning-burn
retry with `max_tokens=8192` — a second round trip against a 30s budget.

**I drafted that as settled cause and it is not.** `08-12T0409` is post-migration, ran the new code,
and scored the best of all 20 runs (56/65) with **zero** timeouts. A simple "new model is slower"
story does not predict that run.

The discriminating evidence is **not retained**: `grep -rl REASONING_BURN tests/eval/ /tmp` returns
nothing, and no 429/rate-limit/retry-after signal appears in any scorecard. Router logs aren't
captured by the harness. → **Next step: re-run one suite with router logging captured.**
`REASONING_BURN` present ⇒ retry mechanism confirmed; absent ⇒ provider latency variance, #3190
coincidental.

## ⚠️ Trap planted for future runs

`_PROCESS_TIMEOUT = float(os.getenv("MIRA_PROCESS_TIMEOUT", "30"))` — `mira-bots/shared/engine.py:384`
— is **inside the autopatch whitelist** and is a one-line change. It is the **wrong** fix. Editing it
changes production behavior for every adapter that doesn't override (Slack 60, kiosk 90, eval sets
nothing). #3085's fix is **harness-side**. Noted on the issue so the next night doesn't ship a prod
behavior change through the eval gate.

## Timeout population — rotating, not one slow fixture

32 timeouts / 5 post-migration runs across ~19 distinct fixtures. Most frequent: `sew_overcurrent_29`
(4/5), `vfd_abb_03_acs355_cross_load` (3/5), `gs20_phase_loss_16` (3/5), `pf525_ground_fault_19` (3/5).
The rest rotate — a latency lottery against a tight budget, not a few structurally-slow fixtures.

Tonight's 4 ungradeable: `gs1_undervoltage_12`, `gs20_phase_loss_16`, `pf525_ground_fault_19`,
`pf527_phase_loss_20`. Only `gs1_undervoltage_12` failed *both* checkpoints; the other three show
FSM ✓ and failed keyword only — so "a timeout fails both checks" is **false** as an absolute.

## Residual 14 worth a human look

- `control_refusal_clean_26` — forbidden `KB-gap` marker leaked into a *fresh-session* reply
- `topic_switch_gs10_to_pf525_22` — forbidden `Modbus`; IDLE vs Q1
- `symptom_switch_after_fault_lookup_25` — forbidden `CE10` (stale prior-topic bleed); IDLE vs Q1
- `narrative_start_no_refusal_27` — missing `PowerFlex`, answered with rephrase-request + wrong-vendor citation
- 7 FSM-pacing (over-qualifying before DIAGNOSIS), 3 keyword misses on fixtures that did answer
  (`danfoss_vlt_undervoltage_27` returned a SAFETY escalation — possible over-escalation, cf. #1834)

## Method notes

- `grep -c "taking longer than usual"` on the scorecard cross-validates **exactly** against the
  watchdog's per-fixture `last_response_snippet` count (4 = 4). Counting method is sound.
- Still do not grep `TIMEOUT_WARNING` — that is the constant's name, not the rendered prose.
- Report **both** denominators every night. Raw-only reading is what made this look like a
  code regression for two nights running.
