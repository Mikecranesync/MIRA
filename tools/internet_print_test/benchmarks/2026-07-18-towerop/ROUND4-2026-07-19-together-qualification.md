# Tower OP bench ROUND 4 — Together OSS qualification (two lanes), 2026-07-19

**What this round is:** not another lever round — a **qualification**: can Together serverless OSS replace the exhausted-OpenAI-credits interpreter slot, and if so with which model and which architecture? Run under Mike's **$2.00 declared budget** (spend law, `.claude/rules/zero-token-architecture.md` Hard Rule #1). Four phases: **A1** serverless-access probes, **A2** real-photo quality probe, **Lane B1** (big-text synthesis over frozen round-3 evidence), **Lane B2** (full production rung = round 4, vision model swapped to the A2 winner). Same 12 sha256-verified proprietary photos (manifest re-verified locally: 12/12), same `cases.json` (L7-corrected c06), same production path as rounds 1–3 (`bot._try_print_translator_reply` via the pack harness) for B2. Judged per the pack protocol — independent adversarial sonnet judges, parallel, blind to priors — with a twist this round: **two fully independent 12-judge panels** graded Lane B1 (Panel P = protocol/schema-forced; Panel R = replication from a second orchestration), giving a measurement-stability check for free.

**Priors:** baseline `REPORT.md` (mean 1.7) · rerun1 (1.0) · rerun2 (0.5 protocol / 1.0 corrected) · round 3 `ROUND3-2026-07-19-post-levers.md` (1.9, PR #2813) — routing wall closed; bottleneck = pure synthesis on the free vision model.

## Headline (honest)

**The qualification splits perfectly clean: synthesis is solved and nearly free; integration is the only blocker.**

- **Lane B1 is the best mean of the five-round series — 3.1/10 (Panel P; replication panel 3.5) — and kills the fabrication class outright: 0 invented tags across all 24 verdicts**, vs ~600 fabricated tags in round 3's four worst replies. `openai/gpt-oss-120b` synthesizing over round 3's *existing* perception, at **$0.0048 for all 12 cases** (~$0.0004/case), produced 1 pass / 4 partial and turned every round-3 fabrication flood into an honest, evidence-cited decline.
- **Lane B2 scored 0.0 — an integration zero, not a model zero.** The one-env-var flip (`TOGETHERAI_VISION_MODEL=moonshotai/Kimi-K2.6`) produced 0/12 usable replies: Kimi is a reasoning model and burned its entire output budget thinking at BOTH production call sites (1024-cap vision stage, 2000-cap theory stage) — 20 of 22 calls returned HTTP 200 with empty visible content. A2 proves the same model answers the hardest bench question **photo-exactly in 3.5 s** on a raw call. The gap is entirely adapter-shaped.
- The OpenAI interpreter slot this qualification exists to replace is confirmed hard-dead: 30 × 429 `insufficient_quota` (3 per print case).

**Verdict: Together OSS qualifies to replace the slot — but not by env-var flip alone.** Two concrete engineering fixes stand between here and the flip (reasoning-model handling in the provider adapter; classify-fallback misroute), and one no-regret production win is available immediately (gpt-oss-120b as the synthesis step — see Recommendations).

## Phase A1/A2 — the serverless landscape moved (access map)

Probed live 2026-07-19 (catalog claims UNTRUSTED — live-probe law; rejection signature HTTP 400 `model_not_available`):

| Model | Serverless | Vision | A2 quality probe (c10 LED photo, real bench question) |
|---|---|---|---|
| `moonshotai/Kimi-K2.6` | **NEW** (rejected 2026-07-18) | ✅ | **CORRECT** — "Error: Runtime error occurred / Module: X1.1", 225 out-tokens, **3.5 s** |
| `MiniMaxAI/MiniMax-M3` | **NEW** | ✅ | **CORRECT** — full row reading w/ module attribution, 96 out-tokens, 3.2 s |
| `Qwen/Qwen3.5-9B` | serverless-OK (1×1 probe rejected as image-validation, not access) | ✅ | **CORRECT** but terse, 14.8 s |
| `google/gemma-4-31B-it` | serverless-OK | ✅ | **ERROR — 180 s client timeout** on the real photo |
| `google/gemma-3n-E4B-it` (incumbent) | serverless-OK | ✅ | (round-3 evidence: 1 pass in 11 attempts; degenerate-enumeration failure mode) |
| `openai/gpt-oss-120b`/`-20b`, `LiquidAI/LFM2.5-8B-A1B`, `Llama-3.3-70B` | serverless-OK | text | LFM2.5 emits `<think>` blocks |

Three vision models that did not exist serverlessly on 2026-07-18 all answered the hardest lookup-class question **photo-exactly on a single raw call** — something the incumbent has done once in 48 graded production attempts. Note MiniMax-M3 returned clean terse *content* (no reasoning burn) through the same raw path — it is the co-candidate for the post-fix re-probe.

## Lane B1 — gpt-oss-120b synthesis over frozen round-3 evidence ($0.00475)

Design: per round-3 capture, an evidence packet (question + `ocr_items` + `tesseract_text` + `vision_description`) → `openai/gpt-oss-120b` (max_tokens 2000, temp 0, BudgetGuard cap $0.30, `<think>` stripped) under a strict no-evidence-no-claim contract. **No fresh vision** — isolates "is synthesis or perception the bottleneck?" 12/12 answered · 11,332 in / 5,091 out tokens · **$0.004755 actual** (incl. one c01 re-run after a Windows console encoding fix) · latency 2.0–8.2 s (median 2.6 s).

| Case | Panel P | Panel R | What happened |
|---|---|---|---|
| c01 K1 coordinates | PARTIAL 3 | partial 3 | Honest absence (packet OCR is pure garble, never even "K1"); but never surfaces the sheet's own row/column zone grid; generic redirect |
| c02 motor ratings | PARTIAL 4 | partial 4 | Honest absence — P=2.2kW / I=4.95A printed under M1–M4 but absent from packet; redirect points off-sheet (nameplate/BOM) instead of back to the sheet |
| c03 K4.1–4.4 role | FAIL 2 | partial 4 | Evidence-driven decline (packet missed the header row that answers it); Panel P docked an overclaiming opening line — the panels' one philosophy split |
| c04 TDC switch | PARTIAL 4 | partial 4 | Honest decline on garbage OCR; sheet plainly shows S7.1 → I6.1 → X5,2.3; hedged examples explicitly illustrative, no inventions |
| c05 sensor P/Ns | FAIL 1 | partial 4 | **False absence** (Panel P): the legend IS in ocr_items, garbled but structurally exact ("sssrsa - xer-wsorano." ≈ "S5,S7,S8 - XS1-N30PA340"); model declared "not in evidence" |
| c06 pawl switches | PARTIAL 5 | partial 4 | The L7 honest-absence+redirect shape at last — "no pawl reference in evidence, consult the input-assignment doc"; docked for a literal-token miss ("LH" is in ocr_items) and a generic redirect |
| c07 S19 meaning | FAIL 2 | partial 3 | Honest decline; "rope control" is printed above the switches but never reached the packet |
| c08 pretension relays | FAIL 2 | fail 1 | Honest decline; K5.1–K5.4 answer printed on sheet, absent from packet |
| c09 supply feeds | **PASS 9** | **pass 9** | **Both panels independently: pass.** 480V + 240V 60 Hz delivered clean from evidence with verbatim quotes — the same answer round 3 buried under ~190 invented tags |
| c10 FF LED | FAIL 2 | partial 2 | **False absence**: vision_description literally contains "Error: Runtime error" (the answer); model declared blanket absence. Round 3's fresh-vision PASS was perception-dependent |
| c11 IG 1 Hz flash | FAIL 2 | partial 3 | **False absence**: ocr_items contains "Speed sensor {does not turn" — a garbled fragment of the exact answer; reply lists "EVIDENCE USED: None" |
| c12 X6.3 elems 5–8 | FAIL 1 | (unparseable return) | The lane's one *wrong-assertion* case: confidently maps garbled fragments to elements 6/8 and gets both wrong. Still zero invented tags |

**Panel P: mean 3.08 (37/120) · 1 pass / 4 partial / 7 fail · invented tags: 0/12 cases. Panel R (independent): mean 3.5 · same single pass (c09) · same zero-fabrication finding.** Cross-panel agreement: exact on 5 cases, ±1 on 5, ≥2 on 2 (c03, c05 — severity philosophy on evidence-driven declines, not fact disputes).

**The B1 failure taxonomy** (this is the architecture signal): (a) honest declines where the packet genuinely lacks the answer — correct lane behavior, **perception-capped** (c01–c04, c07, c08); (b) **false-absence under-reads** where the answer sits in the packet garbled and the model misses it (c05, c10, c11, c06's token miss) — the *inverse* of gemma's failure direction: it under-claims instead of fabricating, the safe direction for a maintenance product; (c) one wrong-mapping (c12). The no-evidence-no-claim contract holds under pressure — round 3's dominant failure class (degenerate enumeration, ~600 fake tags) does not occur even once in 24 verdicts.

## Lane B2 — production rung round 4, `TOGETHERAI_VISION_MODEL=moonshotai/Kimi-K2.6` (ceiling $0.2154)

Identical to round 3's production rung on CHARLIE (fresh worktree @ `f7458826` v3.176.2, Doppler stg process-env keys, never on disk), one env-var change — the A2 winner as vision model. This is the "one-env-var production flip" test.

**Result: 0/12 usable replies — the flip FAILS against production as-is, for reasons that are adapter-shaped, not model-capability-shaped.** 10/12 cases shipped the deterministic "couldn't generate an explanation" fallback; 2/12 (c03, c07) declined as `classified_EQUIPMENT_PHOTO`. Protocol rule (empty/no-reply ⇒ fail 0) applied and independently verified over the collected files: 12 × fail/0, `needs_full_judging=[]`.

**Forensics** (independent audit of `run4.log`, cross-checked against my extraction — it corrected one of my aggregates): 22 Kimi calls, 40,290 in / 31,511 out tokens, **all 22 HTTP 200**, 20/22 empty content; 10 exact 2000-cap hits (theory stage), 8 exact 1024-cap hits (vision/classify stage); **30** OpenAI 429s (3 per print case — my initial count of 20 was retry-announcement lines, corrected by the auditor); c02/c04's first Kimi calls did return real content (791/480 tokens) — content through this adapter is possible but rare (2/22).

The per-case cascade shape (all 10 print cases identical): Kimi vision/classify call → empty at 1024 cap → transient DNS failure (`Vision call failed: Errno 8`) on the describe attempt → **deterministic OCR-density classifier takes over** → 3 doomed OpenAI attempts (429 quota) → second Kimi call (theory, 2252–2785 in) → empty at 2000 cap → `EMPTY_RESPONSE` guard correctly refuses → deterministic fallback text. c03/c07 never got that far: the deterministic fallback classifier misrouted them to `EQUIPMENT_PHOTO` at an identical fixed-floor 0.45 confidence (round 3 with gemma classified the same photos ELECTRICAL_PRINT 0.9/0.85, replies produced) — **the routing class round 3 closed re-opens through the classify-fallback path when the vision model returns nothing.**

Three failure mechanisms, one root: (1) **reasoning-token burn-out** — Kimi thinks past both production output caps and the adapter has no reasoning handling (no `<think>`/reasoning-content extraction, no cap headroom, no non-reasoning request param); (2) **classify-fallback misroute** — downstream casualty of the same empty content; (3) **OpenAI slot hard-dead** (the premise of this qualification, now triple-confirmed). Bench hygiene: all 12 harness cases exited 0; capture layer (L4) worked; `decline_reason` again null on the synthesis-error fallback branch (round-3 gap re-confirmed, still owed); autoeval scored the stock fallbacks `severity=ok` — defensible per-turn (the fallback is honest), but a 12/12 fallback *rate* should be observable somewhere.

## Per-case series comparison

| Case | Baseline | R1 | R2 (proto) | R3 | **R4-B1 (synthesis)** | **R4-B2 (Kimi prod)** |
|---|---|---|---|---|---|---|
| c01 | 1 | 1 | 0 | 1 | **3** | 0 |
| c02 | 1 | 0 | 0 | 0 | **4** | 0 |
| c03 | 5.5 | 4 | 2 | 3 | 2 | 0 |
| c04 | 2 | 1 | 0 | 0 | **4** | 0 |
| c05 | 2 | 0 | 0 | 3 | 1 | 0 |
| c06 | 0 | 0 | 0 | 0 | **5** | 0 |
| c07 | 1 | 1 | 1 | 2 | 2 | 0 |
| c08 | 0 | 0 | 2 | 2 | 2 | 0 |
| c09 | 6 | 5 | 0 | 3 | **9 PASS** | 0 |
| c10 | 0 | 0 | 0 | **7 PASS** | 2 | 0 |
| c11 | 0 | 0 | 1 | 1 | 2 | 0 |
| c12 | 0 | 0 | 0 | 1 | 1 | 0 |
| **Mean** | 1.7 | 1.0 | 0.5 | 1.9 | **3.1** (repl. 3.5) | **0.0** |

The c09/c10 inversion is the architecture lesson in two rows: **c09** (answer present in captured evidence) — synthesis wins where perception already succeeded; **c10** (answer needs a fresh table read) — round 3's only pass was pure perception, and B1 can't recover what capture missed. The lanes' wins are complementary: good perception + honest synthesis are BOTH required, and they are separable, separately-testable stages.

## Verdict: can Together OSS replace the OpenAI-credits interpreter slot?

**Yes — qualified.** The capability is proven on both halves (A2: photo-exact vision from 3 serverless models incl. two new ones; B1: honest, cheap, fabrication-free synthesis from gpt-oss-120b). What failed is neither model quality nor economics but two specific pieces of OUR plumbing:

1. **Provider/router reasoning-model handling** (`mira-bots/shared/inference/router.py` + the printsense vision call sites): read Together's reasoning/`<think>` content and extract the visible answer; give reasoning models cap headroom (the 1024 vision-stage cap is fatal by itself); treat "HTTP 200, tokens burned, content empty" as *reasoning burn* (retry with headroom / non-reasoning request) rather than generic `EMPTY_RESPONSE`. The `factorylm_ai` lab package (PR #2816) already ships a `<think>`-strip pattern to reuse.
2. **Classify-fallback misroute**: when the vision classify call returns nothing, the deterministic OCR-density fallback misroutes table-ish sheets at a fixed 0.45 floor (c03/c07). Fix #1 mostly removes the trigger; the fallback's fixed-floor confidence deserves its own look.

**Do NOT flip `TOGETHERAI_VISION_MODEL` on staging for the phone test yet** — B2 is direct evidence the flip ships the fallback message to the phone today. Sequence: land fix #1 (+#2) → **B2-prime** re-run (~$0.30 ceiling, same 12 cases) with BOTH candidates — Kimi-K2.6 and MiniMax-M3 (clean-content behavior in A2) — → flip staging for the phone test on the winner.

## Recommendations (ranked)

1. **No-regret, immediate, ~$0 — adopt the B1 architecture in production:** make `openai/gpt-oss-120b` the print-translator's *synthesis* step over the existing free vision/OCR capture. B1 measured it directly: +1.2 mean over round 3 and the degenerate-enumeration class (round 3's dominant failure) goes to zero, at ~$0.0004/case. Both independent orchestrations converged on this recommendation.
2. **The adapter fix (gap #1) then B2-prime** (~$0.30) to qualify the direct big-vision path — the potentially bigger unlock (A2-class table reads like c10 need fresh vision).
3. **Perception next:** B1's ceiling is capture quality — 6 honest declines were sheets whose OCR/vision missed printed answers, and 3 false-absence under-reads were garbled-but-present evidence. Better capture (or a fixed big-vision describe stage) raises the same synthesis for free.
4. **$4 first fine-tune: hold** (not "no"): tonight showed the harness, not any base model, was the blocker. Fine-tuning on a broken integration burns signal. Fix → B2-prime → only fine-tune a base that beats the 3.1–3.5 synthesis floor on a fair run. (Spend-law sequencing; both orchestrations agreed.)
5. **Autoeval/observability follow-ups:** fallback-rate signal (12/12 stock fallbacks scored `ok` per-turn); `decline_reason` on the synthesis-error branch (round-3 gap, second confirmation); the run4.log DNS `Errno 8` blip on CHARLIE (watch item).

## Cost ledger (spend law: declared $2.00 cap)

| Phase | Cost | Notes |
|---|---|---|
| A1 access probes | $0.0016 | catalog-wide access truth |
| A2 real-photo probes | ≤$0.0298 | 4 models, ceiling-priced (unknown models metered at $3/$3 fallback); probe ledger line includes A1 |
| Lane B1 | $0.004755 actual | known-priced gpt-oss-120b ($0.15/$0.60 per M), incl. one c01 re-run |
| Lane B2 | ≤$0.2154 ceiling | 22 Kimi calls, 40,290 in / 31,511 out; true Kimi rate < ceiling — reconcile vs Together dashboard |
| Judging + orchestration | $0 Together | Claude-side agents (two 12-judge panels, verification, forensics) |
| **Total** | **≤ $0.25 of $2.00 (~12%)** | $4 fine-tune NOT run (explicitly a morning decision) |

## Evidence & measurement notes

Session scratchpads (0ca06abc): `qual-r4/laneB1/c*.json` (answers+tokens+cost), `qual-r4/laneB2/c*.json` + `run4.log` (full cascade), `qual-r4/judge-verdicts-round4.md` (both panels verbatim + B2 protocol verification + forensic audit JSON), `towerop-out3/` (round-3 captures = B1 evidence packets), `probe_together_models.py` / `probe_a2_real_image.py` + outputs. CHARLIE: `~/towerop/out-r4/` + `run4.log`. Photos sha256 12/12 vs committed `photos.manifest.json`. Run mechanics: the run survived an operator-session death mid-flight (background workflow completed B1+B2 unattended; a successor session collected, judged, and reported) — the two-panel B1 judging is a byproduct of that redundancy, kept because independent replication strengthens the finding. Panel R's B2 judge dispatch raced artifact collection (8 file-not-found / 4 graded stale round-3 data per its own run report) and is **discarded**; B2 scoring rests on the protocol rule + post-collection verification + log forensics, which agree: 0/12.
