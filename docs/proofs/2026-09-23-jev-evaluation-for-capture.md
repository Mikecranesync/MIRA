# Jev (TypeSafe System One) — adopt / defer / reject, per capture improvement

**Date:** 2026-09-23 · **Branch:** `feat/turn-capture-lifecycle` (#3964)
**Required by #3939:** *"For EVERY improvement, evaluate Jev's actual APIs/integration.
Record adopt/defer/reject with measured benefit, cost, latency and privacy impact."*

Measured, not estimated. Source: `tools/qa/jev_shadow_report.py --db` against staging
`decision_traces`, 2026-09-23.

## What Jev actually is, as integrated

`POST https://api.typesafe.ai/v1/systemone`, model pinned `jev-1.13.0`, one call after
retrieval, returns `noul` — a calibrated probability that the retrieved evidence suffices.
Shadow-only: recorded on the packet, never consulted (`mira-hub/src/capabilities/observability/jev-shadow.ts`).

## Measured baseline (staging, 2026-09-23)

| | |
|---|---|
| judged turns | **19** (target window 50–100 — **under-powered, stated**) |
| latency | **p50 156 ms · max 294 ms** (cap 1500, zero timeouts) |
| cost | **$0.000048/call** — 21 683 input tokens over 19 calls = $0.000911 total |
| privacy | question + capped chunk excerpts leave the tenant; IP/MAC/serial scrubbed; no cookies, ids, tenant identifiers or answer text |
| **agreement** | **A = 0.** Jev judged LOW on **19 of 19** turns. |

**The agreement number is the finding.** A judge that returns "insufficient" on every
sampled turn carries no discriminative information on that sample, whatever its
calibration elsewhere. It is not yet possible to tell "Jev is right and MIRA's
presence-based `evidence_sufficient` is wrong nearly always" from "Jev is systematically
pessimistic on this corpus" — and those have opposite consequences. That question needs
the 50–100 turn window and human adjudication of D2/D3, not more confidence.

## Decisions

| improvement | decision | why, measured |
|---|---|---|
| **Attempt lifecycle** (start record, terminal outcome, `abandoned`) | **REJECT** | Nothing probabilistic here. "Did this turn finish" is a fact with a row or no row. A model in this path could only add failure modes to the thing that measures failure. |
| **Ingress reconciliation** (093, lost starts, mirror query) | **REJECT** | Same. Counting is counting. A judgment cannot tell you a row is missing. |
| **Stale-turn reconciler** | **REJECT** | A clock and a `NOT EXISTS`. |
| **`DOCUMENTS_IN_CONTEXT_UNCITED`** (#3962, document case) | **REJECT — deterministic wins outright** | The check is `chunk_count > 0 ∧ answered ∧ citations_shipped = 0`: free, 0 ms, no vendor, no version drift, no privacy surface. Jev would cost 156 ms and $0.000048 to answer a **different** question (is the evidence sufficient) than the one asked (did the answer use it). Note the report's D3 rows — `notebook_sources_bm25 · chunks=1 · answered · jev=0.06` — are plausibly this same defect, which Jev flagged as *insufficient evidence* rather than *evidence ignored*. Right neighbourhood, wrong question. |
| **`ANSWER_IGNORED_VISUAL_EVIDENCE`** (#3962, photo case) | **ADOPT-CANDIDATE for shadow — measured 2026-09-23, upgraded from DEFER** | This is the one improvement where a semantic judge is the natural instrument: "does this answer engage with this observation" is exactly the shape Jev is built for, and my closed equipment-class vocabulary is the fragile part of this PR. But promoting it needs (a) the 50–100 turn window, (b) a **shadow** comparison against the deterministic assessment on the same turns, and (c) a privacy decision — it would mean sending the **answer text**, which the current integration explicitly never does. Deferred, with those three conditions written down. |
| **#3963 fire rate** | **REJECT** | Regex vs regex, measured 57.5% → 20.0%. Nothing to judge. |
| **Release / acceptance gating** | **REJECT — and this one is a rule, not a trade-off** | #3939: *"Do not replace deterministic safety, authorization or release gates with probabilistic judgments."* With A = 0 measured, wiring Jev into the acceptance gate today would fail every scenario. |

## The one thing Jev has already earned

Jev is the **only** signal in the system that distinguishes "six chunks came back" from
"six chunks that answer the question". MIRA's `evidence_sufficient` is a presence test —
`chunks > 0` — and the D2 bucket (13 turns: answered, `ungrounded_unit_claim`, jev < 0.30)
is the population most likely to contain real ungrounded claims. That is worth continuing
to collect, in shadow, exactly as it is.

Keep `MIRA_JEV_SHADOW=1` on staging. Do not consult it. Re-run this report at 50 judged
turns and adjudicate D2 by hand before any promotion conversation.

## Shadow-test discipline honoured

Everything above is from recorded shadow output on real staging traffic. No traffic was
fabricated to fill the window, and the under-powered sample is reported as under-powered
rather than rounded up into a conclusion.

## Measured: Jev as an evidence-vs-answer judge (2026-09-23)

The DEFER above was written with no measurement. There is one now, and it changes
the recommendation.

Asked *"Does the ANSWER address the specific equipment described in the
OBSERVATION?"* over the #3962 shapes — three repeats each:

| input | `noul` | mean |
|---|---|---|
| bearing-label observation + the **drive** answer (the actual failure) | 0.05 · 0.06 · 0.05 | **0.053** |
| bearing-label observation + a correct **bearing** answer | 0.71 · 0.71 · 0.71 | **0.710** |
| bearing-label observation + a generic clarification request | 0.10 | — |

**Separation 0.657, and stable** — the correct answer scored 0.71 three times
identically. Latency p50 **216 ms**, max 377 ms. Cost **$0.000120 for 7 calls**
(~$0.000017 each, 2 866 input tokens).

Compare the deterministic detector shipped in #3964: it caught **1 of 3** live
reproductions, because it depends on the vision prose naming an equipment class
and the label is truncated at "Bea…". Jev separated **3 of 3** without needing the
word *bearing* to appear at all.

### The contrast worth keeping

Jev is **weak at the question it is currently wired to** and **strong at a
different one**:

| question asked of Jev | result on our data |
|---|---|
| "is the retrieved evidence sufficient?" (shipped shadow) | 19/19 disagreements, **zero** agreements — no discriminative power on that sample |
| "does this answer address this observation?" (this test) | clean 0.053 vs 0.710 separation |

That is not a contradiction; they are different questions. Sufficiency requires
judging whether chunks *contain* an answer, which needs domain grounding Jev does
not have. Consistency only requires judging whether two texts are about the same
thing — which is exactly what a general judge is good at.

### Conditions before this ships (none of them are optional)

1. **It requires exporting ANSWER TEXT to a third party.** The shipped shadow
   sends the question plus scrubbed chunk excerpts and deliberately never sends
   the answer. This is therefore a **new third-party content export** and #3939
   forbids one without separate approval. **This evaluation used only strings
   already published in issue #3962 plus output from a staging test tenant I
   provisioned myself — no customer content left the tenant.**
2. **Shadow only.** Recorded beside the deterministic assessment, never consulted
   by a gate — a probabilistic judge must not become a release or safety control.
3. **A threshold needs a real sample.** Seven calls on one photo establish that the
   signal exists, not where to cut. 0.71 for a *correct* answer is also not a high
   score in absolute terms; what separates here is the gap, not the level.

**Decision: ADOPT-CANDIDATE, blocked on (1).** Worth Mike's approval to try,
because it addresses the exact weakness measured in the deterministic detector.
