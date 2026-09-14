# Safety coverage contract (notebook answer gate)

Status: ACTIVE. Established 2026-09-14 from the owner-directed safety coverage
audit (PR #3792 handoff). Owner decisions it encodes: #3787 (two-lane), the
merge-hold arc on PR #3792, and #3793 (semantic layer).

This is the ONE shared contract for what the answer gate enforces, where, and
how it is evaluated. A new hazard class, surface, or checker extends THIS
document — never a parallel one.

## Three separated concerns

A pass in one concern never implies a pass in another. Findings and fixtures
are always tagged with exactly one:

1. **Physical safety** — the answer must not instruct, endorse, or normalize
   exposing a person to a hazard. Enforced in BOTH lanes, refusals included.
2. **Factual support** — machine-specific values, procedures, code meanings,
   and document claims need evidence. General lane: deterministic specificity
   floor. Grounded lane: the citation contract owns it.
3. **Data/tool authorization** — tenancy, source trust, and machine actions
   are enforced in code (session, RLS, read-only OT). Model wording can never
   grant access or authorize an action. (Not owned by the answer gate; listed
   so nobody "passes" it with a prose check.)

## Enforcement surfaces

| Surface | Mechanism | Lanes |
|---|---|---|
| Notebook chat route (output) | Buffer → deterministic floor (`answer-validation.ts`) → semantic layer (`answer-safety-check.ts`, #3793) → release. Rejected/unverified candidates ship SAFETY_STOP or the controlled fallback, zero citations, basis NULL, safety_notice evidence; the draft is never persisted. | Both |
| Notebook chat route (input) | `matchSafetyStop` (Hub) classifies the QUESTION; Tier-1 incidents hard-stop, hazard intent injects the NFPA 70E directive (#3763). | Both |
| Python adapters (input) | `classify_intent` + `SAFETY_KEYWORDS`/action phrases (`mira-bots/shared/guardrails.py`). | Bot surfaces |

**Known input-parity gap (audit-demonstrated):** Python's action-phrase list
catches "I am going to enter the tank now" / "I will bypass the emergency
stop"; Hub `matchSafetyStop` does not. Disposition: the OUTPUT gate is the
backstop for what input classifiers miss (an unsafe answer is stopped
regardless of how the question was classified). Closing the input gap is
follow-up work on the Hub phrase list — tracked as a #3793 sub-task; it must
port the Python action phrases, not fork a third list.

**Kill switches:** `NOTEBOOK_ANSWER_GATE=0` restores byte-identical legacy
streaming (detection-only logs; NOT an equivalent safety mode).
`NOTEBOOK_SEMANTIC_CHECK=0` disables the semantic layer only. Neither is set
in prod compose or Doppler prd — both layers default ON.

## Hazard classes and their enforcement

| Class | Deterministic floor (`answer-validation.ts`) | Semantic selector class |
|---|---|---|
| Electrical / energized / stored charge | affirmation heads, imperative/modal grammars, clause-hazard-energized inversion, LOTO-not-required, without-isolation, must-remain/keep-energized | `electrical` |
| Hydraulic / pneumatic / stored pressure | clause-hazard-pressurized coupling (disconnect/loosen/crack × pressurized/under-pressure/charged) | `pressure` |
| Machine motion, guards, interlocks | disable-safety-device imperative, bypass-blessing, clause-hazard-motion (reach into/between moving) | `machine-motion` |
| Gravity / suspended loads / rigging | under-unsupported-load, rigging-overload (same-unit capacity compare; mixed units → semantic layer) | `lifting` |
| Confined spaces / atmospheres | confined-entry-untested (testing waived, entry-without) | `confined` |
| Fire / gas / ignition | flame-near-gas | `fire-gas` |
| Falls / elevated work | (semantic layer only today) | `height` |
| Claims of verified safety | claims-verified-safety (first-person verification claims) | judged in every class |
| Exact machine settings (general lane) | exact-setting → controlled fallback | n/a (concern 2) |

The deterministic floor is a bounded invariant, not a truth oracle; the
semantic layer judges meaning but can be wrong or unavailable. Neither claims
completion of industrial safety — see OSHA's hazardous-energy scope (it is
wider than electrical) and the audit's boundary statements.

## Exemption discipline (learned over review iterations 4–7)

A prohibitive/cautionary exemption must (a) be **clause-scoped** to the
instruction-bearing clause, (b) **grammatically bind** the hazard (auxiliary-
only gap; inverting verbs like hesitate/forget/fail excluded), and (c) be
**polarity-checked** (a reversed head — "cannot avoid" — never exempts).
Reassurance idioms never exempt. Fail closed when any of these cannot be
established.

## Semantic layer failure modes (audit item 3)

| Condition | Behavior |
|---|---|
| Verdict `unsafe` | SAFETY_STOP path, `unsafe-answer:semantic-<class>` |
| Timeout, provider failure, malformed verdict, no provider | Controlled unverified fallback, `unsafe-answer:semantic-unverified` — never a silent release, never a default of safe |
| Selector miss | Zero inference; logged for rate measurement |
| Gate off | Semantic layer entirely off (no spend) |

Zero-token law (5 questions): what varies = each candidate answer (novel
synthesis → runtime inference is doing real work); the stable part = the
selector and this contract (deterministic artifacts); tested via hermetic
fixtures with mocked providers; invalidated by prompt/provider/contract
changes (judge prompt lives in `answer-safety-check.ts`, versioned with it).

## Evaluation contract (audit item 4)

- **Regression corpus (no longer unseen):** every probe from adversarial
  review iterations 1–7 and the 2026-09-14 audit's 17-case table is pinned in
  the vitest suites and consolidated in
  `tests/eval/adversarial/safety_gate_regression_2026_09_14.jsonl`.
- **Unseen holdout:** future evaluations require a set NOT in the repo,
  covering paraphrases, compound clauses, negation, multi-turn context,
  poisoned sources, and each class above, plus usefulness controls (normal
  operation, education, legitimate warnings). Report misses AND false refusals
  **by hazard class, lane, and surface** — never a single pass count.
- **Measurement before claims:** the semantic layer's invocation rate, cost,
  and latency are read from the `semantic-check` log lines on staging; the
  #3793 sub-5% estimate is unadopted until measured.
- Acceptance-policy review by a person qualified in the relevant industrial
  safety domains is required before coverage claims are made to customers.

## What a reviewer must catch

- ❌ A new hazard pattern whose exemption is word-presence (see discipline).
- ❌ A selector change that narrows to one hazard vocabulary.
- ❌ A flagged candidate path that can release without a verdict.
- ❌ A second provider list, phrase list, or coverage registry.
- ❌ A claim that any layer "completes" or "guarantees" safety coverage.
