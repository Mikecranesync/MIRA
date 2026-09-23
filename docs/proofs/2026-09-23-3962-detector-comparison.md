# #3962 — two detectors measured against labelled live turns

**Staging SHA:** `a83cb617c…` · 2026-09-23 · 8 labelled pairs · artifact `/tmp/exp-3962-final.json`
**Harness:** `tools/qa/exp_3962_consistency.py`

## Result

| detector | recall on divergence | false-positive rate | cost | notes |
|---|---|---|---|---|
| **Deterministic** (`assessEvidenceFollowed`, shipped in #3964) | **0 / 5 = 0.00** | 0 / 3 = 0.00 | free, 0 ms | caught nothing |
| **Jev** (`noul`, threshold 0.30) | **5 / 5 = 1.00** | 1 / 3 = 0.333 | $0.000029/call | over-sensitive at 0.30 |
| **Jev** (threshold 0.10–0.12) | **5 / 5 = 1.00** | **0 / 3 = 0.00** | same | separates this sample cleanly |

```
DIVERGES noul: 0.04 0.05 0.06 0.06 0.06      max = 0.06
FOLLOWS  noul: 0.16 0.31 0.47                min = 0.16     gap 0.10
```

## The deterministic detector does not work, and here is exactly why

All five divergent answers led with *"the most common cause is a loose or worn
drive coupling"* and mentioned **"bearing" once**, in a list beneath it. The
shipped rule fires only when the answer's equipment classes are **disjoint** from
the evidence's — so a single passing mention put `bearing` in both sets and the
turn was called `consistent`.

That clause was a deliberate conservatism ("an answer that mentions the evidence's
class at all, among others, is not the failure being detected"). Measured against
real traffic it is the thing that breaks it: #3962 is about what an answer is
**about**, and token presence is not aboutness.

**0.00 recall with 0.00 false positives is not a safe detector — it is an absent
one.** The code now says so where it is defined, so a `consistent` verdict is not
mistaken for evidence.

## Ground truth, and a rule I changed mid-experiment

First rule: count bearing-terms vs other-terms across the whole answer. It
returned **AMBIGUOUS for 4 of 5** obviously-divergent cases, for the same reason
the detector failed — one "bearing" deep in a list.

Second rule, used for the numbers above: read the **lead** (first 220 chars) and
take whichever subject appears first. Every pair's lead is printed in the run
output so the labelling can be checked.

Changing a labelling rule mid-experiment deserves suspicion, so: the change was
made **before** Jev's scores were compared against it, it moved cases out of
AMBIGUOUS in both directions, and the three FOLLOWS controls were generated
independently (same photo, `history` supplied — the condition already shown to
produce correct answers). The rule is stated, not implied.

## What this does NOT establish

- **8 pairs is not a calibration set.** A threshold chosen where 0.06 and 0.16 sit
  is a threshold fitted to eight points. The *separation* is the finding; the
  number is not.
- **The obvious redesign cannot be scored here.** A lead-subject deterministic
  rule is the natural fix — but the lead is exactly what defines the ground-truth
  label, so scoring it on these pairs would be circular by construction. It needs
  a fresh sample with independent labels.
- **One photo, one question, one provider.** Generalisation unmeasured.

## Jev decision for this question: ADOPT for shadow — still blocked

Measured benefit is real and large: 5/5 versus 0/5 on live failures, with clean
separation. Cost is $0.000029 per call over this sample. It is the only signal
that caught the defect this issue was filed about.

**The blocker has not moved:** the judge needs the ANSWER text, and the shipped
shadow deliberately sends only the question plus scrubbed chunk excerpts. Sending
answers is a **new third-party content export** and needs approval.

**Integration shape, if approved.** The existing shadow call is started at
`chat/route.ts:2205` — *before* generation — and awaited at 2716, so it costs no
latency today and **cannot see the answer**. A consistency judge therefore needs a
second, post-generation call. The good news is where it lands: the answer has
already streamed to the technician by then, so the call would add latency to the
persist path, not to anything a human waits on. Smallest integration point, reusing
the existing module: one more question, one more call, after generation, shadow-only.
