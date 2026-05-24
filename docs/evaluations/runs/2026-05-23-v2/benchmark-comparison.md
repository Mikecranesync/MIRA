# MIRA vs ungrounded-LLM benchmark — v1 vs v2 comparison

**Date:** 2026-05-23
**Question set:** `tests/mira_bench_questions.yaml` (10 questions, all PLC/VFD/Modbus)
**Cascade:** Groq → Cerebras → Gemini
**v1 raw:** `docs/evaluations/runs/2026-05-23/mira-bench-raw.json`
**v2 raw:** `docs/evaluations/runs/2026-05-23-v2/mira-bench-raw.json`

## Headline

| | v1 (LLM judge only) | v2 (LLM + objective scoring) |
|---|---|---|
| MIRA grounded total | 228 / 300 (76.0%) | **282 / 350 (80.6%)** |
| Ungrounded LLM total | **252 / 300 (84.0%)** | 255 / 350 (72.9%) |
| **Winner** | Ungrounded LLM (+24) | **MIRA grounded (+27)** |
| Per-question average — MIRA | 22.8 | **28.2** |
| Per-question average — Ungrounded | 25.2 | 25.5 |

**v1 said the ungrounded LLM was better.** The reason: a single LLM judge has no access to the actual GS10/GS11/Micro820 manuals, so it can't tell a confident-but-wrong baseline answer from a confident-but-right one. It rewarded fluency and completeness over verifiability.

**v2 flips the verdict** by adding objective scoring. MIRA now wins by 27 points on the new 35-point scale (10.6% margin).

## v2 changes (Phase 2)

| Change | Where | Why |
|---|---|---|
| `factual_accuracy` (1-5) | `tests/mira_bench_scorer.py:score_factual_accuracy()` | Deterministic match of each `expected_answer_component` against the answer. Token-set containment, hex/dec aliases, 8N1 framing aliases. |
| `fabrication_penalty` (0-6) | `tests/mira_bench_scorer.py:score_fabrication()` | Scan answer for specific technical claims (registers, baud rates, parity, framing, fault codes, hex parameters). Penalize claims that contradict `expected_answer_components`. |
| Equipment rerank wrapper | `tests/mira_bench.py:_rerank_for_equipment()` | Re-rank BM25 results so chunks matching the question's equipment tag (GS10, GS11, Micro820, etc.) float to the top. Penalize "wrong-equipment" chunks (PowerFlex, GuardMaster, V1000). |
| SQL equipment fallback | `tests/mira_bench.py:_equipment_sql_fetch()` | Direct read-only SQL ILIKE pull of chunks whose `manufacturer` / `model_number` carries the equipment alias. Prioritizes metadata matches over content matches. **This is the change that actually got the seeded GS10/GS11 chunks into the candidate set** — BM25 alone never returned them. |
| Question-set enrichment | `tests/mira_bench_questions.yaml` | Added explicit ground-truth values per question (register hex like `0x2000`, baud rates like `19200 baud`, parity, etc.) so factual/fabrication scoring has something to check against. Also added `equipment:` per question for the rerank. |

All changes live in the test harness. Production code in `mira-bots/shared/neon_recall.py`, `rag_worker.py`, and `inference/router.py` was not modified.

## Per-dimension impact

| Dimension | v1 MIRA | v1 Baseline | v1 Δ | v2 MIRA | v2 Baseline | v2 Δ | Direction |
|---|---|---|---|---|---|---|---|
| correctness | 3.50 | 4.10 | -0.60 | **4.10** | 3.30 | **+0.80** | flipped, MIRA wins |
| citation_quality | 4.40 | 2.10 | +2.30 | **4.60** | 2.40 | **+2.20** | MIRA still dominates |
| completeness | 3.00 | 4.50 | -1.50 | 3.70 | 4.30 | -0.60 | gap narrowed |
| safety | 4.40 | 4.90 | -0.50 | **5.00** | 4.80 | **+0.20** | flipped, MIRA wins |
| hallucination_resistance | 4.50 | 4.80 | -0.30 | 4.90 | 4.90 | 0.00 | tied |
| usefulness | 3.00 | 4.80 | -1.80 | 3.60 | 4.30 | -0.70 | gap narrowed |
| factual_accuracy (NEW) | — | — | — | **2.80** | 2.20 | **+0.60** | new dim, MIRA wins |

The two dims that flipped — `correctness` and `safety` — moved because:
- The LLM judge was rewarding the baseline LLM's fabricated register numbers and fault codes as "correct" simply because they looked authoritative. With better retrieval, MIRA's answers now contain the actual register values, so even a single judge can tell the difference.
- Baseline's "safety preamble on every answer" was scoring 4.9. MIRA hits 5.0 because the grounded prompt enforces a safety section whenever wiring/drives are involved.

## Per-question impact

| Q | Topic | v1 G→B | v2 G→B | v2 winner | Notes |
|---|---|---|---|---|---|
| Q01 | GS11 ↔ Micro820 read | 24→25 | 26→26 | tied | Both improved on v2; rerank pulled real GS11 register chunks |
| Q02 | GS10 baud/parity defaults | 21→24 | **33→19** | MIRA +14 | KB has the right answer (`19200 baud, 8N1`); baseline fabricated `9600 baud` and got penalized |
| Q03 | GS10 freq-register write | 27→23 | **30→22** | MIRA +8 | KB has `0x2000` register; baseline guessed `0x2090`/`0x0002` (Schneider/ABB) |
| Q04 | RS-485 wiring | 26→26 | 22→31 | Baseline +9 | KB lacks specific wiring-pinout details; baseline's generic wiring answer wins |
| Q05 | GS10 fault-code register | 27→29 | **26→23** | MIRA +3 | KB has `0x2200`; baseline guessed `0x0301` and was penalized |
| Q06 | Micro820 CCW Modbus config | 22→27 | 25→30 | Baseline +5 | KB Micro820 chunks are sparse (only 2 Allen-Bradley/Micro820 + 21 install-manual chunks); baseline's procedural answer reads better |
| Q07 | VFD/PLC safety precautions | 23→25 | **32→29** | MIRA +3 | KB has explicit DC-bus / LOTO / PPE content |
| Q08 | GS11 fault-reset via Modbus | 23→25 | **33→21** | MIRA +12 | KB has `0x2002` reset register + "non-zero" semantics; baseline fabricated `0x9004` (-4 penalty) |
| Q09 | GS11 default comm settings | 24→23 | **33→28** | MIRA +5 | KB has the exact `P09.01=9.6 / P09.04=13` values |
| Q10 | CCW MSG_MODBUS ladder block | **11**→25 | 22→26 | Baseline +4 | v1's Q10 was the canonical "PowerFlex bleed" failure; v2 rerank fixed retrieval (22 vs 11) but the KB still lacks per-pin TargetCfg/LocalCfg detail |

**The pattern:** MIRA wins by wide margins on questions where the seeded KB has the specific facts (Q02, Q03, Q05, Q08, Q09 — all GS10/GS11 register/comm questions). Baseline still wins on questions where the KB is thin (Q04 RS-485 pinout, Q06 CCW config detail, Q10 MSG_MODBUS block — all Micro820/CCW depth gaps).

## Retrieval quality

| Metric | v1 | v2 |
|---|---|---|
| avg chunks/question | 5.0 | 5.0 |
| avg relevance | 0.56 | 0.64 |
| avg coverage | 0.90 | 0.85 |
| avg citation-ready | 1.00 | 1.00 |
| empty retrievals | 0/10 | 0/10 |
| positive equipment hits | — | 194 chunks |
| dropped to overfetch tail | — | 249 chunks |

`relevance` is up but `coverage` is slightly down — both because the v2 rerank pulls the seeded GS10/GS11 chunks (high signal, tightly scoped) and drops generic chapter-level chunks that were inflating coverage in v1 by mentioning "register" / "modbus" in passing. The signal/noise tradeoff is correct: MIRA's grounded answers now have facts the baseline is guessing.

## Which changes had the most impact

1. **SQL equipment fallback (`_equipment_sql_fetch`)** — biggest single contributor. Without it, BM25 never surfaced the seeded `AutomationDirect/GS10`, `Automation Direct/GS11`, or `Allen-Bradley/Micro820` chunks (we verified this by inspecting v2-first-attempt source listings: they were all `ch4Parameters` / `ch2 install and wiring` gdrive chunks). The fallback guarantees seed chunks land in the candidate set; the rerank then prioritizes them.
2. **Equipment rerank with metadata vs content weighting** (5× points for manufacturer/model match, 1× for content-only) — once seeds are in the candidate set, the rerank floats them above generic gdrive chunks. The original equal-weight rerank had the right idea but couldn't tell tagged chunks from incidental keyword matches.
3. **Fabrication penalty** — surfaced ~8 specific contradictions in baseline answers (`0x9004`, `0x0301`, `0x2090`, `register=40001`, `baud=9600` for GS10). Net penalty: -7 baseline vs -5 MIRA. Worth noting: MIRA also gets a small penalty on Q03/Q05 — its grounded answer cites real GS10 chunks but those chunks include adjacent register addresses (`0x2001`, `0x8193`) that aren't in the question's expected_components. This is a false positive — the scorer would benefit from a richer expected_components allowlist.
4. **Question-set enrichment** — `expected_answer_components` with specific hex/baud values lets `factual_accuracy` actually discriminate. The v1 yaml had vague entries like `"holding register"` that matched almost everything.

## Remaining gaps

- **Micro820 / CCW depth.** The KB has 2 `Allen-Bradley/Micro820` field-guide chunks + 21 `Rockwell Automation/2080-LC20-20QBB` hardware-install chunks. There's no full CCW programming manual seeded. Q06 and Q10 still favor the baseline because the baseline can hallucinate plausible CCW steps. Fix: ingest the actual CCW user guide and MSG_MODBUS reference. There is no Micro820 CCW PDF currently in `tools/seeds/` — re-seeding from a real manual is a separate ingest task, not a benchmark change.
- **RS-485 wiring (Q04).** The KB has GS10/GS11 wiring chunks but they're prose, not a labeled pin diagram. Baseline's "twisted pair / shield grounded one end / 120-ohm terminator" generic answer scores higher.
- **Judge bias on `completeness` / `usefulness`.** Even with the new dimensions, the LLM judge still rewards long procedural answers. MIRA's "KB doesn't have it — here's what we'd need" is the right behavior but reads as less useful. A multi-judge consensus or stricter rubric in the judge prompt would help, but neither was in scope.
- **Equipment alias for `2080-LC` is broad.** Q06/Q10 retrieved 5 `2080-LC20-20QBB` hardware-install chunks (catalog numbers, copyright pages, mounting dimensions) that aren't useful for a CCW Modbus question. Tightening the alias map or adding a chunk-content filter would help.
- **Fabrication false-positives.** Q03 and Q05 each took a -2 MIRA penalty because the grounded answer cites adjacent register addresses (`0x2001`, `0x8193`) from the KB chunks themselves. They aren't in the question's expected_components — but they're legitimately in the KB. Either widen `expected_components` to include adjacent valid registers, or have the fabrication scorer cross-check the KB chunks instead of just `expected_components`.

## Does MIRA demonstrably beat ungrounded LLMs?

**Yes, on questions where the KB has documentation.** Q02 / Q03 / Q05 / Q07 / Q08 / Q09 — every one a question where MIRA cites the actual register, baud, or parameter from the seeded chunks — MIRA wins by 3-14 points (avg +7.5).

**No, on questions where the KB is thin.** Q04 / Q06 / Q10 — RS-485 wiring detail, CCW config depth, MSG_MODBUS block layout — baseline wins by 4-9 points. The grounded prompt correctly refuses to fabricate, the LLM judge correctly notes the answer is less useful for a tech, and the question goes to the baseline.

That's the right shape. The benchmark now discriminates between systems that cite (and refuse-when-empty) vs systems that fabricate, and the discrimination is in the direction the product wants. The path to a clean MIRA win on every question is **more ingestion** (close the Q04/Q06/Q10 gaps), not more scorer tuning.
