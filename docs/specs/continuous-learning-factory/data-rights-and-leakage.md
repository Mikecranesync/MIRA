# CLF Data Rights & Leakage Control

Policy for ADR-0030 principles 2, 3, 8. PR 0 defines the **policy + split key**; enforcement lands with the corpus registry (PR 1), gold manager + leakage guard (PR 7), and training exporter (PR 9). No code here.

## Part 1 — Rights fail closed

Every consumer treats a **missing or unknown right as `false`**. Only an explicit `true` grants a discretionary capability.

`corpus-source.v1.rights` is the manifest:

```
rights_resolved      false ⇒ unknown ⇒ deny ALL discretionary capabilities
training_allowed     default false
evaluation_allowed   default false — true only when the source policy explicitly permits eval
public_export_allowed        default false
cross_tenant_reuse_allowed   default false
derivatives_retained         default false
```

Rules:
1. `rights_resolved=false` (or the `rights` object absent) ⇒ the source may be **stored** but not evaluated, not trained on, not exported, not reused cross-tenant. It is inert until rights are resolved.
2. `license_class="unknown"` ⇒ same as unresolved. A source is only usable under a **named** license class.
3. **Evaluation is itself a right.** A source with `evaluation_allowed=false` is not silently graded "because it's just eval". The internet-print program only ingests public, robots-permitted documents (enforced today by `tools/internet_print_test/safety.py`); the rights manifest records *why* each is permitted (`rights.policy_ref`).
4. **Training is the strictest gate** and is checked again at export (see promotion-policy § "Training eligibility"). `training_allowed=false` gold is common and correct.

Worked example: AN-GS-021 is `license_class: public-eval-only`, `evaluation_allowed=true`, `training_allowed=false`, `public_export_allowed=false`, `cross_tenant_reuse_allowed=false`. It can be evaluated and turned into an evaluation-gold record, but **never** trained on or exported — the schema and example encode exactly that.

## Part 2 — Document-level leakage control

Train/validation/test splits partition on **document identity**, never on page or render. The split key is `document_lineage_key`.

### Why page-level splitting leaks

A single manual rendered at 200 dpi and 300 dpi, cropped, rotated, or lightly augmented produces many near-identical pages. If page A lands in `train` and its 300-dpi twin lands in `test`, the model is tested on what it trained on — a silently inflated score. Splitting by `page_id` or `page_sha256` **cannot** prevent this; only a stable document identity can.

### The rule

1. `document_lineage_key` is assigned at source registration and is **stable across every revision, render, crop, rotation, and augmentation** of the same underlying document lineage. All of them share one key.
2. `split_assignment ∈ {train, validation, test, held_out}` is derived from a **hash of `document_lineage_key`**, so every sibling of a lineage deterministically lands in the *same* split. A render can never cross the partition from its source.
3. A revision (`corpus-source.v1.supersedes`) keeps the lineage key of what it supersedes — a v2 datasheet does not sneak into `test` while v1 is in `train`.
4. Leakage checks run on `document_lineage_key`, never on `page_id`. `page-render.v1` and `eval-result.v1` both carry the lineage key so the guard has it everywhere.
5. **Frozen benchmark rows** (PR 7) pin `held_out` lineages that are never eligible for training export, so the regression set cannot be contaminated by the training set.

### What the leakage guard (PR 7) must catch

- ❌ Two records with the same `document_lineage_key` in different `split_assignment`s.
- ❌ A `training_eligibility="eligible"` record whose lineage is on the validation/test side.
- ❌ A split computed from `page_id`/`page_sha256` instead of `document_lineage_key`.
- ❌ A superseding revision assigned a fresh lineage key (would split a lineage across partitions).

## Cross-tenant

`cross_tenant_reuse_allowed=false` (the default) means a customer-private source never enters a shared corpus or a cross-tenant training export. This composes with the existing tenant-scoping law (`.claude/rules/knowledge-entries-tenant-scoping.md`): private stays private by default, and CLF adds an explicit, auditable rights flag on top rather than a new tenancy model. See [`threat-privacy.md`](threat-privacy.md) for the isolation threat model.
