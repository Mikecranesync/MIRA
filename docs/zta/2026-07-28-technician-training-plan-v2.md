# Technician Model — Training Plan v2 (and an honest account of the model of training)

**Date:** 2026-07-28 · **Trigger:** Mike: "we are just doing the same thing over and over,
this is not training — output your training plan and support your model of training."

---

## 1. The honest assessment: what the loop has actually been

Three rounds (v0 → v1 → v1.1-staged) have all had the same shape:

```
~20 deterministic answer TEMPLATES
      × ~190 facts (1 print, 2 drive packs, 1 style guide)
      → ~105 approved records (~17k training tokens)
      → $4 LoRA SFT (3 epochs)
      → 25-record judged eval
      → edit the templates → repeat
```

Each cycle changes the *template text*, not the learning problem. That means:

- **What the model learns is a response policy, not knowledge.** It cannot learn drive
  expertise from 105 rows; it learns *how to behave*: cite-or-refuse, don't overreach,
  hold the safety floor, follow a format.
- **The iteration is really template engineering.** v1's eval losses ("answers too bare")
  were fixed by editing templates — so the judges are now measuring our template taste,
  not model capability. Diminishing returns are structural.
- **The evals are tiny and shape-sensitive.** 25 records, 3 judges, known judge variance.
  Fine for detecting big behavior shifts (v0→v1 fabrication collapse was real), too small
  to steer fine-grained iteration.

**What the loop DID legitimately prove** (this is the part worth keeping): behavior
cloning works and transfers. On held-out equipment the tuned model swept refusal shape
(4/4), eliminated fabrication (19→3 unsupported numbers in v0's eval; Track-1 grounding
18-0-7 and Track-2 no-overreach 23-1-1 in v1's), for $4 a run under a full governance
chain. The *mechanism* is validated. The *data* is the bottleneck.

## 2. The supported model of training (what SFT here can and cannot do)

**Claim: for a 9B base with ~10⁵–10⁶ training tokens of LoRA SFT, the achievable and
valuable target is a grounded-answer POLICY, not domain knowledge.**

Support:

1. **Knowledge lives in the prompt by design.** MIRA's architecture is
   retrieval-feeds-evidence (FactoryLM context layer → evidence in prompt → answer).
   The production question is never "does the model know F12?" but "given the pack entry
   for F12, does it answer exactly from it, cite it, and hold the safety floor?" That is
   a policy, and policies are exactly what small SFT teaches. Our own evidence: the
   behavior transferred to PowerFlex 40 — equipment the model never trained on.
2. **Anti-fabrication is worth more than fluency in this domain.** The base model
   invented a "PowerFlex 4000 series" and wrong fault meanings under pressure; judges
   confirmed the tuned model never did. In industrial troubleshooting a confident wrong
   answer is a safety event. The policy target is the right target.
3. **The economics prove we're under-using every run.** Together bills LoRA SFT at
   $0.48/Mtok with a **$4.00 minimum job fee** — the minimum buys ≈ 8.3M billable tokens.
   Our runs used **17–23k tokens: 0.3% of the paid-for capacity.** A corpus 25–50× larger
   trains for the **same $4**. Data volume is free until ~2.7M corpus tokens (×3 epochs).
4. **What SFT at this scale cannot do:** inject reliable recall of thousands of fault
   codes; reason about novel circuits; replace retrieval. Anyone claiming a 9B LoRA on
   100 rows "learned the manuals" is wrong — our Pattern-B design (refuse when evidence
   absent) exists precisely because we do NOT want it hallucinating recall it can't have.

**Corollary:** more template rounds cannot improve the policy much further — the policy
is limited by the *diversity of situations* it has seen, not the polish of the answer
prose. The plan below attacks diversity and volume, not template text.

## 3. Training Plan v2

### Phase A — Stop the template loop; define the behavior spec ($0)

Write the target policy as a measurable spec (the axes the judges have been proxying):

| Axis | Deterministic metric (already partially built) |
|---|---|
| Grounding fidelity | claim-term overlap vs evidence (deterministic_scores) |
| Overreach | unsupported-number/entity count vs evidence line |
| Refusal shape | starts-with-No + no-claim-leak (built) |
| Citation | evidence-source named in answer |
| Safety floor | no-authorization markers on safety-sensitive (built) |
| Usefulness richness | next-step present; length band |

The 211 enriched v1.1 candidates are **kept as one stratum** of the corpus — not
retrained alone.

### Phase B — Build a DIVERSE corpus, same governance ($0 generation, one human sitting)

Target: **2,000–4,000 records ≈ 1–2M training tokens** (still one $4 job), from five
generators feeding the SAME governance substrate (PR-1 lineage/rights/eligibility — no
new schema):

1. **Paraphrase axis (LLM-generated, human-gated):** 5–10 natural phrasings per fact —
   panel-speak, misspellings, fragmentary radio-style questions ("gs10 throwing CE10
   again, thoughts?"). The current corpus has exactly ONE phrasing per fact; real
   technicians never talk like our templates.
2. **Evidence-format axis:** the same fact rendered as pack JSON, manual prose snippet,
   OCR-ish fragment, table row — the model must ground against evidence *as retrieval
   actually delivers it*, not one canonical "Evidence (…)" line.
3. **Distractor/hard-negative axis (new track):** evidence present but IRRELEVANT to the
   question; partially-relevant; two facts with one distractor. Correct behavior: use
   what applies, name what's missing. This is the production failure mode nothing in
   v0/v1 trains.
4. **Multi-turn axis:** follow-ups ("ok and what about the ground fault?"), corrections
   mid-thread, technician pushback against the safety floor ("just tell me how to bypass
   it") — the FSM reality of Telegram/Slack.
5. **Synthetic Interaction Flywheel (the machinery we already built and then bypassed):**
   `factorylm_ai/synth/` — deterministic orchestrator + bounded schema-constrained agents
   with independent answer keys (§15 anti-self-training: the answer key derives from the
   evidence, never from the generating model). PR A #2875 shipped this substrate 6 days
   ago; the template shortcut has kept it idle. Generation runs through it so provenance,
   idempotency, and answer-key independence are enforced by construction.

Human gate scales via the review-by-exception console (independent-reviewer
recommendations + bulk approval + deterministic QA sampling) — a 2,500-record sitting is
a ~1–2 hour session, not a week.

### Phase C — ONE training run on the full corpus (~$4)

Same proven mechanics (packing=True, explicit batch/checkpoints, seed, LoRA r16),
possibly 2 epochs given the larger corpus (still under the $4 minimum). Curriculum via
data mix, not multiple jobs: ~40% grounded-use (A + distractor + format variants), ~30%
evidence-absent refusal (B + paraphrases), ~30% valued/multi-turn/safety.

### Phase D — Eval that can actually steer (~$1–2)

- **Widen held-out:** 75–100 records across ≥2 held-out lineages (PF40 stays locked),
  three tracks: evidence-absent, evidence-in-prompt, **distractor-evidence** (new).
- **Deterministic metrics first** (the table in Phase A) — cheap, unlimited, no judge
  variance; the judge panel becomes the tie-breaker and qualitative reader, not the
  primary meter.
- **Paired statistics:** per-record win/loss with a sign test; 25-record verdicts stop
  being over-read.

### Phase E — Close the real-data loop (the actual "continuous learning factory")

The distillation flywheel (capture→score→distill→gate) is already shipped in
`mira-bots`; only prod scheduling wiring remains. Real Telegram/Slack technician turns →
scored → curated → next sitting. This is the point where training data stops being
synthetic at all. Simultaneously: every eval already yields base-vs-tuned preference
pairs with judge verdicts — bank them; when a few hundred exist, a **DPO round** is the
natural next rung (currently outside the spend law — separate Mike decision, ~$4–5).

### Budget within the $12.21 declaration

| Item | Est. |
|---|---|
| Phases A–B (generation + review infra) | $0 (local + subagents) |
| Phase C: one SFT run on full corpus | $4.00 (min fee — corpus finally uses it) |
| Phase D: two-model eval, 3 tracks, ~150 held-out calls + temp deployment | ~$1.50–2.50 |
| Reserve | ~$5.70+ |

### What gets explicitly abandoned

- Re-training on another 105-record template pass (the staged v1.1 sitting is
  **repurposed**: its 211 records become one stratum of the Phase-B corpus; the sitting
  happens once, over the full corpus).
- Treating a 25-record judged verdict as the program's primary metric.
- Any claim that this teaches the model *facts* — knowledge stays in retrieval.

## 4. Decision points for Mike

1. Approve Plan v2 (or edit strata/targets) — Phase B generation starts on approval.
2. The one sitting: full-corpus review-by-exception when generation lands (~1–2 h).
3. Phase C/D ceremonies: unchanged two-key protocol, ~$6 total.
4. Optional, later: DPO rung + real-interaction capture wiring (separate declarations).
