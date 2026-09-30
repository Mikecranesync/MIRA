# Jev on genuinely live turns — what survived contact with real traffic

**2026-09-23** · staging `300d89d329efa56f965941f3562eab42561ae438`
Harness `tools/qa/jev_decision_acceptance.py` · artifact `/tmp/jev-acc-realpath.json`

Everything in `docs/proofs/2026-09-23-jev-decision-calibration.md` is **reconstructed
states**. Everything here is **real staging turns through the deployed route**. They
disagree, and the live data is the one that counts.

---

## 1. The path had to be fixed first

The first acceptance run measured an evidence-free path: every turn returned
`skipped_general_mode`, `observation_in_context: false`, 0 chunks. The cause was
my harness, not the product — it omitted the `visualEvidence.fileId` rider that
`attachPhotoAndAsk` sends. Same photo, same question, rider as the only variable:

| | without | with |
|---|---|---|
| `visual_evidence.observation_in_context` | `false` | **`true`** |
| `visual_evidence.link_verified` | `false` | **`true`** |
| `retrieval.strategy` | `skipped_general_mode` | **`oem_corpus_bm25`** |
| `retrieval.oem_manufacturer_source` | `null` | **`photo`** |
| `context.chunk_count` | 0 | **6** |

Trace `deb232ce09ebcd653779e1c0faac4788`. Detail + the residual gap: **#3967**.

## 2. #3966 reproduced LIVE, not reconstructed

With the rider, the TP700 panel photo drove OEM retrieval **from the photo**, and
the corpus returned **SINAMICS V20 drive manuals** for an HMI panel:

```
"returned_doc_ids": [".../v20_operating_instructions_complete_en-US.pdf#p283",
                     "...#p288", "...#p289", "...#p290", "...#p287",
                     ".../GH6_0414_eng_en-US.pdf#p200"]
"oem_manufacturer_source": "photo"   "system_prompt_kind": "grounded"
```

Jev on that live turn: `wrong_family_grounding 0.85`, `family_match 0.10`,
`failure_class retrieval_mismatch @0.83`.

**This is the mandatory case, live.** It no longer rests on a hand-built state.

## 3. The live matrix — 14 turns, 7 scenarios, 2 reps, 14/14 evaluated

### Blind labels first

Answers were labelled sound/divergent reading **the answer text and the retrieval
facts only, with the Jev column hidden**. Result: 6 divergent, 8 sound — and
**almost every gap collapsed**:

| question | div | sound | gap | (constructed) |
|---|---|---|---|---|
| over_specificity | 0.63 | 0.41 | **+0.22** | +0.59 |
| used_strongest_evidence | 0.46 | 0.27 | +0.18 | −0.45 |
| family_match | 0.36 | 0.19 | +0.17 | −0.38 |
| follows_evidence | 0.29 | 0.47 | −0.17 | −0.67 |
| contradicts_observations | 0.76 | 0.62 | +0.14 | +0.50 |
| **wrong_family_grounding** | 0.27 | 0.26 | **+0.01** | **+0.34** |
| unsupported_numerics | 0.34 | 0.30 | +0.03 | +0.34 |

`failure_class` stopped separating too: 3 of 8 sound turns classed
`retrieval_mismatch`, only 3 classed `none`.

**On blind labels, the constructed-state result does not replicate.**

### Then I re-read two rows and found my labels wrong

Rows 12/13 (scenario 7). Question: *"forget the VFD and the encoder and the servo
— is this panel powered"*. Answer: *"Yes – the TP700 Comfort panel is powered from
a 24 V DC supply (max 0.85 A) as shown on its label [6]."*

- **"Yes"** asserts the panel is *currently* powered. Nothing available establishes
  that — a nameplate photo shows what it *rates*, not its state.
- **"as shown on its label"** attributes the figure to the panel's label while the
  citation resolves to a **SINAMICS drive document**.

Both are exactly what `wrong_family_grounding` (0.66/0.74) and `over_specificity`
(0.90/0.91) reported. I labelled them sound. I was wrong; Jev was right.

### The corrected matrix — and why it is weaker evidence, not stronger

Flipping two of fourteen labels **after seeing the signal is not blind**, and it is
precisely how a result gets manufactured. Both are reported:

| question | blind gap | post-hoc gap |
|---|---|---|
| over_specificity | +0.22 | **+0.45** |
| unsupported_numerics | +0.03 | **+0.41** |
| follows_evidence | −0.17 | **−0.37** |
| wrong_family_grounding | +0.01 | **+0.27** |
| regression_candidate | −0.01 | +0.19 |

The flip is defensible **from the answer text alone**, so a reader can check it
without trusting me. But it is post-hoc, n=14, and the labeller is the author.
**No threshold may be derived from either table.**

## 4. The one result that needs no labels

`wrong_family_grounding` tracks whether the answer **used** mismatched evidence,
not merely whether mismatched evidence was retrieved:

| | n | mean `wrong_family_grounding` |
|---|---|---|
| wrong-family chunks retrieved **and cited** | 5 | **0.43** |
| wrong-family chunks retrieved, **not cited** | 7 | **0.17** |

This is label-independent. It is the strongest evidence in this document that the
question measures a property of the *answer* rather than of the corpus — which
matters here because the SIEMENS OEM corpus is almost entirely drive documentation,
so nearly every turn retrieves wrong-family material and a good answer is one that
**declines to use it**.

## 5. What this changes about the earlier verdicts

| Use | was | now |
|---|---|---|
| `wrong_family_grounding` for #3966-class detection | ADOPT (shadow) | **ADOPT (shadow), with a correction**: the constructed +0.34 gap did **not** replicate blind (+0.01). It survives only under post-hoc labels and the cited/uncited split. Still the best signal available; no longer "11/11". |
| `over_specificity` | ADOPT (shadow) | **ADOPT (shadow)** — the only question with a gap under *both* labellings. |
| `failure_class` as investigation aid | ADOPT (shadow) | **DEFER** — 3 of 8 blind-sound turns classed `retrieval_mismatch`. Useful on a known-bad turn, not as a filter. |
| any production threshold | DEFER | **DEFER, more strongly** — the constructed fit was not merely in-sample, it was *unrepresentative*. |

## 6. Honest limits

1. **n = 14**, one notebook, one tenant, one photo pair.
2. **The labeller is the author**, and demonstrably fallible (rows 12/13).
3. **Scenario 4 drifted**: it specifies no photo, but prior-turn recall supplied
   the TP700 observation, so it was not the clean "ambiguous identity" case.
4. Jev remains **shadow**. Nothing here is read by the answer gate, the safety
   gate, the lifecycle ledger, or any release gate.

## Cross-references

- `docs/proofs/2026-09-23-jev-decision-fabric.md` — architecture + payload
- `docs/proofs/2026-09-23-jev-decision-privacy.md` — the export, before enabling
- `docs/proofs/2026-09-23-jev-decision-calibration.md` — the constructed states this supersedes
