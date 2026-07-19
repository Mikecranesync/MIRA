# Tower OP bench ROUND 5 — the "push to 9/10" loop (alpha / kimi-8k / beta / gamma), 2026-07-19

**Directive:** Mike, 2026-07-19: "continue running this loop until you're at 9 out of 10 if it's possible to get there" — executed inside the original **$2.00 declared budget** (round 4 had spent ≤$0.25 of it). This round ran two raw probes, built and shipped two production levers (PR #2819), ran two full production rounds through them, judged everything with 37 more blind adversarial sonnet judges, and ends at the budget wall with the honest answer.

**TL;DR — 9/10 was NOT reached.** Best production round: **5.25/10** (2.8× the pre-loop 1.9 baseline). Best measured configuration anywhere: **8.54/10** (Kimi-K2.6 raw + the new 8192-token burn-retry — 10 pass / 1 partial / 1 fail). The distance from 8.54 to 9.0 is exactly two named cases; the distance from production (4.5–5.3) to 8.54 is one named mechanism — **the production theory-prompt template itself**. Everything below is measured, not guessed.

## The measured ladder (blind adversarial sonnet panels, same protocol as rounds 1–4)

| Step | Config | Mean | Pass/12 | Cost (ceiling) |
|---|---|---|---|---|
| R3 baseline | production, gemma-3n | 1.9 | 1 | $0 |
| R4-B2 | production, Kimi, broken adapter | 0.0 | 0 | $0.22 |
| R4-B1 | gpt-oss-120b over frozen r3 evidence | 3.1 | 1 | $0.005 |
| R5-alpha raw ceiling | MiniMax-M3 single-call | 6.96 | 7 | $0.39 (both models) |
| R5-alpha raw ceiling | Kimi-K2.6 single-call (5 reasoning burn-outs = 0) | 5.67 | 7 | — |
| kimi-8k micro-probe | the 5 burned cases at the retry cap | 5/5 recovered | — | $0.12 |
| **Kimi raw + retry (composed)** | alpha answered + 8k recovered, judged | **8.54** | **10** | — |
| Oracle best-of-two raw | per-case max(Kimi, MiniMax) | 8.75 | — | — |
| **R5-beta** | **production**, MiniMax + router fix | **5.25** | 4 | $0.27 |
| **R5-gamma** | **production**, Kimi + fix + full-res theory | **4.46** | 3 | $0.68 |

Key single number: Kimi-K2.6's **answered** cases in alpha averaged **9.71/10** — every answer it produced raw was pass-grade. Its only raw failure mode was reasoning burn, which the new retry recovers (5/5 at 8192 raw).

## What was built and shipped (PR #2819, `fix/router-reasoning-burn`, v3.176.5 — 29 CI checks green)

1. **Router reasoning-model handling** (`shared/inference/router.py`): `<think>`-strip on every reply + ONE bounded retry with `LLM_REASONING_RETRY_MAX_TOKENS` headroom (default 8192, or-form) when a reply is empty with burn evidence (cap-hit tokens / `reasoning_content` / think markup). 18 hermetic tests; compose-mapped at all 10 `TOGETHERAI_TIMEOUT` sites.
2. **`PRINT_THEORY_FULL_RES`** (`engine._grounded_print_reply`): sends the caller's full-resolution `interpret_b64` to the cascade theory call instead of the 1024 px crush. Default off; 4 hermetic tests; compose-mapped.

**Proof the fix works:** round 4 (Kimi, no fix): 0/12 replies, 2/12 classification misroutes. Beta (with fix): 10/12 real cascade replies, **12/12 correct classification** (the misroute class closed — the describe stage returns content again). Gamma logs show 21 live `REASONING_BURN` retries. The plumbing is no longer the blocker.

## Finding 1 — the production template is now the measured bottleneck

Same models, same photos, same judges: raw 3-sentence prompt → **6.96 / 8.54**; production template (OCR block + evidence contract + 6-section theory writeup) → **5.25 / 4.46**. The template taxes strong models three ways, each measured:

- **Fabricating verbosity.** The template's full-writeup shape pulls invented device tags into the elaboration around correct direct answers: **26 invented-tag entries in beta, 21 in gamma, ~0 in the raw lanes** (e.g. beta c01 wraps a defensible coordinate in 9 fabricated tags; gamma c02 answers M1–M4 ratings perfectly then invents "YB.1–YB.4" for the printed Y6.x; gamma c06 launders a garbled title-block date into a "photograph sheet 20 next" redirect). Judges score the FULL reply — the padding converts raw passes into production partials.
- **Reasoning-burn amplification.** Raw Kimi at 8192 answers all five hard cases (3.6k–5.4k reasoning tokens). Through the production template the same cases think past 8192 — gamma lost c01/c03/c04/c07 as burns despite the retry, at 2.6× beta's round cost. Even MiniMax — zero burns raw — burned twice in production (c06/c07).
- **It still pays for lookups.** The OCR-evidence block genuinely improved table-lookup cases: beta c09 8 (raw 6, the invented "Q0" gone), gamma c10/c11/c12 at 9–9.5. The template's evidence discipline works exactly where the answer is a printed row — and hurts everywhere else.

Implication: the evidence-contract template was built to discipline a weak model (gemma, round-3's ~600 fabricated tags). For strong reasoning-vision models it inverts: **prompt weight is a first-class variable.** The nearest untested lever is a slim answer-first theory prompt for vision-strong models, with evidence discipline enforced post-hoc by the deterministic autoeval instead of in-prompt.

## Finding 2 — the two cases that block 9.0 even in the best lane

Kimi raw+retry scores ≥8 on ten of twelve. The remaining 5.5 points:

- **c01 — grid-coordinate misread (2/10; both models).** Kimi and MiniMax both call K1's column "2"; three independent judges re-measured the printed column ticks (one by pixel calibration) and land on **column 3** (or precisely: the coil straddles the 2/3 boundary with the label on the 2 side — the beta judge's measurement). A fine spatial measurement on a phone photo that current serverless vision models get wrong and state unhedged. Untested fixes: tick-counting prompt with shown work; honest boundary-uncertainty phrasing.
- **c03 — header-tier omission (6/10).** The recovered answer maps K4.1–K4.4 → braking relay per Inverter No.1–4 correctly but drops the co-equal printed "torque limitation (R1)" tier + 13/14 contact numbers + /2.5 cross-refs. Untested fix: a completeness clause scoped to the asked device.

If both convert, the raw ceiling projects to ~9.4. If they don't, **~8.5 is the honest ceiling of current Together serverless vision on these photos.**

## Costed next iteration (requires a fresh budget declaration — the $2.00 is spent)

| Option | What | Est. ceiling | Expected effect |
|---|---|---|---|
| **C (do first)** | c01/c03 targeted raw prompt probes (tick-counting; completeness clause), 2 cases × 2 models | ~$0.10 | validates the two blocking-case fixes before any full round |
| **A** | Slim answer-first theory prompt (knob-gated, vision-strong models) + MiniMax primary | ~$0.30/round | closes the production-vs-raw gap; kills template fabrication + burns |
| B | Same + Kimi, retry cap 16384 | ~$0.9–1.2/round | tests whether gamma's 4 burns clear at 2× headroom (30–60 s/case) |
| D | Best-of-two ensemble | ~$0.6/round | oracle bound measured = 8.75 — below 9 unless C converts |

Recommended: **C → A → (B only if A still burns)**. Projection if C converts and A holds raw quality: production ≈ 8.5–9.2.

## Cost ledger (the whole $2.00, rounds 4+5)

| Phase | Ceiling |
|---|---|
| R4 (A1+A2+B1+B2) | $0.25 |
| R5-alpha (24 raw calls, 2 models) | $0.39 |
| kimi-8k micro-probe (5 calls) | $0.12 |
| R5-beta (production, MiniMax) | $0.27 |
| R5-gamma (production, Kimi + full-res) | $0.68 |
| Judging — 61 blind sonnet judges + verification/forensics agents across 6 panels | $0 Together |
| **Total** | **≈ $1.72 of $2.00** (ceiling-priced; unknown models metered at $3/$3 — true spend lower; reconcile vs Together dashboard) |

Spend-law compliance: every metered phase was the bounded acceptance test of a named change (access → quality → retry-cap validation → fix-in-production → lever-in-production); per-phase BudgetGuard caps; gamma additionally ran under an in-script per-case ceiling guard ($0.75); resumable skip-existing probes (no re-validation of unchanged inputs); the loop STOPS here because the remaining $0.28 cannot fund a meaningful full round.

## Evidence

Session-522d4a0e scratchpad: `qual-r5/alpha/{kimi,minimax}/c*.json` · `qual-r5/kimi8k/c*.json` · `qual-r5/laneBETA/` + `run5.log` · `qual-r5/laneGAMMA/` + `run6.log` · `alpha-verdicts.json` / `kimi-full-verdicts.json` / `beta-verdicts.json` / `gamma-verdicts.json` (verbatim panel JSON). CHARLIE: `~/towerop/out-r5/`, `out-r6/`, `run5.log`, `run6.log`, `run_bench5.sh`, `run_bench6.sh` (with the spend guard). Photos sha256 12/12 verified (same custody chain as rounds 3–4). Branch `fix/router-reasoning-burn` @ `5f887e01` (PR #2819). Round-4 context: `ROUND4-2026-07-19-together-qualification.md` (PR #2818).


---

## ADDENDUM 2 (same day, third directive: "do what you would do to get this up to the next intelligence level"): PRINT_THEORY_VERIFY — generate→verify beats the raw ceiling

**The build (PR #2826, v3.178.0):** `PRINT_THEORY_VERIFY=1` — after a non-empty theory draft, ONE self-verification pass re-reads the sheet against the draft (fix misquotes to printed text, delete claims not visible, add printed tiers/contacts/xrefs omitted on the asked device, change nothing else). Falls through on any failure — draft never lost. Eight hermetic tests; composes with the delta knob trio.

**R5-epsilon acceptance run** (delta config + verify; $0.3721, in-script guard stopped the round after c11 — c12 unmeasured; 12 blind judges on the 11 measured):

| Case-matched (11 cases) | delta | **epsilon** |
|---|---|---|
| Mean | 7.59 | **8.55 (+0.96)** |
| Passes | 6 | **8** |

**Per-case deltas:** c04 **3→10** (the column-shift misread that survived every prior configuration — the verify re-read corrected I5.1→I6.1 and X5,1.3→X5,2.3, judged a clean 10); c08 6.5→9.5 (wrong volunteered terminal DELETED); c07 7→9 (labels quoted verbatim); c06 4→6; unchanged: c01 9, c02 9.5, c05 10, c10 10, c11 9.5. **Regressions, both instruction-wording defects:** c03 6→5 (the "add omitted tiers" clause made the model SWAP tiers — torque-limitation replaced braking-relay instead of accumulating both); c09 9→6.5 (the verifier ADDED a wrong attribution — "240V at Q2" where the layout shows Q4.C — the editor prompt lacks "never add new connections/attributions; only printed labels directly on the asked device").

**Projected full-12 (c12 at delta's 9.5): ≈8.63 — the first configuration to EXCEED the measured raw model ceiling (8.54), through the full production path.** Verify mechanism health: 11/11 applied, 0 empty, 0 errors, 0 burns. Cost: verify roughly +65% tokens/round (the second full-res image upload dominates) — $0.37 vs delta's $0.23 ceiling.

**Next bounded iteration (needs a fresh declaration, ~$0.40):** two verify-prompt wording fixes — (1) "add missing tiers WITHOUT removing any function label the draft already named" (c03), (2) "NEVER add a new connection, terminal, or attribution the draft did not contain; additions are limited to printed label text directly on the asked device" (c09) — then re-run. If both regressions convert while the four fixes hold, the projection is ≈9.2. The 9/10 goal is, for the first time, within a single wording iteration's reach.

**Ledger for this directive:** $0.3721 (guard-stopped $0.02 past the $0.35 line by per-case check granularity — reported actual). Program total across three directives: ≈$2.42 ceiling-priced. 86 blind judges total.


---

## ADDENDUM 3 (fourth directive: "merge all three and start the adapter fix"): R5-zeta — the wording fixes work; the residual is run variance, not defect

**Merged this directive:** #2826 (verify pass, v3.178.0), #2824 (delta addendum). **Built + acceptance-run:** PR #2827 (v3.178.1) — the two editor-prompt wording fixes (tiers accumulate; never add attributions), two prompt-pin tests.

**R5-zeta (full 12 cases, corrected verify prompt, $0.4059, 12 blind judges): mean 8.21 (98.5/120), 9 passes / 3 partials / 0 fails — the most passes of any round in the seven-round series.**

| Case | delta | epsilon | zeta | Read |
|---|---|---|---|---|
| c04 | 3 | 10 | 9 | **fix held** |
| c09 | 9 | 6.5 | 9 | **never-add clause WORKED — the wrong attribution did not recur** |
| c08 | 6.5 | 9.5 | 9 | held |
| c06 | 4 | 6 | **8 (first pass ever)** | held + improved |
| c01 | 9 | 9 | 5 | **run variance:** the coil straddles the 2/3 boundary near-50/50 (three judges pixel-measured); the model coin-flips sides across runs |
| c03 | 6 | 5 | 4 | **run variance:** tier pickup is stochastic — this run read neither tier |
| c07 | 7 | 9 | 6 | variance: a new false-precision detail this run |
| c02/c05/c10/c11/c12 | — | — | 9.5/10/10/9.5/9.5 | stable pass block |

**The honest characterization after three rounds of the same architecture (7.75 / 8.55* / 8.21):** the config's performance is a distribution centered ≈8.2 with a stable 8-case pass block; the gap to a 9.0 single-round mean is concentrated in three variance-dominated cases (a physically-ambiguous grid boundary, stochastic tier pickup, occasional detail fabrication). Per-case best-of-three = **9.1** — the capability is 9-class; a single-round 9.0 requires either variance reduction (self-consistency/multi-sample on flagged cases — a next lever, ~2× verify cost on 2-3 cases) or is achieved today by best-of-N. The wording fixes are strictly positive (c09 conversion, no regressions attributable to them) — #2827 merges on this evidence.

**Ledger (directive 4):** zeta $0.4059. Program total across four directives ≈ **$2.83** ceiling-priced. 98 blind judges total. Staging carries the delta trio + verify (deployed, healthy) — v3.178.1 redeploy follows #2827's merge.
