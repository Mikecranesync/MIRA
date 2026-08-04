# W2a prompt-fix eval — results (2026-08-03)

Two runs, identical frozen fixtures (`seed_cases.json`, 10 cases), identical Together
judge (`meta-llama/Llama-3.3-70B-Instruct-Turbo`), identical engine environment.
Only difference: `mira-bots/prompts/diagnose/active.yaml` v1.2 (baseline, contains
*"You never give direct answers"*) vs v1.3 (adaptive policy per PRD §2.2).

## Headline numbers

| Mean (n=10) | Baseline (v1.2) | Post-W2a (v1.3) | Delta |
|---|---|---|---|
| evidence_utilization | 6.40 | 5.60 | −0.80 |
| path_efficiency | 7.60 | 7.00 | −0.60 |
| **gsd_compliance (DIALOGUE MODE)** | 6.70 | 6.20 | −0.50 |
| root_cause_alignment | 6.30 | 4.60 | −1.70 |
| expert_comparison | 8.10 | 7.00 | −1.10 |
| **composite** | **6.86** | **5.92** | **−0.94** |

## Per-case composites

| Case | Baseline | Post-W2a | Note |
|---|---|---|---|
| 1 | 7.10 | 8.10 | baseline handicapped by the turn-0 false control-refusal (defect D1) |
| 2 | 7.95 | 8.60 | |
| 3 | 6.35 | 6.35 | |
| 4 | 5.85 | 4.10 | |
| 5 | 7.60 | 5.10 | |
| 6 | 3.60 | 6.35 | baseline hit defect D3 (premature FSM exit, junk citation) |
| 7 | 7.45 | 3.60 | post run hit a premature 2-turn FSM exit (same D3 class) |
| 8 | 6.50 | 0.40 | post run hit defect D2 (UNS-gate deadlock, 8 identical gate turns) |
| 9 | 7.60 | 8.60 | |
| 10 | 8.60 | 8.00 | |

## Read this before believing the delta

**1. The delta is inside the noise floor.** The interrupted first baseline attempt
scored 5 of the same cases under the *identical* v1.2 configuration; per-case swings
vs the completed baseline reached **±4.5** (case 6: 8.1 vs 3.6) from engine + judge
stochasticity alone. A −0.94 mean over n=10 single runs is not resolvable against
that variance. This matches the documented judge-variance behavior in the PrintSense
program (single-run per-sheet scores are not quotable).

**2. Case 8's 0.40 is not a prompt effect.** Every MIRA turn in that conversation was
the templated UNS-gate demand — the diagnose system prompt (the thing W2a changed)
was never invoked. Whether the simulated technician's phrasing escapes the gate is
stochastic; the baseline run happened to escape, the post run happened not to.
Excluding case 8 from both runs: baseline 6.90 vs post 6.53 (−0.37, still noise).

**3. The fixture set cannot detect the W2a improvement.** All 10 seed cases are
live-diagnosis multi-turn scenarios — the regime where guided questioning is CORRECT
under the adaptive policy. The behavior W2a fixes (withholding a supported direct
answer behind a quiz — ct-04-class turns: "how do I reset a PowerFlex 525?" with a
citation in hand) does not occur in this corpus at all. Detecting it needs
direct-question fixtures (`tests/fixtures/answer_contract/` on PR #3088 has the
shapes offline; a paid variant was not authorized here).

**Conclusion:** no measured harm, no measured benefit, on an instrument that cannot
see the targeted behavior. The v1.3 prompt stands on the owner's policy decision
(PRD §2.2) and the offline pinned fixtures, not on this score delta — and this file
says so rather than pretending otherwise.

## Engine defects surfaced (free preflight + paid runs)

| # | Defect | Evidence | Where |
|---|---|---|---|
| D1 | `CONTROL_ACTION_RE` false positive: narrative "…every time we try to start the motor" triggers the read-only control refusal on a pure diagnostic question | seed-001 turn 0, both runs; regex byte-identical on `origin/main` | `mira-bots/shared/guardrails.py` branch 2 of `CONTROL_ACTION_RE`; `_CONTROL_GUIDANCE_RE` is `^`-anchored so mid-message questions never qualify |
| D2 | UNS-gate deadlock: when the technician cannot name a manufacturer/model, the gate re-issues the identical demand every turn, forever — no fallback to symptom-first triage after N failures | run 2 case 8: 8/8 turns identical gate template, technician gave symptom, location, and a suspected cause repeatedly | engine `AWAITING_UNS_CONFIRMATION` path |
| D3 | Premature FSM exit with junk citation: MIRA emits a bare reflection ("You think it's a WEG motor."), cites an uploaded photo *filename* as a source, and the run ends as if diagnosed | baseline case 6 (composite 3.6), post case 7 (3.6) | engine DIAGNOSIS-state transition + citation source labeling |

D2 is the most damaging in real use: a technician without a model number gets
stonewalled indefinitely. None of these were fixed in this branch (out of scope;
each needs its own both-directions tests).

## Actual spend (counted, not estimated)

| Item | Calls | Tokens (prompt + completion) | Cost @ $0.88/Mtok |
|---|---|---|---|
| Baseline run (complete) | 38 | 29,790 + 2,416 | $0.0283 |
| Post-W2a run (complete) | 45 | 38,072 + 2,757 | $0.0359 |
| Orphaned in killed processes (counters lost) | ~36 | est. ~30k | est. ~$0.03 |
| **Total** | **~119** | | **≈ $0.09 of the $10 ceiling** |

Engine-side calls ran on the free-tier Groq/Cerebras/Together cascade ($0 metered).
Anthropic was not called at any point.
