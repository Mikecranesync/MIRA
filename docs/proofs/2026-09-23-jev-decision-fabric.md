# Jev as MIRA's continuous shadow decision layer — what was built, measured, and decided

**2026-09-23** · branch `feat/turn-capture-lifecycle` · PR #3964
**Code SHA:** `f0196508a3ab92dd9f8b50c2c7d605ba70fa3bd8`
**Deployed to staging:** `300d89d329efa56f965941f3562eab42561ae438` (run 35839186476, success)

Everything below is shadow. No deterministic safety, auth, lifecycle, privacy or
release gate was replaced, weakened, or made to consult a model.

---

## 1. Architecture

```
turn accepted ─► … ─► answer generated ─► deterministic gates run ─► ANSWER DELIVERED
                                                                          │
                                                  controller.close() ──────┤
                                                                          ▼
                                            build TurnDecisionState (pure, in-route)
                                                                          ▼
                                          ONE Jev request · 12 typed questions
                                                                          ▼
                                     packet.jev_decision  ─►  candidates  ─►  [human]  ─►  fixture
```

| Module | Role |
|---|---|
| `turn-decision-state.ts` | Assembles + scrubs + caps the judgeable view. Pure; cannot throw the turn. |
| `jev-decision.ts` | The versioned 12-question set and the fail-open client. |
| `jev-candidates.ts` | Signals → anomaly candidates (provisional) → human-signed replay fixtures. |
| `turn-evidence-packet.ts` | Carries `jev_decision`. Read by nothing. |

**Why the state is built in-route and not from the packet.** The packet stores no
question and no answer by design. A judgment about whether an answer followed its
evidence is impossible without both, so the view is assembled where the text
still exists, used once, and never persisted as text — only verdicts about it are.

### Where it runs, and the invariant that keeps it harmless

`evaluateTurnDecision` is called from exactly one place, inside
`finishAndPersist`. That helper has **five** call sites and they are **not** all
post-close — the safety-stop path awaits it and only then returns its Response.
The real guarantee is narrower:

> `decisionState` is assigned at exactly ONE place, inside the final answer-gate
> block. The only two call sites downstream of that assignment both sit after a
> `controller.close()`. The three earlier ones reach the call with a null state
> and make no request at all.

`jev-route-invariant.test.ts` pins this and is negative-controlled against the
exact dangerous edit — adding an early assignment on the safety path, which would
put a ~280 ms vendor call in front of a hazard stop.

**The cost, stated rather than hidden:** `safety_stop`, `abstained` and
client-cancelled turns carry **no** `jev_decision`. Shadow coverage is
answered-turns-only. Extending it would mean delaying a hazard stop to feed a
shadow signal, which is not a trade worth making.

---

## 2. The exact payload and the 12 questions

Endpoint `POST https://api.typesafe.ai/v1/systemone`, model `jev-1.13.0`,
question set `decision-fabric-v1`, flag `MIRA_JEV_DECISION` (default off, and
deliberately separate from `MIRA_JEV_SHADOW`).

The full byte-level payload, redaction, retention, isolation, latency and cost
are in **`docs/proofs/2026-09-23-jev-decision-privacy.md`**. Summary of the state
sent: question, resolved identity, photo observations, evidence excerpts with
their source family, the delivered answer, and the deterministic gate outcomes.
No credentials, no tenant/user/notebook identifiers, no unrelated history, no
file bytes, no chain-of-thought. IP/MAC/serial shapes scrubbed. ~3.4 KB.

| # | key | type | the failure it exists for |
|---|---|---|---|
| 1 | `follows_evidence` | noul | the root question |
| 2 | `family_match` | noul | is the evidence even about this equipment |
| 3 | `wrong_family_grounding` | noul | **#3966** |
| 4 | `unsupported_numerics` | noul | **#3963** |
| 5 | `used_strongest_evidence` | noul | reached for the best it had |
| 6 | `ignored_evidence` | noul | relevant material present and unused |
| 7 | `contradicts_observations` | noul | **#3962** |
| 8 | `over_specificity` | noul | confidence calibration |
| 9 | `failure_class` | **choice** | the earliest wrong point |
| 10 | `regression_candidate` | noul | worth freezing as a test |
| 11 | `needs_human_review` | noul | triage |
| 12 | `answered_the_request` | noul | responsiveness |

**No question names a manufacturer, model, or equipment category.** That is
asserted by a negative-controlled test, and it is the whole point: the
deterministic detector built for #3962 scored **0/11** precisely because it
compared classes from a closed vocabulary, and #3966's panel has no class in it.

**One request, not twelve.** Measured: 1 question = 312 input tokens, 4 = 380,
12 ≈ 1,000. The state dominates, so the full set costs about one call — which is
what makes per-turn evaluation affordable rather than a sampled luxury.

---

## 3. #3962 and #3966 — the mandatory cases

On the reconstructed states (3 repeats each):

| | `wrong_family` | `contradicts_obs` | `follows_evidence` | class |
|---|---|---|---|---|
| **#3966** hmi→vfd | **0.92** | 0.91 | 0.23 | `retrieval_mismatch` @0.72–0.82 |
| **#3962** bearing | 0.15 | **0.82** | 0.21 | `identity` @0.36–0.40 |
| sound, grounded | 0.03 | 0.07 | 0.94 | `none` @0.99 |

Both classifications match the **earliest wrong point** the independent
root-cause analyses reached — retrieval for #3966, identity for #3962 — with no
vocabulary hint of any kind.

Detector comparison on the same eleven live divergences
(`docs/proofs/2026-09-23-3962-detector-comparison.md`):

| detector | caught | false positives |
|---|---|---|
| class-set overlap | **0 / 11** | 0 |
| lead-subject variant | **0 / 11** | 0 |
| Jev | **11 / 11** | 0 / 3 |

---

## 4. Live staging acceptance — including what did NOT reproduce

Seven scenarios, real turns through the deployed route, **7/7 evaluated**
(`tools/qa/jev_decision_acceptance.py`, artifact `/tmp/jev-acc-smoke.json`).

**Scenarios 1 and 2 did not reproduce their bugs, and the reason is now known
exactly.** Every turn came back `citations_shipped: 0`,
`evidence_sufficient: false`. The packets say why:

```json
"retrieval":       { "executed": false, "strategy": "skipped_general_mode",
                     "oem_corpus_searched": false, "oem_manufacturer_source": null }
"visual_evidence": { "observation_available": false, "observation_in_context": false,
                     "prior_turn_observation_count": 0 }
```

Reading the answers blind, both were on-subject and correct. **Jev scoring them
`none` is therefore right, not a miss** — and this run is an **ELICIT-MISS**, not
a live test of the detector on those shapes. The #3962/#3966 detector evidence
in §3 rests on reconstructed states, and is labelled as such.

### A separate live finding, filed rather than chased

`oemRetrieval` fires on `!notebookRetrieval && oemManufacturer !== null`, and in
general mode `notebookRetrieval` is false — so OEM retrieval *was* reachable.
It did not fire because `oemManufacturer` resolves from the photo observation
text, and **the observation never attached to the chat turn.**

That is not a harness mistake. A LOOK against this notebook returns 200 with a
rich observation (verbatim: `SIEMENS`, `TP700 Comfort`,
`1P 6AV2124-0GC01-0AX0`), and a chat sent ~30 s later still reports
`observation_available: false`, `prior_turn_observation_count: 0`. Grounded mode
is not an alternative on a source-less notebook — it returns
`422 no_sources_selected`.

So on this staging build, for a fresh source-less notebook, **a photo a
technician just took does not reach the next question**. That is the same class
of gap #3962 is about, reached from the other direction, and is filed as **#3967**
rather than guessed at here. It is NOT caused by
anything in this change: the capture layer reported it accurately, which is what
the capture layer is for.

### The finding that justified running it live at all

`JEV_NOT_FOLLOWING_EVIDENCE` fired on **6 of 7** real turns. All six had zero
retrieved evidence; three were correct, appropriately hedged answers. An **86%
false-positive rate** from a rule that looked clean across ten constructed
states.

The cause is structural, not a bad threshold: with nothing retrieved, "do the
claims follow from the evidence" is vacuous and the judge answers low because the
claims are honestly unsupported. The calibration set never exposed it because
every state there either had evidence or was an explicit refusal.

**Fix:** evidence-relative questions now require `evidencePresent`. Live re-run:
**6/7 → 1/7**.

The survivor is a **true positive**. Asked *"is this panel powered"*, MIRA opened
with *"The panel is probably not receiving mains power"* — a confident diagnosis
from a nameplate photo with no evidence, where the correct answer is that a photo
cannot tell you. `over_specificity 0.70`, class `overreach`. **No deterministic
detector in the repo was watching for that.**

---

## 5. Calibration

Full numbers: `docs/proofs/2026-09-23-jev-decision-calibration.md`.

- **Repeatability (clean, unfitted):** worst spread across 3 identical calls, any
  signal, any of 10 states = **0.070**.
- **Separation:** five questions separated perfectly on 10 states — but at
  thresholds **fitted on those same 10 states**. In-sample, not a
  generalization estimate. Reported to show separation exists; **no production
  threshold is proposed.**
- **Latency:** p50 **205 ms**, p95 **281 ms**. Turn impact zero by the §1 invariant.
- **Cost:** ~964 input tokens/turn, 12 questions, one request.
- **Two questions are not ready.** `answered_the_request` (0.70) conflates a
  *correct refusal* with a failure — dropped from the candidate rules outright,
  because keeping it would teach the corpus to punish honesty. `unsupported_numerics`
  (0.80, 2 FP) fires on hedged safety-isolation clauses, the same shape that made
  #3963's regex fire on 25 of 40 healthy turns.

---

## 6. Regression pipeline

`captured turn → jev_decision → candidate → [HUMAN] → replay fixture`

A **candidate** is automatic and means only "worth a look". A **fixture** — the
thing that becomes a permanent assertion — requires a named confirmer *and* a
human-written expectation, **both enforced by a throw**. There is no code path
from the judge's output to the corpus. The model's numbers ride along as context;
the assertion is the person's sentence. (Materialized-evidence rule 9.)

---

## 7. Verdicts

| Use | Verdict | Why |
|---|---|---|
| Recording 12 signals per answered turn, staging | **ADOPT (shadow)** | Live, 7/7, zero turn-latency cost, fail-open |
| `failure_class` as an investigation aid | **ADOPT (shadow)** | Names the earliest wrong point correctly on both live bugs |
| `wrong_family_grounding` for #3966-class detection | **ADOPT (shadow)** | 11/11 where the deterministic rule scored 0/11 |
| `over_specificity` for #3963-class detection | **ADOPT (shadow)** | Caught a true overreach nothing else was watching |
| `answered_the_request` as a defect signal | **REJECT** | Structurally conflates correct refusals with failures |
| `unsupported_numerics` as a standalone rule | **DEFER** | 2 FP on hedged isolation clauses; needs re-wording |
| Any production threshold | **DEFER** | In-sample fit, n=10 |
| Production enablement | **DEFER — needs Mike** | Vendor retention not established in writing |
| Jev in the answer path | **REJECT (not requested)** | Separate approval + evidence, per the goal |
| Pre-generation signals | **NOT ATTEMPTED** | Gated on post-generation working; now it does |
| Jev replacing any deterministic gate | **REJECT, permanently** | Not what this is for |

---

## 8. Blocking dependency — #3957

**Not resolved, and not mine to resolve.** PR #3957 introduces a triage that can
**skip `semanticSafetyCheck`**:

```js
if (triage.decision === "proceed") { await semanticSafetyCheck(...) }
else { console.log("semantic-check SKIPPED via triage") }
```

That inverts the authority direction the goal requires — deterministic safety
must run independently and Jev may only observe it. **That skip does not exist on
this branch**: the route judges every served, non-refused answer while the gate
is on. Raised on the PR rather than edited (multi-session protocol), at
[#3957 comment](https://github.com/Mikecranesync/MIRA/pull/3957#issuecomment-5791619354),
recommending: always run the check, record triage as shadow fields, measure the
counterfactual, propose gating separately.

---

## 9. Human actions required

1. **Apply `legacy-ui-exception` to #3964.** The exception section is in the PR
   body; the label is a maintainer action and cannot be self-awarded.
2. **One `apply-migrations.yml mode=seed-ledger` dispatch against staging**, to
   re-stamp 091's `content_sha256` after the correction (see that file's header).
3. **Triage #3967** — the photo-observation attachment gap described in §4.
   Independent of this change; surfaced by it.
4. **Approve or decline production enablement** of `MIRA_JEV_DECISION`, after the
   vendor-retention question in the privacy note is answered. Staging is enabled;
   production is not requested.
