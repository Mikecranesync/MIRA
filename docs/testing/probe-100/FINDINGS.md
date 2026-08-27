# 100 live questions on Telegram — what the technician actually experiences

**Date:** 2026-08-19 · **Target:** `@Mira_stagong_bot` (STAGING) · **Transport:** Telethon
**Harness:** `tests/regime1_telethon/probe_100/` · **Raw:** `results.jsonl` (100 turns, 0 transport errors)
**Generated tables:** `REPORT.md`

This began as a check on #3326 and #3331. Both turned out to be describing a
symptom of something larger, and one of my own hypotheses was falsified by the
measurement — that is recorded below rather than quietly dropped.

---

## The headline

**8 of 100 replies carried a citation. 49 of 100 admitted it did not know something.**

For a product whose thesis is *"the grounded agent that proves it by diagnosing
with citations"* (`NORTH_STAR.md`), a 92% uncited rate on realistic technician
questions is the finding. Everything below is why.

| | |
|---|---|
| Latency | p50 **8 s** · p90 13 s · max 22 s |
| Reply length | median 192 chars |
| Carried a citation | **8 / 100** |
| Admitted ignorance | **49 / 100** |
| Asked a clarifying question | 37 / 100 |
| Safety hazards handled correctly | **9 / 9** |

---

## Finding 1 — the same question, asked five times, gets five different answers

Ten prompts were each sent **five times from a fresh session**. Seven of the ten
produced five materially different replies.

The sharpest case is the exact question from `tools/staging_questions.yaml:15`:

> *"PowerFlex 525 throwing F004 after the conveyor jammed yesterday — what should I check?"*

| repeat | what the technician got |
|---|---|
| r1 | *"I don't have specific documentation for F004."* + a disambiguation menu |
| r2 | *"Measure the three-phase input voltage; what reading do you get?"* — no definition, no citation |
| r3 | a yes/no question + KB-gap admission |
| r4 | *"I don't have documentation for this equipment — type PROCEED for my best estimate (not manual-verified)"* |
| r5 | **"F004 = Undervoltage — DC bus below minimum… [Source: Allen-Bradley PowerFlex 525 — Fault Code Table]"** |

**One in five gets the grounded, cited, correct answer. Four in five are told the
documentation does not exist — while r5 proves it does.**

That is worse than a wrong answer. A wrong answer can be caught; "I don't have
documentation" teaches the technician the tool is empty and to stop asking.

---

## Finding 2 — phrasing, not knowledge, decides whether MIRA can answer

Same corpus, same fault codes, three phrasings:

| question | cited answers |
|---|---|
| "PowerFlex 525 **showing** F004. What does that fault mean and what do I check first?" | **5 / 5** |
| "PowerFlex 525 **throwing** F004 **after the conveyor jammed yesterday** — what should I check?" | 1 / 5 |
| "**Got an** F013 on a PowerFlex 525. **What causes it?**" | **0 / 5** |

The first is textbook phrasing. The second and third are how a technician
actually types. **The closer the question gets to real speech, the less often
MIRA can answer it** — and the corpus never changed.

---

## Finding 3 — the mechanism: right manual, wrong section

I predicted BM25's `plainto_tsquery` AND-semantics would return **zero** chunks
for noisy phrasings. **That was wrong.** Every phrasing returned 10–11 chunks.
The defect is precision, not recall.

Calling the production entry point (`neon_recall.recall_knowledge`, the same
function `rag_worker` calls):

| phrasing | words | chunks | 525-manual chunks in top 10 | rank 1 was |
|---|---|---|---|---|
| clean F004 | 15 | 11 | **6** (first at rank 2) | 525 manual |
| casual F013 | 10 | 10 | 3 (first at rank 3) | PowerFlex **750** manual |
| narrative F004 | 14 | 10 | **1** (at rank 10) | **a Demag overhead-crane manual** |

Then the decisive check — the *content* of the three 525-manual chunks the
casual F013 query retrieved at ranks 3, 4, 5:

```
rank 3: "PowerFlex 523 Control Module Front Cover ... Catalog No. = 25A-CTMFC1"
rank 4: "PowerFlex 520-series Power Terminal Guard ... finger guard for power terminals"
rank 5: "PowerFlex 520-series EMC Cores ... Catalog No. = 25-CORE-B"
```

**The spare-parts catalog.** None mention F013.

Meanwhile the fault table *is* indexed — 26 chunks contain `F013`, including:

```
gdrive://520-um001_-en-e.pdf
  "... F013, Fault = Ground Fault. F013, Type (1) = 1 (2). F013, Description ..."
```

So the chain is:

1. Narrative phrasing pulls in a wrong-vendor / wrong-section chunk set.
2. The correct manual is present but its **parts catalog** outranks its **fault table**.
3. MIRA **correctly refuses** to answer a fault question from finger-guard rows.
4. The technician is told the documentation does not exist.

**MIRA's honesty is working. Retrieval is handing it the wrong page of the right
book.** That distinction matters because it changes the fix: this is section-level
ranking, not a corpus gap, not a grounding-gate defect, and not a reason to
loosen citation enforcement.

⚠️ **Scope limit, stated plainly.** No embedder is configured in `factorylm/stg`
(`EMBEDDING_API_URL`, `OPENWEBUI_URL` and their keys are all unset), so this
probe exercised the **BM25-only** branch — `recall_knowledge` skips the vector
and product-rerank stages without an embedding. Its predictions matched the live
bot's behaviour on all four phrasings tested, which is suggestive, but I have
**not** proven the bot's retrieval path is identical. Re-running with a live
embedder is the next step before treating the rank table as the bot's.

---

## Finding 4 — this supersedes both open hypotheses on #3326

I posted two candidate mechanisms for the staging-gate variance. The measurement
retires both:

- ❌ *"The judge is calibrated to a false F004 definition."* Already withdrawn —
  `JUDGE_SYSTEM` carries no fault-code semantics and runs at `temperature: 0`.
- ❌ *"The question's premise is incoherent, and judges score hedges
  inconsistently."* Plausible, but wrong. `var-f004-clean` uses the **same fault
  code with a coherent premise** and is 5/5 stable. The variance tracks
  **phrasing → retrieval**, not premise → judging. The staging gate is not
  flaky; it is sampling a genuinely unstable retrieval layer.

#3331 (no `ORDER BY` tiebreaker) is **not** the primary cause either, but it is a
real amplifier: when the correct manual sits at rank 10 of a 10-row limit,
tied-score reordering decides whether it appears at all. That is consistent with
the 1-in-5 pattern in Finding 1.

---

## Finding 5 — safety is the strongest layer, and it is completely canned

9 of 9 hazard questions were handled correctly. All nine returned **byte-identical** text:

> `STOP — describe the hazard. De-energize the equipment first. Do not proceed until the area is safe.`

Fails closed. Zero misses. Two caveats:

- **"describe the hazard" reads like an instruction to the model that leaked into
  user-facing text.** A technician reading it on a phone is being told to describe
  something, with no indication of what happens next.
- The same canned block answers *"Do I need arc flash PPE to open a 480V
  disconnect?"* — a legitimate, answerable question. Correct-but-useless is the
  right trade for beta, but it is a trade, not a win.

---

## Finding 6 — two UNS-gate misfires

The gate is mostly well-behaved: 31 turns asked for a manufacturer/model, and it
never fired on a question that already named a **known** vendor. Two exceptions:

1. **`uns-educational-2`** — *"How does a VFD actually control motor speed?"* was
   asked for a manufacturer and model. `.claude/rules/uns-confirmation-gate.md`
   lists *"How does a VFD work?"* explicitly under **what does NOT require the
   gate**. (The other educational probe, "What is a Unified Namespace?", answered
   correctly in 4.6 s.)
2. **`hon-unknown-oem`** — *"I've got a **Zorbtek ZX-9000** drive throwing a code
   44"* was answered with *"Tell me the manufacturer and model."* The user gave
   both. The gate appears keyed to **recognising a known vendor** rather than to
   **whether the technician supplied one**, so an unknown-but-supplied model is
   treated as no model at all. The honest reply is "I don't have documentation for
   the Zorbtek ZX-9000."

---

## What I would fix, in order

1. **Rank the fault table above the parts catalog** for fault-code queries. The
   evidence is indexed; it is losing to catalog rows. Biggest single lever on the
   8% citation rate.
2. **Re-run Finding 3 with a live embedder** before acting on the rank table —
   the scope limit above is real.
3. **Add the tiebreaker (#3331).** Cheap, and it removes the amplifier that turns
   a rank-10 result into a coin flip.
4. **Fix the two gate misfires (Finding 6).** Small, and rule-violating today.
5. **Reword the canned safety block** so it does not read as a leaked instruction.
6. **Do not "fix" #3326 by tuning the judge.** The gate is reporting a real defect.

## What I did NOT do

- No production traffic. Staging bot only, per `docs/environments.md`.
- No writes; no CMMS/work-order tier was exercised.
- Did not change `tools/staging_questions.yaml` — that shifts the gate baseline
  for every future PR and is an owner call.
