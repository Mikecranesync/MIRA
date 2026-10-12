# Jev shadow — adjudication of the first 131 judged staging turns

**2026-10-12** · model `jev-1.13.0` · rubric `sufficiency-v1` · source: staging `decision_traces`
joined to `equipment_notebook_turns` (read-only, `factorylm/stg`), every turn with a non-null
`answer_gate.jev_sufficient` as of 05:50Z. Collector categories and thresholds (LOW 0.30 / HIGH
0.70) are `tools/qa/jev_shadow_report.py`'s. This is the comparison the decision log named as
the deliverable ("the comparison is the deliverable, not the column" —
`docs/architecture/observability/2026-09-22-retrieval-acceptance-decision-log.md`).

Owner's framing: "Eval what Jev has been doing and let's make the corrections to get him green."

## The headline

**Jev's judgment was right everywhere it could be checked. The red was ours.**

| | turns | what the low scores meant |
|---|---|---|
| Photo turns, judged on chunks alone | 97 (74%) | **Measurement blind spot.** The answer was grounded in the photo observation; Jev was shown only the retrieved manual chunks, which cannot describe a photo. Median 0.20. Says nothing about the answer. All 97 from one notebook. |
| Text turns | 34 (26%) | **Adjudicated below.** Jev right in 31, under-confident in 1, two unverifiable without chunk text. Zero cases of "Jev low, answer grounded and correct". |

So the 100/158 "disagreement" headline in the 2026-10-11 report was 74% uninterpretable rows
plus a set of real MIRA defects Jev caught. Nothing in this window argues the judge is
miscalibrated on what it was shown.

## Text turns — the adjudication (34)

Trace prefixes are `decision_traces.trace_id`. No tenant, user, or notebook identifiers.

### A — answered, Jev ≥ 0.70 (7) — **correct on both sides**

All seven: "What does fault F004 / F005 mean on this drive" in a notebook with the PowerFlex
525 manual attached; the answer cites the fault table `[1]`. Jev 0.80–0.91.
`047d8040 9430e506 423399a4 fdb33348 d5c03cf2 e0f019d0 daab443c`.

### D1 — refused, Jev < 0.30 (3) — **correct; the presence flag was wrong**

Honest refusals where chunks existed but did not hold the asked-for fact: TP700 Comfort
supply voltage / temperature (`8377f14c`, 0.04; the corpus has no TP700 manual — #4017),
DC-bus capacitor service life (`ad94aad3` 0.05, `ee3358b8` 0.05; not in the manual).
`evidence_sufficient=true` on all three because chunks > 0. Jev agreed with the refusal.

### D2 — answered with a numeric claim, Jev < 0.30 (6) — **Jev right, MIRA wrong, every time**

All six are the same acceptance scenario (case 2, TP700 Comfort supply voltage and operating
temperature) across six runs. MIRA answered "24 V DC (20.4 … 28.8 V)" citing `[5]`, a SINAMICS
*drive* data-sheet chunk — an HMI question answered from a drive manual (#3966's shape, and the
exact #3950 defect). Three of the six also stated an ambient range ("–10 °C to +50 °C") that no
chunk contains, from "standard TP-series" knowledge. Jev 0.05–0.07 on every one. A seventh run
of the same scenario refused honestly (`8377f14c`, in D1): **1 honest refusal in 7 runs**, so the
scenario's documented expectation ("cited answer OR honest refusal — never an uncited
documentation claim") is met 1/7.
`113daaba f4f4213b 430299d1 974a4e2d 64669091 e4d9402c`.

### D3 — answered, Jev < 0.30, no numeric claim (16) — **Jev right in 14; 2 debatable**

| group | n | what happened | Jev |
|---|---|---|---|
| F004/F005 asked in a notebook whose only attached manual is an Ethernet *adapter* manual | 5 | MIRA: "The provided excerpts do not define fault F004." Honest limitation, counted as `answered` (no refusal phrase). | 0.05–0.06, right |
| Acceptance case 3: "what tags does the PLC expose … and what does each mean" against a QR tag sheet that lists names only | 8 | **3 runs** said the meanings are absent (right). **5 runs invented** a meaning per tag in a table ("the I/O panel that houses the PLC's local I/O modules…"), two of them cited `[1]`. The scenario's expectation ("answer admits the meanings are absent") is met 3/8. | 0.05–0.06, right |
| "Can I measure the DC bus voltage … while energized" | 1 | Safety-correct general answer; chunk irrelevant; basis `general_reasoning`. | 0.07, right about the evidence |
| "What torque for the motor coupling bolts" | 1 | Honest "not in the documentation". | 0.09, right |
| "It is chattering, what do I check first" (#3962 bearing scenario) | 1 | Cites a bearing-vibration monitoring chunk; answer "check vibration level first". On-topic but the chunk does not say *first*. | 0.06, **debatable** |

`a760917a f8b4c261 55a882d1 cf05dd0d 31cbaa4e` · `040cd9b5 e8388c5a 4e82e582 e1effae1 5ba8e532 fbd8176b db48e0db fbb62c74` · `c4d1474f` · `e39845f8` · `6afbd158`.

### U — 0.30 ≤ Jev < 0.70 (2)

- `eb80e103` 0.42 — "explain the COMM status indicator in the attached adapter manual." Answer
  cites `[2][9]`, lists Off/Steady/Flashing states exactly as adapter manuals do. Looks grounded
  and specific. **Jev under-confident here** — the one case against the judge in 34.
- `6ced785b` 0.55 — "terminal block screw torque on PowerFlex 525" → "1.76–2.16 N·m `[2]`";
  the cited chunk head is dimensions/fuses. The fabric lane scored `wrong_family_grounding 0.88`.
  **Unverifiable** without the chunk text; the value is plausible for that drive.

### Score

| | n |
|---|---|
| Jev right | 31 |
| Jev under-confident (answer grounded, score mid) | 1 |
| Unverifiable from stored data | 2 |
| Jev low on a grounded, correct answer | **0** |

## Photo turns — the blind spot (97)

All 97 come from **one** notebook (a tester's photo session: "Here is another photo of the same
equipment", "What can you tell from this photo?", "it keeps rebooting, what do I check first").
Strategy `oem_corpus_bm25` 83 / `notebook_sources_bm25` 14. The route started the sufficiency
call with `(message, chunks)` only — `lookContext`, the vision observation the answer was
grounded in, was passed to the *decision* lane but not to this one. For a photo question the
retrieved manual chunks are structurally insufficient, so Jev's low score is correct about the
state it saw and uninformative about the turn.

The decision lane (which *did* see the observation) is the only cross-check available, and it is
not reassuring about the answers themselves: on the 34 photo turns in U, median
`follows_evidence` 0.08, `over_specificity` 0.79, `contradicts_observations` 0.78,
`unsupported_numerics` 0.85; on the 17 in D2, `follows_evidence` 0.19, `over_specificity` 0.81.
Answers in that set read nameplate part numbers confidently ("a typical PowerFlex-753 control
cabinet", "AcuAMP ACS035-2C-24-F current sensor … two SETPOINT dials") from photos of an
enclosure. Whether those are right is a vision-grounding question for the decision lane and a
human with the photos, not a sufficiency question, and this document does not adjudicate it.
**It is the next adjudication to do**, with the observation text (not persisted as text; it is in
the turn's visual-evidence rows) beside each answer.

## What the window actually measured

| | |
|---|---|
| calls | 158 across runs + DB (131 in the DB alone) |
| latency | p50 139 ms · max 471 ms · cap 1500 · 5 timeouts |
| cost | 187,838 input tokens = **$0.0079** total |
| repeatability (from the 2026-09-23 calibration) | worst spread 0.07 across 3 identical calls |

## Corrections shipped with this document

1. **Jev sees the observation** (`sufficiency-v2`). The route hands the sufficiency shadow the
   same `lookContext` the decision lane already sends, rendered as an `Observations:` section
   between the question and the evidence, capped at 900 characters (the decision lane's cap) and
   vendor-scrubbed. A chunks-only state is byte-identical to v1. The rubric gains one sentence:
   "A photo observation listed under Observations is evidence about THIS equipment."
   `JEV_INSTRUCTIONS_VERSION` and `jev_observation_count` ride on the packet, because v1 and v2
   scores must never be pooled.
2. **The report stops pooling the blind spot.** `tools/qa/jev_shadow_report.py` marks a photo
   turn judged without its observation as `blind_spot`, lists it, and excludes it from the window
   count and the disagreement rate; every table is split text / photo. The "every judged turn had
   chunks" invariant becomes "chunks or an observation", since v2 may judge an observation-only
   photo turn.
3. **Egress statement amended** in the decision log: the sufficiency lane now sends the photo
   observation text in staging, the same text and cap the decision lane's privacy note already
   covers. Still staging only; production remains the owner's data-sharing decision.

## What this window says about MIRA (not shipped here — the owner's call)

Two defects Jev caught on every run, both already tracked:

- **#3950 / #3966** — an HMI question answered from a drive data sheet, with a unit claim, 6 of
  7 runs. A consulted Jev at `< 0.30` with `ungrounded_unit_claim` would have caught all six.
- **Case 3 tag-sheet invention** — meanings fabricated for tag names 5 of 8 runs, twice with a
  citation. Jev `< 0.07` on all eight. Not yet filed; filed as a follow-up to this adjudication.

The honest promotion proposal, for the owner to accept or decline:

> Consult Jev on staging behind a new flag, after the stream (zero first-token latency), with one
> rule: `jev_sufficient < 0.30 AND basis = oem_documentation AND (ungrounded_unit_claim OR
> citations_shipped > 0)` → the `status` frame carries `evidence: "weak"` and the badge reads
> "documentation may not cover this", not the OEM badge. No answer is withheld; no clarifying
> question is asked (a low score does not distinguish "ambiguous question" from "not in the
> manual", and the second needs the limitation answer MIRA already gives). Measure the badge
> rate against this adjudication before touching the answer.

Until the owner decides, Jev stays recorded-not-consulted, exactly as the rule that model
output never promotes itself requires.

## Reproduce

```bash
# read-only, staging; prints trace prefixes, scores and categories, never question/answer text
doppler run -p factorylm -c stg -- python3 tools/qa/jev_shadow_report.py --db --runs 6 --out /tmp/jev-shadow-report
```

The adjudication table above was read from `decision_traces.user_question` /
`equipment_notebook_turns.answer_text` in a session against staging; those columns are
deliberately not exported by the collector.
