# POTD routine — internet-print shortcomings eval (2026-07-22)

A dry-run diagnostic batch of the POTD container routine (`a4a4bdf2`) against
**real OEM electrical prints fetched from the internet** (the
`tools/internet_print_test/sources.json` corpus), to surface where the routine
falls short before a round of improvements. No emails sent; Together only.

## Sample (12 selected, 15 categories spanned)

| test | category | outcome | interpreter | judge grade |
|---|---|---|---|---|
| mitsubishi-fx3u-input-wiring | plc_io | ✅ complete | 19 entities, title correct | **A** |
| rockwell-509-nema-starter *(prior)* | motor_starter | ✅ complete | 14 dev / 17 term, accurate | **C** |
| boundary-plc-ladder-rungs | plc_ladder | ✅ complete | 13 entities (a teaching *slide*) | **F** |
| boundary-pid-isa | pid | ✅ complete @240s | 18 entities (a P&ID) | **F** |
| boundary-hydraulic | hydraulic | ✅ complete @240s | 6 entities (Toro handout) | **F** |
| automationdirect-gs20-vfd | vfd | ❌ `PROVIDER_TIMEOUT` @90s | — | — |
| abb-star-delta-starter | contactor | ❌ `PROVIDER_TIMEOUT` @90s | — | — |
| banner-esfl-estop-relay | safety_relay | ❌ `PROVIDER_TIMEOUT` @90s | — | — |
| boundary-relay-ladder-xref | relay_ladder | ❌ `PROVIDER_TIMEOUT` @90s | — | — |
| omron-cp1e-plc-io | plc_io | ❌ `FETCH_FAILED` | — | — |
| schneider-atv340-vfd | vfd | ❌ `FETCH_FAILED` | — | — |
| eaton-freedom-nema-starter | motor_starter | ❌ `FETCH_FAILED` | — | — |

## Shortcomings (ranked, with evidence)

### S1 — Interpret timeout too short + no retry (RELIABILITY, P0)
5 of 9 fetched prints failed **`PROVIDER_TIMEOUT` at the 90s default** (`TOGETHERAI_TIMEOUT`),
producing *no analysis at all*. Re-running the same prints at **240s completed them**
(P&ID and hydraulic both finished) — so it is a timeout, not a hard failure. Two
compounding causes: (a) dense pages generate >90s of output; (b) Together was slow
during the run. The routine has **no retry-on-timeout** (unlike the truncation
escalation) and a **fixed timeout**. Fix: raise the default, make it density-aware
(scale with the page), and add a bounded retry on `PROVIDER_TIMEOUT`.

### S2 — Judge model (gemma-3n-E4B-it) is unreliable (JUDGE QUALITY, P0)
The independent judge reflexively flagged **all six hard-failure codes** on *every*
boundary print — `plc-ladder`, `pid`, `hydraulic` — regardless of whether the
interpreter actually erred, and produced **self-contradictory verdicts**: on the
hydraulic print it flagged all 6 hard failures **while reporting zero low criteria**;
on the ladder slide its summary said the response "fails to identify any hard
failures" *while it flagged all 6*. gemma-3n-E4B-it is too small to be a trustworthy
judge. Fix: use a stronger judge model/provider (it need not be vision if fed the
interpreter's structured output + an OCR text layer), add a judge-coherence check
(reject a verdict whose hard-failures contradict its criteria), and treat an
incoherent verdict as `validation=invalid` (gold-blocking) rather than `valid`.

### S3 — No "is this the right kind of print?" pre-gate (SCOPE, P1)
Three boundary items are **not electrical schematics** — a *P&ID* (cryogenic oxygen),
a *hydraulic training handout*, and a *ladder-logic teaching slide*. The interpreter
was honest (it labeled each correctly in the title) but **still extracted 6–18
"entities"** from them, and the pipeline ran full grade+judge+manifest on non-target
inputs. Fix: a cheap up-front classifier (electrical-schematic vs P&ID/photo/slide/
hydraulic) that short-circuits to a typed "not an electrical print" result — cheaper
and clearer than a full interpret+judge on the wrong artifact.

### S4 — Source fetch robustness (INGEST, P1)
3 of 12 OEM URLs failed to fetch (Omron, Schneider, Eaton) — CDN/redirect/robots
blocking with a plain `curl`. The corpus's own runner likely has the same gap. Fix:
a resilient fetcher (browser-like headers, redirect + retry, content-type sniff) and
mark unreachable sources explicitly rather than silently dropping them.

### S5 — Voltage identification is the interpreter's weakest axis (READING, P1)
Even the good runs lose points here: Rockwell-509 (grade C) scored `voltage_
identification = 60` (its only sub-70 criterion). Across the batch, voltage reading
is the most frequently weak axis. Fix: a voltage-focused prompt pass / OCR emphasis
on rating blocks and control-transformer taps; never infer a voltage not printed.

### S6 — Nothing can become gold on internet prints (WORKFLOW, P2)
Every run is **ungraded** (no rubric) → `gold_candidate=false` for all — correct by
design, but it means the internet corpus can never produce a gold example. The
deterministic grade also has no ground truth, so the *only* quality signal is the
(unreliable, S2) judge. Fix: build answer-key rubrics for a curated subset so real
grading + gold candidacy is possible, decoupling quality from the weak judge.

## What's working (keep)
- **Interpreter reads real electrical prints well**: Mitsubishi FX3U I/O → grade A;
  Rockwell 509 3-phase starter → accurate 14-device / 17-terminal extraction with a
  correct power/control trace. Anti-hallucination held on non-prints (honest
  type-labeling, no invented plant data).
- **Recovery / eligibility / independence machinery behaved**: no false repairs,
  `runtime_eligible` set correctly, judge identity verified + never self-review.

## Suggested improvement order
1. **S1** timeout + retry (unblocks half the corpus). 2. **S2** replace/harden the
   judge (the quality signal is currently untrustworthy). 3. **S3** print-type
   pre-gate. 4. **S4** resilient fetch. 5. **S5** voltage-reading pass. 6. **S6**
   rubric subset for real grading.

## Method / cost
Dry-run POTD container per print (interpret → recover → grade → judge → manifest),
no `--send`. Container `a4a4bdf2` (revision == git SHA). ~$0.06 real spend
(conservative ~$0.6). Staging/Together only; no Anthropic/OpenAI; production untouched.
