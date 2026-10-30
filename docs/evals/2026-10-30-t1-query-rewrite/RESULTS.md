# T-1 query-rewrite round — results (CHARLIE, 2026-10-30)

Pre-registration: `PREREG-rewrite-round.md` (written before any held-out run). Rows + checksums: `rewrite/sha256.txt`.
Score = right manual page in the top 5 retrieved chunks, `score.py`, k=10, one run per arm (pipeline deterministic).

## Arms
- **off** — production retrieval as shipped in #4979 (v3.427.11), prod flags.
- **ablation** — off + vector lane (NOTEBOOK_HYBRID_RETRIEVAL) + RRF merge with lexical weight 3. No paid call.
- **frozen** — ablation + gpt-5.4-mini query rewrite (one extra OR lexical variant). ~$0.0004 per question.

## Held-out forum questions (never looked at, never tuned on)
| set | n | off | ablation (hybrid + weight 3) | **frozen (…+ rewrite)** |
|---|---|---|---|---|
| fresh2 | 23 | 6 (seen once before, 2026-10-29) | 10 | **12** |
| fresh3 | 19 (22 admitted; 3 registered unanswerable, kept but never scored) | 6 | 5 | **7** |
| pooled | 42 | 12 = 28.6% | 15 = 35.7% | **19 = 45.2%, Wilson 95% LB 31.2%** |

- **Bar (#4875 row 5, LB ≥ 70%): NOT MET.** Not close — the arm would need about 36/42.
- fresh2: frozen gained 6, lost 0 vs off. fresh3: gained 3 (pf4m-03, ml1100-13, se-premium-serial-34), lost 2
  (micro820-um-09, se-m171-28). Top-6 pooled: off 12 → frozen 19. Top-1 pooled: off 8 → frozen 11.
- The vector lane on its own is not reliable on forum posts (fresh3: 7 → 5). The rewrite is what carries the gain
  (+4/42 over the ablation, +7/42 over off).

## Dev sets (used to choose the arm — not evidence of generalisation)
| arm | forum-fresh/29 | forum-new/19 | t4-77/77 |
|---|---|---|---|
| off | 11 | 11 | 69 |
| hybrid (equal RRF) | 15 | 13 | 64 |
| rewrite only | 15 | 11 | 67 |
| hybrid + rewrite, equal RRF | 15 | 13 | 61 |
| hybrid + rewrite, lexical weight 3 (**frozen**) | 19 | 14 | 65 |
| hybrid only, lexical weight 3 (ablation) | 15 | 13 | 66 |

Why weight 3: hybrid and rewrite rescue DIFFERENT questions (union 20/29 on forum-fresh), but equal-weight RRF let a
page that is mediocre in both lanes outrank a page that is first in one; weighting the lexical rank 3:1 keeps the
lexical winner. Weights 4 and 5 gave identical numbers; vector-lane text variants (rewrite / raw+rewrite) added nothing.

## Regression sets (frozen arm vs off, same harness)
| set | n | off | frozen | lost ids |
|---|---|---|---|---|
| t4-77 | 77 | 69 | 65 | acs355-q1, smcflex-q1, smcflex-q5, e3plus-q1, smc50-q4, tq-04, tq-34, tq-39 (gained e3plus-q3, smc50-q5, tq-30, tq-40) |
| oem-fault | 174 | 137 | 128 (+1/−10) | acs355-0b6dfcd5, gs10-ch6 ×4, pf40 ×4, pf4m-6cd28ed3 (no rewrite for these questions — this is the vector lane) |
| oem-index (clean 116) | 116 | 86 | 70 (+5/−21) | micro810 ×5, micro820-um ×2, pf4m ×5, … |
| robust | 1264 | 980 | 928 (+35/−87) | the vector lane again; reworded questions lose 87, gain 35 |

**The pre-registered frozen arm FAILS regression.** The vector lane that lifts forum posts costs fault-code and
parameter questions far more than it gains. It is not shippable as-is.

## POST-HOC arm (not pre-registered — declared in STATE.md before running, measured once): rewrite ONLY, no vector lane
| set | n | off | rewrite-only | notes |
|---|---|---|---|---|
| fresh2 (held-out) | 23 | 6 | 9 | |
| fresh3 (held-out) | 19 | 6 | 6 | |
| pooled held-out | 42 | 12 = 28.6% | **15 = 35.7%** (Wilson LB 23.0%) | bar not met |
| forum-fresh (dev) | 29 | 11 | 15 | |
| forum-new (dev) | 19 | 11 | 11 | |
| t4-77 | 77 | 69 | 67 (+2/−4; top-6 69→69, top-1 46→49) | gs10-ch6-q2, smcflex-q5, tq-29, tq-39 lost; e3plus-q3, tq-40 gained |
| oem-fault | 174 | 137 | 136 (+1/−2) | neutral |
| oem-index (clean) | 116 | 86 | **93 (+10/−3)** | the rewrite helps parameter questions |
| robust | 1264 | 979 | not run | rewriting 1,264 questions (~$0.45) would exceed the $0.50 bench cap |

Rewrite-only is a small, broadly non-negative improvement: +3/42 on unseen forum posts, +7 on parameter questions,
neutral on fault codes, ±0 on t4-77 top-6. It does not approach the T-1 bar either.

## Cost (final)
- Bench: $0.1394 paid (521 rewrites), cap $0.50.

## Cost
- Production: one gpt-5.4-mini call per technician message,
  ~300 in / ~40 out tokens ≈ $0.0004 — 1,000 questions ≈ $0.40/month. Runs under the existing `openAiRunBudget` cap.

## What this means
- On real forum-style questions the notebook finds the right page about 29% of the time today and about 45% with this layer.
  That is an improvement worth having behind flags; it is not the "right page 7 times in 10" the T-1 row asks for.
- The remaining misses are not a vocabulary problem a rewrite fixes: the blind-labelled answer pages often share
  almost no words with the post AND are not what the embedder ranks first either. Reaching 70% LB needs a different
  component (a stronger embedder / a re-ranker trained on manuals, or chunking that keeps tables with their headings),
  and more held-out questions to measure it on.

## Codex round 1 (PR #5003 @ 76b5084f9) — F1 fix re-measured
Codex F1: a rewrite hit counted as lexical coverage and could silence the last-resort OR pass on the technician's
own words. Fixed (rewrite rows join the pool but do not count as coverage; the original-words fallback still runs).
The rewrite-only arm was re-run once on every set with the fix (`raw/posthoc-after-codex-f1/`): fresh2 9/23, fresh3 6/19,
oem-fault 136, oem-index 93, t4-77 67, forum-fresh 15, forum-new 11 — identical to the pre-fix numbers, question for
question. The fix is a safety property (no candidate the technician's words would have found is ever lost), not a score change.
F2 (one overall deadline for the rewrite) and F3 (no rewrite call on general / OEM-corpus turns) do not touch ranking.

## Codex round 2 (PR #5003 @ 6f58ea339) — F5: three fresh3 questions were registered unanswerable but scored
`forum-fresh3-questions.json` marked fr3-e3plus-19, fr3-micro810-22 and fr3-se-m172-31 `kind: unanswerable` (blind label:
not answerable from the manual) but still carried their provisional `accepted` pages; the harness derives `kind` from
`accepted`, so every fresh3 result row counted them as answerable. Corrected: the audit now emits no accepted page for an
unanswerable candidate, every fresh3 row was relabelled from the registered question file (`scripts/relabel_kinds.py`),
and `score.py --questions` refuses rows that disagree with the registration. All numbers above are the corrected ones
(fresh3 n=19; pooled n=42). Before the correction the published figures were fresh3 7/22 (off), 7/22 (rewrite-only),
8/22 (frozen) and pooled 13/45 → 16/45 (rewrite-only) / 20/45 (frozen). The conclusion did not change.
On the three unanswerable questions the frozen arm, off, and rewrite-only each surfaced the provisional page once (1/3).
