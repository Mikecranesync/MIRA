# eval-fixer run — 2026-09-02 (charlienodes-mac-mini)

- Scorecard: **21/65 raw (32%)** / **21/35 gradeable (60%)**, 44 failures, **30 timeouts**.
  Card `2026-09-02T0054-offline-text.md`, runtime 3259.1s.
- Action: **issue-filed + harness PR** — no autopatch (3 hard stops, see Cause 1).
- Decomposition: **30 harness-timeout placeholders + 14 genuine** (6 UNS-gate, 8 one-off).
  Night ~7 of this identical shape; still zero patches ever shipped.

## 🔑 Cause 1 — the noise band, not the rulebook, is why no patch ships

Prior nights cited the two rulebook hard stops (44 patchable > 15; 3 file clusters). Those hold,
but they are not the binding constraint. **The binding constraint is that Step 7 cannot verify
anything.**

Identical-code noise band = **38–54/65 (16pt)**, established by the n=6 controlled experiment on
08-11. The largest genuine cluster is 6 fixtures ≈ **9pt**. A 9pt fix inside a 16pt band cannot be
distinguished from a swing, so `new_pass > baseline_pass` would certify luck.

⇒ **#3085 is not an inflated-metrics annoyance. It is the thing preventing the eval-fixer from ever
producing a fix.** That framing is new tonight and is what went on the issue.

## 🔑 Cause 2 — #3085's own ask had gone unbuilt for 16 days → now shipped (PR #3553)

08-17 named the decider precisely: *"the harness records no per-fixture elapsed time … that is the
concrete ask on #3085: emit per-fixture elapsed seconds. Cheaper than another suite run and it
decides rather than describes."* Nobody built it. Three subsequent nights re-described the problem.

**PR #3553** adds `Slowest` + `Total` columns per fixture.

- **Slowest, not total** — `MIRA_PROCESS_TIMEOUT` is a **per-message** budget, so the slowest single
  turn is the decisive statistic. The grader's existing `latency_ms_total` is a *sum* and cannot
  answer the question.
- **Touches no grader code.** `grader.py` is on the never-modify list, so the max is computed in the
  harness loop where `latencies_ms` is already in scope and attached there.
- Verified: 1-fixture run renders `7/7 | 0.3s | 0.3s`. Card renamed out of the `*offline-text.md`
  glob so it poisons neither the watchdog nor the series parser.

## ⚠️ Correction to the record — the 90s result is NOT "settled"

Tempting to write "the science is settled, just raise it." **It is not.** The 08-17 fragment is
explicit: `2026-08-15T0551` scored 54/65 with **TO=1 at the default 30s**, so a low-timeout run is
reachable *without* the env var. `16 → 1` is n=1 and a quiet-host window is not excluded.

- **Established (strong):** TO count dominates raw score across all 20 runs — every TO ≥ 10 run
  (n=12) scores 35–45; both TO=1 runs score 54 and 58.
- **NOT established:** that the *raised budget* caused it.

Discriminator relaunched tonight **with** the instrumentation, so the recovered fixtures' actual
seconds will decide it. Propagation verified before trusting any result (doppler `prd` does not
define the key, so the ambient var survives; `os.getenv` → `90`). Result appended below / on #3085.

> **RESULT: pending at commit time.** Committed early rather than held, so tonight's findings are
> durable if the session ends first.

## 🔑 Cause 3 — last night's fragment was stranded on local main

`562587eeb` ("eval-fixer run 2026-08-30") was committed **directly to local `main` and never
pushed** — `git merge-base --is-ancestor 562587eeb origin/main` fails; it existed on no remote and
would have died with the checkout.

Preserved by **pushing the ref** (`git push origin 562587eeb:refs/heads/docs/eval-fixer-2026-08-30`)
— no checkout, no worktree touched, zero CI, safe while an eval was mid-run.

Also: **08-31 and 09-01 produced no fragment at all** though scorecards exist for both nights. The
fixer ran and left no durable record twice. Reported on the tracker, not investigated.

## The 14 genuine failures

**6× UNS gate stuck at `AWAITING_UNS_CONFIRMATION`** — replies *"Before I diagnose, I need to know
the equipment. Tell me the manufacturer and model"* to a turn that **already supplied both**
(`gs10_overcurrent_01`, `asset_change_mid_session_08`, `abbreviation_heavy_10`,
`self_critique_low_groundedness_34`, `vfd_ab_03_pf525_wrong_model`, `vfd_mitsu_01_fr_d720_fault_oc`).
Stable across 08-26→09-02 at 5,5,5,4,5,6. Single-file (`engine.py`), reproducible.
**This is the first thing to patch once the noise floor drops.**

Remaining 8: `pf523_heatsink_18` (safety-STOP misfire on a heatsink question),
`control_refusal_clean_26` (forbidden `KB-gap` string leaked to user), 3 answered-but-landed-IDLE
(`yaskawa_a1000_ov_23`, `self_critique_low_instruction_35`, `topic_switch_gs10_to_pf525_22`),
3 keyword misses (`gs3_ground_fault_14`, `lenze_thermal_30`, `vfd_siemens_04_v20_startup`).

## Traps honored / recorded

- **`TIMEOUT_WARNING` grep is vacuous** — that is the constant's *name* in `fallback_responses.py:39`;
  the rendered prose is *"This is taking longer than usual…"*. My first grep returned 0 and would
  have hidden all 30. Count via `last_response_snippet`.
- **Never check out branches during an in-process eval** (08-15, re-hit by another session 08-17).
  Honored: the stranded-commit rescue used a ref push specifically to avoid a checkout.
- **`engine.py:384` whitelist trap** — `_PROCESS_TIMEOUT` default is a one-line change inside the
  autopatch whitelist. **Not taken.** It alters production behaviour for every adapter that does not
  override (Slack 60, kiosk 90) to paper over a harness budget. The fix is harness-side.
- **Incidental:** `NEMOTRON_REWRITE_FALLBACK` is throwing **410 Gone** from
  `integrate.api.nvidia.com` — a dead endpoint being called every run. Not investigated.

## Hazard ledger

| Hazard | Disposition |
|---|---|
| 30 timeouts miscounted `patchable`, `skip_failures: 0` | **Filed** — second-order watchdog defect noted on #3085 |
| UNS-gate cluster (6) unpatched | **Explicitly accepted** — unverifiable in a 16pt band; named as first post-fix target |
| `engine.py:384` timeout bump | **Explicitly rejected** — wrong lever, production blast radius |
| 08-30 fragment stranded on local main | **Fixed** — pushed to `docs/eval-fixer-2026-08-30` |
| 08-31 / 09-01 missing fragments | **Filed** — tracker #1876, not investigated |
| NVIDIA nemotron 410 Gone | **Filed** — recorded here, not investigated |
| PR #3321 (08-19 fragment) open since 08-19 | **Flagged, not touched** — foreign, predates this session |
