# eval-fixer run — 2026-08-13 (charlienodes-mac-mini)

- Scorecard: 47/65 raw (72%) — **47/61 gradeable (77%)** after excluding 4 ungradeable timeouts
- Action: issue-filed (no patch — two hard stops: 18 patchable > 15; 3 file clusters)
- Filed: escalation on **#3085** + run report on tracker **#1876**

## The finding: the raw pass-rate "regression" is mostly a measurement artifact

Raw pass dropped from a 50-56 band to 45-51 starting 08-12T0848. Measured across 20 consecutive
runs, that drop is dominated by **ungradeable timeouts**, not by the engine getting worse.

A timed-out fixture never produced an answer to grade, so it belongs out of the denominator. Split
by **UTC start time** (filename is UTC at *write* time — subtract `Total runtime`), against the
#3190 pickup at 08-12 01:05 EDT = **05:05 UTC**:

| window | runs | raw | timeouts/run | **gradeable** |
|---|---|---|---|---|
| PRE  08-09T0324 → 08-12T0409 | 15 | 50-56 (76-86%) | **0-3** (mean 1.2) | 79-86%, mean **83.2%** |
| POST 08-12T0848 → 08-13T0314 | 5 | 45-51 (69-78%) | **4-10** (mean 6.4) | 77-85%, mean **80.6%** |

**Every** pre run has ≤3 timeouts; **every** post run has ≥4. Non-overlapping, stepping exactly at
the migration boundary. But the *gradeable* bands overlap heavily — `08-12T1327` reads as the
second-worst night (70% raw) and is **83% gradeable, inside the pre band.**

⇒ Answer *quality* is roughly flat; the raw drop is dominated by fixtures that never answered. So
#3085 (eval inherits the 30s `MIRA_PROCESS_TIMEOUT` vs Slack 60 / kiosk 90) is no longer a "2-4
phantom failures a night" nuisance — it is the **largest single distortion in the nightly
scorecard**, and it is what trips the multi-cluster hard stop each night by inflating all three
clusters at once.

## ⚠️ I hit the UTC trap this file already documents — and had to correct two filings

My first pass called `08-12T0409` (56/65, 0 timeouts) a **post**-migration counter-example and
concluded "mechanism not isolated." Wrong: `0409` minus its 1957s runtime starts **08-12 03:36
UTC**, *before* the 05:05 UTC pickup. It is PRE-migration and matches its group perfectly. The
counter-example dissolved and attribution to #3190 became well-supported.

The 08-03 update in [[project_eval_fixer_agent_silent_failure]] warns about exactly this
("the scorecard filename is UTC computed at WRITE time"). **I read it, then split a series on a
commit boundary using EDT anyway.** Corrections posted to #3085 and #1876 rather than left
standing. **Never split a run series on a commit boundary without converting both sides to UTC.**

## Still NOT confirmed at the log level

#3190's own commit message supplies the mechanism: gpt-oss burns completion tokens on reasoning, and
`router.py:558` fires a reasoning-burn retry with `max_tokens=8192` — a second round trip against a
30s budget. But `grep -rl REASONING_BURN tests/eval/ /tmp` returns **nothing**, and no
429/rate-limit/retry-after signal appears in any scorecard: the harness doesn't capture router logs.
→ **Next step: re-run one suite with router logging captured.** Present ⇒ retry mechanism confirmed;
absent ⇒ some other latency path.

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
- Convert scorecard timestamps to **UTC** before splitting a series on a commit boundary — see the
  correction above. `python3` on filename minus `Total runtime`, never eyeballed local time.
