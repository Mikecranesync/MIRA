# #3973 — the detected hazard now constrains the answer (2026-09-23)

## The turn, traced end to end

| Stage | What happened | Where |
|---|---|---|
| Classification | `matchSafetyStop()` returned `ENERGIZED_ELECTRICAL_HAZARD` (480 V ∧ clamp meter) | `mira-hub/src/lib/safety-classifier.ts:162` |
| Route | `electricalHazardDirective = true` | `…/chat/route.ts:1232` |
| Prompt | appended `ELECTRICAL_HAZARD_DIRECTIVE` — **advisory text**, no prohibition on emitting the procedure | `…/chat/route.ts:2045` |
| Generation | Groq `openai/gpt-oss-120b`, 623 ms | packet `providers` |
| Deterministic floor | `validateAnswer()` → **`{ok:true}`** | proven locally, see below |
| Semantic judge | **ran and returned `safe`** — *"instructs isolation and verification before measurement"* | run live against the staging cascade, see below |
| Answer gate | `decision: "answered"`, `reason: "served"`, `safety_classification: "hazard_directive"` | packet |
| SSE | `content ×8`, `evidence` with `hazardEntries` | device capture |
| Client | **Warning** banner + the full procedure | Pixel 9a |

**Earliest boundary where detection fails to constrain: the route's own use of the
classification.** `electricalHazardDirective` did exactly two things — append a paragraph to the
system prompt and put a banner on the evidence frame. It was never passed to the validator, so the
hazard category placed no constraint on what could be emitted. Everything downstream is a
consequence of that, not a separate cause.

## Live evidence

- Packet, turn `83a3d96e-e0e0-4fa8-a47a-098cdff7f831`, trace `ad3b9b2aae15fce80aa1e8135f78e1f7`
  (staging `300d89d32`), read from inside the app over the diagnostics endpoint — no SSH:
  `answer_gate.safety_classification: "hazard_directive"`, `decision: "answered"`,
  anomalies `["GENERIC_ANSWER_UNGROUNDED_CLAIM"]` only.
- **The gate was ON.** `factorylm/stg` sets neither `NOTEBOOK_ANSWER_GATE` nor
  `NOTEBOOK_SEMANTIC_CHECK`, and neither appears in any compose file or workflow, so both default
  enabled (`process.env.X !== "0"`). This was not a disabled-flag incident.
- **The semantic judge saw this exact text and cleared it.** Run once against the live staging
  cascade under `doppler -c stg`:
  `{"verdict":"safe","hazardClass":"electrical","reason":"instructs isolation and verification before measurement"}`.
  It weighed the correct opening and not the final step. The fail-closed path was therefore never
  reached — the layer did not fail, it agreed.

## Code evidence

`validateAnswer()` returned `{ok:true}` for **both** verbatim shipped answers before this change
(probe: 2 failed / 2). Three grammar gaps explain it:

1. `ENERGIZED_LINK` was entirely temporal (`while|whilst|when|with|during`), so *"repeat the clamp
   measurement **on the live** conductors"* matched no relation.
2. `(?<![\w-])energized` excludes hyphenated forms to keep "de-energized" out — which also excluded
   **"re-energize"**, the imperative to restore hazardous energy.
3. `HAZARD_ACTIONS` had no `clamp`.

## What changed

- **Unconditional** (`ENERGIZED_CONTACT_SRC`): a contact preposition before a named live conductor
  (`on|onto|across|at` + `live|energized|hot|powered` + `conductor|bus|terminal|phase|…`) is an
  energized relation. It joins `ENERGIZED_RELATION_SRC` rather than standing alone, so
  `BOUND_PROHIBITION` still exempts the correct sentence *"never measure on live conductors"*.
- **Also unconditional** (`restoreEnergyToMeasure`, new rule A4): restoring power in order to take a
  reading. This was first written to fire only when the route had classified the turn. **Both halves
  of that theory were measured and the gate lost.** `matchSafetyStop` is a QUESTION test and returns
  `null` for *"The MCC is humming weird. What should I check?"* — so a gated rule would miss a
  hazardous ANSWER to an innocuous question, which is #3973 one step earlier. And the feared false
  positives do not occur: *"only after the work is complete may the feeder be re-energized"*,
  *"after the repair, re-energize and confirm the drive comes up"*, *"turn the disconnect back on and
  verify the contactor pulls in"* all pass, because the narrow `MEASURE_ACTION` set excludes
  work/replace/service/verify. All pinned as controls.
- `clamp` is a **verb** (`clamp(?:ing|ed|s)?(?![-\s]?meter)`) so the instrument noun "clamp meter"
  is not an action.
- Trailing-hyphen guards on `energized`/`live` and a classificatory exemption, so
  *"an energized-work permit"*, *"a live-work permit"* and *"this is energized work under NFPA 70E"*
  — the vocabulary a correct refusal uses — survive. Both were **pre-existing** false positives;
  adding `clamp` made the first one reachable, which is how they were found.
- `ENERGIZED_PROCEDURE_WITHHELD`: the category's permitted response. Not a bare refusal — a
  clamp-meter reading has no de-energized form, so "de-energize first" would be useless. It names
  why, hands the work to a qualified person under NFPA 70E, and gives three routes to the same
  number that stay outside the arc-flash boundary.
- **No route change.** An earlier draft passed `energizedHazard: electricalHazardDirective` into the
  validator; un-gating removed the need, and the diff is now entirely inside the shared floor. Any
  route that adopts `validateAnswer` inherits both rules with no classification of its own — which
  matters, because four other answer routes have no floor at all (#3977).

## Why this is pre-emission, not a warning

The floor runs inside the answer gate on the **complete buffered candidate**, before any byte is
released (`route.ts` "Under the gate nothing has been released yet"). Route tests assert the wire
directly (`src/capabilities/energized-procedure-wire.test.ts` — it lives in `capabilities/`
rather than beside the route because the Legacy UI Lifecycle Guard treats any ADDITION under
`mira-hub/src/app/**` as a guarded-path change, and a safety regression test is not what the
`legacy-ui-exception` is for): no `content` frame matches `/re-?energi[sz]e/`, `/live conductors/` or
`/repeat the clamp measurement/`, and the persisted `answerText` does not either.

## Advisory vs terminal

A rejection emits `{kind:"safety", trigger:"unsafe-answer:energized-procedure"}` and persists a
`safety_stop` entry. On the client the terminal frame **wins over** the non-terminal directive by
construction — `turns-to-parts.ts:189` (`const directive = !safety && …`) live, and
`directiveSafetyNotice()` returns null whenever `terminalSafetyNotice()` is non-null on hydration.
So a withheld procedure renders as one hard stop with success chrome suppressed, on the live turn
and after a cold launch. Both are pinned by tests here.

## Tests

| Suite | Result |
|---|---|
| `answer-validation-energized-procedure` | red-first 9 failed → **22 passed** |
| `energized-procedure-wire` (wire + persistence + terminal + safe control) | **6 passed** |
| full `mira-hub` suite | **3285 passed / 284 files**, no regressions |
| `tsc --noEmit` | 29 errors, across 6 unrelated test files; **none** in any file this branch touches (intersection of changed-files × error-files is empty) |

Paraphrases, the uncategorised path, permit vocabulary, concept questions, reading interpretation
and the legitimate restore-power sentence are all covered as named controls.

## Jev — measured, and NOT credited with this

The shadow column on the offending turn: `failure_class "overreach" (0.53, confidence 0.45)`,
`unsupported_numerics 0.94`, `needs_human_review 0.91`, `over_specificity 0.76`. Those signals are
consistent with the "0–600 A" / "480 V" figures, which the packet **already** caught
deterministically as `ungrounded_unit_claim: true`. The rubric is `sufficiency-v1` — an
evidence-relevance judgment, not a safety one. **Jev flagged the ungrounded-numeric defect, not the
energized-work instruction.** Claiming safety benefit from a sufficiency rubric would be exactly the
overclaim the shadow column exists to prevent. No change to Jev's configuration; it stays
shadow-only and is never consulted by the gate.

## Capture gap — explicit

**The Turn Evidence Packet records no semantic-check verdict.** `answer_gate` has
`safety_classification` and the deterministic outcome, but nothing for `semanticSafetyCheck`'s
class/verdict/latency. On this incident the packet could not distinguish "the judge cleared it" from
"the judge never ran" — the discriminator had to be re-run by hand against the live cascade. Adding
that field belongs to the observability lane: `turn-evidence-packet.ts` is currently being edited by
**#3964** and **#3970**, so it is filed rather than taken here.

## Not proven yet

The route tests prove the wire. **Proving it on the real website and the real Pixel requires the fix
to be on staging**, which needs an explicit GO — see the request on the PR. Until then #3973 is
fixed in code and unproven in the product.

## Coverage of the other answer surfaces (#3977)

Five routes call `matchSafetyStop`; only `equipment-notebooks` calls `validateAnswer`. The other four
(`assets/[id]/chat`, `namespace/node/[id]/chat`, `quickstart/ask`, `hub/ask`) hard-stop when the
QUESTION trips the conjunction gate — but that gate returns `null` for an innocuous question, and
those routes then have nothing between the model's output and the technician. Filed as #3977 after
correcting a first version of that issue which had the conclusion backwards. Because the rules here
are unconditional and live in the shared floor, adopting them on those routes is adoption, not
re-derivation.
