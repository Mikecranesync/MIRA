# CLF Promotion Policy (typed proposals + gold authorization)

Policy for ADR-0030 principles 4, 5, 8, 9. PR 0 defines the **matrix**; enforcement lands with the gold manager (PR 7) and rule miner (PR 8). No code here.

## Two separations this policy enforces

1. **Evidence status ≠ approval status** (principle 5). A record carries *both*, independently:
   - **Evidence status** (provenance quality): `evidence_status.completeness`, `regions_present`, `citation_integrity`, deterministic `import_verdict`.
   - **Approval status** (is it trusted): `review_status`, `gold_status`, `training_eligibility`.
   - Great provenance never sets approval. `citation_integrity=ok` does **not** make a wrong answer gold.
2. **Proposal object types are never blurred** (principle 9). Three separately-typed proposal classes, each with its own validation policy, riding the existing `ai_suggestions` propose→approve rail (ADR-0017), **not** a new approval system:

   | Proposal class | Promotes | Backed by | Auto-promote? |
   |---|---|---|---|
   | `relationship_proposal` | a KG edge | `relationship_proposals` + evidence (existing) | never (existing rule) |
   | `gold_answer_approval` | an `eval-result` → `gold-record.v1` | correction event + judge/human | only per the gold matrix below |
   | `deterministic_rule_approval` | a `rule-candidate.v1` → active validator | ≥3 lineages + passing tests | never — human-approved |

   Glossary discipline from `.claude/CLAUDE.md` applies: name the class, never "the proposal table".

## Gold authorization matrix (principle 4 → gold_eligible)

`judge-independence.v1.gold_eligible` is **derived here**, not asserted by the writer. A candidate may become `gold` only through an authorized mechanism:

| Mechanism (`gold-record.v1.approval.mechanism`) | Authorizing independence class | May auto-promote to gold? | Confidence cap |
|---|---|---|---|
| `DETERMINISTIC_PROOF` | `DETERMINISTIC_PROOF` | yes — a proof is not an opinion | none |
| `HUMAN_REVIEW` | `HUMAN_REVIEW` | yes — with recorded `approved_by` | none |
| `INDEPENDENT_JUDGE` | `INDEPENDENT_PROVIDER_MODEL` | yes | ≤ 0.9 |
| `INDEPENDENT_JUDGE` | `DIFFERENT_MODEL_SAME_PROVIDER` | **candidate only** — needs human confirm | ≤ 0.8 |
| — | `SAME_MODEL_DIFFERENT_RUN` | **no** | ≤ 0.7 |
| — | `SELF_CONSISTENCY_ONLY` | **no** | ≤ 0.6 |

Consequences:
- The AN-GS-021 case (interpreter and judge both MiniMax-M3) is `SELF_CONSISTENCY_ONLY` → **cannot auto-promote**. It reaches `gold` only via a `HUMAN_REVIEW` approval (as its example shows), never by the model agreeing with itself.
- A model **never** promotes its own output to gold. Self-training on unverified guesses is structurally impossible: the only paths to `gold` are a human, a proof, or a genuinely independent provider+model.

## Training eligibility is a *third* gate

`training_eligibility` is **not** implied by `gold`. A record is `eligible` for training export only when **all** hold:

1. `gold_status == "gold"`, **and**
2. source `rights.training_allowed == true` (fail closed — see [`data-rights-and-leakage.md`](data-rights-and-leakage.md)), **and**
3. its `document_lineage_key` is on the **train** side of the split (never validation/test).

The AN-GS-021 gold example is `training_eligibility: "ineligible"` precisely because its rights are `public-eval-only` (`training_allowed=false`) — a perfect gold record that may still never be trained on. Evaluation-gold and training-gold are different clearances.

## Rule promotion (deterministic_rule_approval)

A `rule-candidate.v1` becomes an active `grade_case` validator only when:
- it recurs across **≥3 distinct `document_lineage_key`s** (not 3 pages of one manual — enforced by the miner and the schema's `minItems: 3`),
- it is expressible as a deterministic, testable check with **passing positive + negative tests**,
- it declares a `rollback_path`, and
- a human approves it (`status: approved`).

Promotion is deterministic-first: a mined rule that can replace a model judgment moves that check into the free deterministic layer, lowering future cost — the flywheel's payoff.
