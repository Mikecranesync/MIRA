# Fabricated parameter + correctly-attributed citation passes every guard

**Date:** 2026-08-09
**Status:** DIAGNOSED — not fixed. Fix design below, deliberately unshipped (see §6).
**Found via:** campaign c6/c7 `t2_005_pivot_after_fault`, turn 2, live on staging.
**Severity:** P0-class grounding hole. MIRA asserted a parameter that does not exist
and attached a citation that passed every existing check.

## 1. The reply

Staging, `qc/cold-start-baseline@b306a6b9b`, after MIRA had just explained F004:

> **tech:** How do I reset it?
> **MIRA:** To reset digital output on Rockwell Automation 525, set **P0594 = 1**
> `[Source: Allen-Bradley PowerFlex 525, Parameter Reference]`

Two independent failures in one sentence: it answers about a **digital output** when
the technician means the **F004 UnderVoltage fault**, and it invents **P0594**.

## 2. P0594 does not exist — verified, not assumed

Read-only against staging `knowledge_entries`:

| probe | rows |
|---|---|
| `P0594` | **0** |
| `P 0594` | **0** |
| `A0594` | **0** |
| `P594` | 4 — but **PowerMonitor 5000** only, `[Ramped Spd Ref]`; different product, unrelated to reset |
| `0594` | 4 — AutomationDirect GS30/GS10 hex-address fragments; unrelated |

The cited document class is fabricated too: the `source_type` values present for
PowerFlex 525 are `equipment_manual`, `gdrive`, `manual`. There is no
"Parameter Reference".

## 3. The correct answer IS in the corpus, and is embedded

Not a coverage gap: **7,592** PF525 rows, **0** with a NULL embedding.

- p160 — "After corrective action has been taken, clear the fault by one of these
  methods. • Press Stop if P045 [Stop Mode]…"
- p164 / p726 — "Clear fault. • Press Stop if P045 [Stop Mode] is set to a value
  between '0' and '3'. • Cycle drive power."
- p1108 — "[Fault Clear] … Resets a fault and clears the fault queue. 1 'Reset Fault'"
- p1251 — "Press Esc to acknowledge the fault."

So: **content present, embedded, and not retrieved** — then fabricated over.

## 4. Why every guard passed

Raw `recall_knowledge` on the **production** query (no harness), per
`.claude/skills/retrieval-diagnostics`:

```
query: "Rockwell Automation PowerFlex 525 F004 How do I reset it?"
  rank 0  PF525 p137   product,vector   "…'Home Reset' … Position resets to zero on power-up"
  rank 1  PF525 p458   product,vector   "…method of resetting fault F111 'Safety Hardware'…"
  rank 2  PF525 p129   product,vector   "…DC current … to reset the rotor position"
  → fault-reset chunks (p160/p164/p726/p1108): ABSENT from the top 10
```

Then, layer by layer:

1. **Retrieval** returns PF525 chunks whose "reset" sense is *position/rotor/safety
   hardware*, not *fault clear*. The right chunks never surface.
2. **`_is_grounded`** (`engine.py`) measures a **bag-of-words overlap ≥ 5** against the
   source text. "reset / output / powerflex / 525 / digital" clears that bar, so an
   invented **specific** rides through on generic prose overlap.
3. **`evaluate_citation_relevance`** (`citation_compliance.py`) validates **who a tag
   attributes to** — vendor conflict, or an unestablished vendor. The tag says
   Allen-Bradley and the resolved vendor *is* Allen-Bradley, so it is "relevant".
   Nothing checks whether the cited document was retrieved this turn, or whether it
   supports the claim.

**The hole, in one line: grounding is scored on generic word overlap and citations are
scored on attribution, so a fabricated specific with a correctly-attributed tag is
invisible to both.**

## 5. Falsified hypothesis (recorded on purpose)

The pre-registered hypothesis was that `_prepend_equipment_context` carries the fault
CODE but not the fault NAME, so adding "UnderVoltage" would surface the reset chunks.
**Measured and false** — the raw recall for
`"… PowerFlex 525 F004 UnderVoltage How do I reset it?"` is essentially identical to
the code-only query, GOOD ranks NONE in both. The natural experiment that suggested it
(`t1_004` answering correctly) turns out to be weaker evidence than it looked: at
rank 6 its only "GOOD" chunk was a **Siemens** row, so that reply was not well
grounded either — it was plausible, not sourced.

This is why the skill's one rule is to run the production path raw before speccing.

## 6. Fix design — and why it is not shipped here

Two separable changes:

**A. Specific-claim grounding (the real fix).** A parameter-shaped token asserted in a
reply (`P045`, `A551`, `t071`, `b007`, `P09.03`) must appear in this turn's retrieved
source text, the user's message, or the conversation history. If it appears in none,
the reply is not grounded — route it through the existing correction retry / gap
admission rather than stripping mid-sentence. Fault codes (`F###`) are excluded: they
legitimately arrive from `uns_context`.

**B. Retrieval sense-disambiguation.** "reset" is polysemous in a drive manual
(fault clear vs position reset vs defaults reset). The fault-clear chunks exist and are
embedded; they simply lose to product-stream neighbours.

**Not shipped in this session, deliberately.** A grounding guard that false-positives
suppresses *correct* answers in production, and this arc's own record is that **every
gate produced a false positive on first contact with real data**. The honest sequence
is: build A red-first, run it over the frozen campaign transcripts *with* their
retrieved-source snapshots to measure the false-positive rate, then `bot-grounding-tests`,
then the staging gate. The ledgers currently store replies but **not** the per-turn
source snapshot, so that validation needs the runner to record sources first.

## 7. Reproduce

```bash
doppler run -p factorylm -c stg -- py -3 <scratch>/diag_recall.py       # raw recall, 3 variants
doppler run -p factorylm -c stg -- py -3 <scratch>/diag_corpus.py       # content + embedding coverage
doppler run -p factorylm -c stg -- py -3 <scratch>/diag_fabrication.py  # P0594 absence, all spellings
```

## Cross-references

- `.claude/skills/retrieval-diagnostics/SKILL.md` — the raw-production-path rule this followed
- `mira-bots/shared/engine.py::_is_grounded` — the word-overlap check (layer 2)
- `mira-bots/shared/citation_compliance.py::evaluate_citation_relevance` — attribution-only (layer 3)
- `.claude/rules/fast-path-optimization.md` — "citation-or-refuse", the contract violated here
- `docs/testing/campaign-reports/2026-08-09-c7.md` — the run this came from
