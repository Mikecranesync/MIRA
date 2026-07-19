# Tower OP bench ROUND 3 — post-levers L1–L5+L7 (the pure synthesis benchmark)

**Run:** 2026-07-19 09:15–09:22 EDT (13:15–13:22Z) on CHARLIE, fresh worktree @ `f7458826` (main v3.176.2 = #2808 pack + #2810 levers + #2811 pyright + #2812 docs), same 12 sha256-verified proprietary photos (manifest re-verified on both the run host and the judge host), same `cases.json` (L7-corrected c06 expected), same production path (`bot._try_print_translator_reply` via the pack's harness), Doppler stg scoped process-env keys only (never on disk), **$0.00 total inference** — every LLM call = `together google/gemma-3n-E4B-it` (24 calls, all cost 0.0; OpenAI interpreter 429 `insufficient_quota` on every attempt, identical to all three priors). Judged per the pack protocol: 12 independent adversarial sonnet vision judges, parallel, blind to prior rounds.

**Capture-semantics note (L4, comparability):** this round's `final_text` is the FULL user-visible reply (ordered chunk concatenation, ack stripped) — equivalent to rerun2's *corrected lane*, and now the protocol lane. `final_text_last_chunk` preserves the old last-chunk protocol. Judge on `final_text`; when comparing to rerun2 cite its 0.5 (protocol) / 1.0 (corrected) split.

**Priors:** baseline `REPORT.md` (1.7) · rerun1 `RERUN-2026-07-19-post-2800.md` (1.0) · rerun2 `RERUN2-2026-07-19-post-2713-2805.md` (0.5 protocol / 1.0 corrected).

## Headline (honest)

**The routing wall is fully down: 12/12 pipeline entry — the rerun2 projection delivered exactly.** Every case classifies `ELECTRICAL_PRINT` (0.76–0.9), carries real OCR (18–184 items), and produces output; 11 substantive replies + 1 honest synthesis-fallback (c04). **Mean 1.9/10 (23/120), 1 pass / 1 partial / 10 fail** — nominally the best mean of the four rounds, but the composition is the story: **every remaining failure is synthesis quality**, and the dominant class is **degenerate enumeration** — the free vision model fabricated **~600 device tags across 4 replies** (c02 ~243, c06 ~145, c09 ~190, c05 a 1–391 number dump). c10 — dead in all three priors — is the round's proof case: **PASS 7/10** on a correct, grounded, photo-verified LED-table lookup.

## Per-case (graded on full-reply `final_text`)

| Case | Baseline | Rerun1 | Rerun2 (protocol) | **Round 3** | What happened |
|---|---|---|---|---|---|
| c01 K1 coordinates | FAIL 1 | FAIL 1 | FAIL 0 | **FAIL 1** | Never names K1 (conflates K10); zero grid ref; invents F315a–d + S1–S5 as flat "Evidence". Autoeval ok — **miss** (invented tags undetected) |
| c02 motor ratings | FAIL 1 | FAIL 0 | FAIL 0 (honest timeout) | **FAIL 0** | L3's 90s window converts rerun2's honest timeout-fallback into a runaway ~243-tag K2.5–K2.247 enumeration; P=2.2kW/I=4.95A never stated; omits M4. Autoeval ok — **worst miss of the round** |
| c03 K4.1–4.4 role | PARTIAL 5.5 | PARTIAL 4 | FAIL 2 | **PARTIAL 3** | Real K4.x tags + live-state caveat, but no per-inverter mapping, misses printed "torque limitation (R1)"; launders 2 garbled-OCR quotes as printed labels. Autoeval P0 fired |
| c04 TDC switch | FAIL 2 | FAIL 1 | FAIL 0 (pre-vision decline) | **FAIL 0** | **ENTERS now (L1)** — handled=true, classified 0.9, vision names the right sheet; then theory synthesis dies → stock "couldn't generate" fallback. `decline_reason` left null on this branch (gap, below) |
| c05 sensor P/Ns | FAIL 2 | FAIL 0 | FAIL 0 (honest timeout) | **FAIL 3** | Half-right lookup: S2/S3/S4=XS1-N18PC410 exact; S5/S7/S8 misread (XSI-N30P430 vs XS1-N30PA340 — wrong-part-order risk); then a fabricated 1–391 terminal dump to token cap. Autoeval P1 `cap_truncation` fired |
| c06 pawl switches | 0 — gate | 0 — gate | FAIL 0 | **FAIL 0** | Never reaches the pawl topic: runaway fake S12.4–S112.4 + "Extension set 35–78" (~145 tags), truncated mid-loop. The L7 honest-absence+redirect pass was available and never approached. Autoeval P0 fired |
| c07 S19 meaning | FAIL 1 | FAIL 1 | FAIL 1 | **FAIL 2** | Cleanest failure shape: zero inventions, caveat present, grounded — but circular non-answer ("monitors PLC input circuits") while "rope control / rope-failure-switch c.1–c.4" is printed directly above the switches |
| c08 pretension relays | 0 — gate | 0 — gate | FAIL 2 | **FAIL 2** | Reads the car1–4 header, then substitutes generic K1–K5/R1–R5/"Q1 breaker" for the legibly printed K5.1–K5.4. Autoeval P0 fired |
| c09 supply feeds | PARTIAL 6 | PARTIAL 5 | FAIL 0 / corr. PARTIAL 5 | **FAIL 3** | Supply-feed answer EXACTLY right (480V+240V 60Hz, photo-verified) — then ~190 invented Q/S/F tags as a "component inventory" + false-illegibility excuse. Autoeval P0 fired |
| c10 FF LED | 0 — gate | 0 — gate | FAIL 0 (NAMEPLATE drop) | **PASS 7** | **L2 density gate routes it; model nails the lookup** (X1.1 row: FF = "Error: Runtime error occurred"). Docked for generic padding + a table-structure misdescription. The round's proof case |
| c11 IG 1 Hz flash | 0 — misclass | 0 — misclass | FAIL 1 | **FAIL 1** | Generic sheet summary; never does the X4.4 LED5 lookup (answer's row is in its own OCR); invents K10; false-illegibility claim on a legible row; launders garbled OCR verbatim. Autoeval ok — **miss** |
| c12 X6.3 elems 5–8 | FAIL 0 | 0 — misclass | FAIL 0 | **FAIL 1** | Six-section template instead of the asked lookup; one honest illegibility flag (isolated bright spot); misattributes "Not assigned" to X6.4. Autoeval P1 fired |

**Mean 1.9/10 · passes 1/12 · partials 1/12.** Lane comparability: vs rerun2-corrected (1.0) this is +0.9 on the same measurement basis; vs baseline (1.7, single-chunk era) +0.2. The mean is NOT the result — the structural composition is.

## Lever outcome audit (what this round was for)

| Lever | Verdict | Evidence |
|---|---|---|
| **L1** intake-only wiring carve-out | ✅ **DELIVERED** | c04 enters for the first time since rerun1: handled=true, ELECTRICAL_PRINT 0.9, vision correctly names the sheet. (Its *synthesis* then failed — separate class, unchanged by L1's job) |
| **L2** `NAMEPLATE_FIELD_DENSITY_THRESHOLD=0.15` | ✅ **DELIVERED + converted** | c10: NAMEPLATE-escape drop in rerun2 → ELECTRICAL_PRINT + **PASS 7/10**. The only lever that turned a routing fix directly into a scored pass |
| **L3** `TOGETHERAI_TIMEOUT` 90s | ✅ mechanically / ⚠️ **double-edged** | Zero client-timeout kills (rerun2 had 2); 6× `SLOW_LLM_CALL`, max ~35s, well under ceiling. BUT the answers the 30s timeout used to suppress came back as fabrication floods: c02/c05's rerun2 "honest couldn't-generate" became 243 fake tags and a 1–391 dump. Net +3 points across the pair, honesty floor traded away |
| **L4** capture honesty | ✅ **DELIVERED, one gap** | `provider` = answering truth on all 12 (together ×11; the rerun2 "says openai/gpt" mislabel is gone). Full-reply `final_text` eliminates the split-reply grading distortion (c09's correct answer now visible to judges). **Gap:** `decline_reason` stays null on the c04 generate-failure fallback branch — it populates on declines, not on synthesis-error fallbacks |
| **L5** `asked_module_unresolved` P1 | ✅ armed, 0 fires — **correct** | The intake failure it targets (c11/c12-class module questions dying unresolved) no longer occurs; both cases entered and answered (wrongly — that's the deferred `cross_module_row_quote` class, not this rule's) |
| **L7** c06 corrected expected | ✅ judging followed it | The honest-absence+redirect pass path was live; c06 scored 0 anyway because the reply never reached the topic — a pure synthesis verdict, exactly what the correction was for |

## Per-class (the comparison that matters)

| Failure class | Rerun2 | **Round 3** | Call |
|---|---|---|---|
| Routing drops (all variants: caption gate, table misclass, NAMEPLATE, carve-out) | 2 (c04, c10) | **0** | **CLOSED as a class** — first round with zero pre-synthesis deaths |
| Degenerate enumeration | c06, c09 (+2 suppressed by timeout) | **c02, c05, c06, c09** | **DOMINANT** — ~600 fabricated tags; L3's longer window re-exposed the two timeout-suppressed cases. This is now the #1 scored failure mode |
| Fabricated device tags (non-runaway) | c01, c03, c07, c08, c11 | c01, c08, c11 (+c03 laundering) | PERSISTS — generic-schematic-vocabulary substitution for printed tags |
| Wrong-row / cross-module table lookup | c11, c12 (new class) | c11, c12 | PERSISTS — question-ignoring template answers on safety tables |
| False-absence / false-illegibility for printed text | c07 | c03 (terminals), c08 (hedge), c11 (legible row) | PERSISTS, mutated phrasing |
| Garbled-OCR laundering | c03, c09 | c03, c11 | PERSISTS |
| Honest synthesis fallback | c02, c05 | c04 | Moved — the floor exists but L3 shrank its footprint |
| Live-state caveat present | sporadic | c03, c07 | Still minority behavior |

## Autoeval audit (L5-era observability, judged against 12 independent verdicts)

- **Precision 6/6:** every fired flag was judge-confirmed — c03 P0 (`unsupported_state_claim`+`false_absence_claim`), c05 P1 (`cap_truncation` — reply ends mid-number), c06 P0 (`invented_tags`+`degenerate_enumeration`), c08 P0 (`unsupported_state_claim`), c09 P0 (`degenerate_enumeration`+`false_absence_claim`), c12 P1 (`false_absence_claim`).
- **Recall gaps — 3 cases the autoeval marked `ok` that judges failed with inventions:** **c02** (the ~243-tag incrementing K2.x runaway — worst miss; the enumeration detector apparently keys on a pattern this variant evades), **c01** (9 invented tags incl. laundered-fusion F315a–d), **c11** (invented K10 + false-illegibility). File as detector-widening candidates.
- `SLOW_LLM_CALL` ×6 (max ~35s) — the new 90s ceiling indicator working as intended; no ceiling hits.

## Harness/bench hygiene found this run (owed to the pack)

- **`decline_reason` null on the generate-failure fallback** (c04): the L4 field populates on surface *declines* but not on the "couldn't generate an explanation" synthesis-error branch, and `provider` reads `deterministic` for that stock message (autoeval saw `provider=None` for the same turn). Both fields should carry the fallback truth (e.g. `decline_reason="synthesis_error_fallback"`, provider=none) so declined-by-design vs died-in-synthesis vs answered is machine-readable.
- Judge-photo custody: local judge copies sha256-verified against the committed manifest this round (12/12 OK) in addition to the run-host verification — closing a small chain-of-custody gap in the prior protocol.

## Where the bottleneck is now (unchanged conclusion, now with 12/12 evidence)

**Pure synthesis on the free vision model.** With routing fully repaired, gemma-3n-E4B-it is the measured ceiling: it performs one clean table lookup (c10) out of 11 attempts, and its characteristic failure under the longer L3 window is runaway sequential fabrication. Prompt-side contracts don't move it (rerun2's finding, re-confirmed); detection-side rules see most but not all of it.

**Score-moving levers, in order:**
1. **L6 / PR-F — the paid interpreter** (Mike-gated: OpenAI credits + `printsense/interpret.py` sign-off). The only lever expected to move correctness materially; the bench is now clean enough to measure it honestly.
2. **L8 candidate — degenerate-enumeration suppressor on the reply path**: a deterministic post-filter that detects incrementing-tag runs (≥N sequential fabricated-pattern tags) and truncates to an honest "couldn't extract" before send. Restores the honesty floor L3 traded away, at $0.
3. **Autoeval widening** for the 3 recall gaps (c02's incrementing-run variant, c01/c11 invented-tag fires).

**Evidence:** CHARLIE `~/towerop/out-r3/` + `~/towerop/run3.log` · session scratchpad `towerop-out3/` (captures + `judge-verdicts-round3.md`, 12 verbatim verdicts) · this file. Deploy state at run time: prod deployed green through 3.176.1 (12:01Z), staging bot carrying the levers.
