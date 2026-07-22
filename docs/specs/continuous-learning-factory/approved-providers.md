# CLF Approved Model Providers (fail-closed allowlist)

Policy for ADR-0030 principle 7 (cost governor) and the threat model (T1/T7). PR 0 defines the **allowlist policy + shape**; the runtime allowlist and its enforcement land in **PR 6**. **No runtime allowlist file or loader ships in PR 0.**

## The rule

> **A model may only run if an explicit allowlist entry authorizes that exact provider + model, for the data classification and purpose of the call. Anything not listed is denied.**

Fail closed: an absent entry, an unknown model id, an expired entry, or a purpose/classification the entry does not grant ⇒ **deny**. There is no wildcard and no "default provider". This is the model-selection half of the cost governor's "never silently switch to an unapproved model" rule ([`cost-governor.md`](cost-governor.md)) and the structural defense against self-training on an unvetted model (threat T1, [`threat-privacy.md`](threat-privacy.md)).

## The allowlist is repository-controlled

The allowlist is a **checked-in artifact** (a file in the repo, edited by PR + review), never a database row a service can silently add to and never an environment variable. Changing who may run inference is a code review, with the approval owner recorded in git history. PR 6 chooses the concrete on-disk format (JSON/YAML) and the loader; PR 0 fixes only the required columns below.

## Required columns (every entry)

| Column | Meaning |
|---|---|
| `provider` | the inference provider (e.g. `together`, `groq`, `cerebras`) |
| `model` | the **exact** model identifier, not a family (e.g. `MiniMaxAI/MiniMax-M3`) |
| `allowed_data_classification` | the max sensitivity this entry may process: `public` \| `internal` \| `customer-confidential` |
| `allowed_purposes` | which CLF calls it may serve: any of `interpret` \| `judge` \| `classify` \| `synthesize` |
| `approval_owner` | the human accountable for the entry (role id) |
| `effective_date` | RFC3339 date the entry becomes valid (and optionally an `expires` date) |

An entry grants a capability **only** for the intersection of its classification and purposes. A `public`-classified entry may not touch a `customer-confidential` print even if the model is otherwise capable.

## Illustrative entries (not the runtime file)

Grounded in the current serverless reality (only MiniMax-M3 was serverless on Together as of 2026-07-19):

| provider | model | allowed_data_classification | allowed_purposes | approval_owner | effective_date |
|---|---|---|---|---|---|
| `together` | `MiniMaxAI/MiniMax-M3` | `public` | `interpret`, `judge`, `classify` | `owner:mike` | `2026-07-21` |
| `groq` | `llama-3.3-70b-versatile` | `internal` | `judge`, `synthesize` | `owner:mike` | `2026-07-21` |

These rows are documentation. They are **not loaded by any runtime in PR 0** and do not authorize any call until PR 6 ships the enforced allowlist.

## Interaction with judge independence

The allowlist governs *whether* a model may run; [`promotion-policy.md`](promotion-policy.md) governs *what its output may authorize*. Both apply. If cost fallback collapses interpreter and judge onto the same allowed model (the MiniMax-M3 case), the call is permitted but the resulting `judge-independence.v1` class is `SELF_CONSISTENCY_ONLY` (`gold_eligible=false`). Allowed to run ≠ allowed to promote.

## What a reviewer must reject

- ❌ A call to a provider/model with no allowlist entry.
- ❌ An entry granting a purpose/classification broader than justified.
- ❌ The allowlist stored as a mutable DB row or env var instead of a reviewed repo artifact.
- ❌ A runtime that treats a missing/expired entry as "allow" (must deny).
