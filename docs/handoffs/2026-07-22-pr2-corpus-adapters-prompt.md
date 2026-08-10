# PR 2 Prompt - Corpus Adapters Feed PR 1 Governance

You are implementing PR 2 after PR 1 merged the shared governance gate.

PR 1 defined the contract. PR 2 feeds it.

Build pure adapter code only. No agent execution, no network calls, no paid calls, no training runs.

## Goal

Create one shared `SourceCandidate` shape, then implement three adapters that lower real corpus sources into:

```python
EligibilityInput(
    gold_status,
    rights,  # RightsStatus
    split,
    document_lineage_key,
    validation_passed,
    safety_status,
    provenance_present,
    schema_valid,
    frozen_eval,
    sensitive,
    tenant_id,
    confidentiality_class,
)
```

Every adapter must then support:

```python
check_training_eligibility(candidate.to_eligibility_input())
find_leakage([...])
```

## Adapters

1. **PR 2A: PrintSense / Print-of-the-Day**
   - Public prints use `<manufacturer-slug>:<document-number-slug>` lineage keys.
   - Tenant/private uploads use `tenant:<tenant-id>:document:<uuid>`.
   - Never use `source_sha256`, page hash, render hash, crop hash, or pack hash as lineage.
   - Public eval-only material must remain ineligible for training.

2. **PR 2B: Drive Commander Packs**
   - Treat packs as data, not code.
   - Pack/content hashes are evidence identifiers, not lineage keys.
   - Tenant drive packs default to `sensitive=True`, tenant-scoped, and not cross-tenant reusable.
   - Rights fail closed unless an explicit manifest says otherwise.

3. **PR 2C: MIRA + SimLab**
   - SimLab/frozen benchmark sources default to eval-only.
   - Use stable synthetic/frozen lineage IDs that pass PR 1 lineage validation.
   - Set `frozen_eval=True` for permanent benchmark material.
   - Keep synthetic origin visible in metadata.

## Design Rules

- Add the shared `SourceCandidate` first; all three adapters must produce it.
- Do not bypass `resolve_rights()`, `assign_split()`, `check_training_eligibility()`, or `find_leakage()`.
- Bare content hashes as `document_lineage_key` are invalid.
- Unknown rights, unknown license, missing provenance, tenant/private ambiguity, or invalid split must fail closed.
- Do not modify PR 1 governance policy unless an adapter exposes a real bug; add regression tests if so.

## Tests

Add hermetic tests only:

- candidate -> `EligibilityInput` mapping for each adapter
- public vs tenant lineage key behavior
- rights fail-closed behavior
- tenant/private data stays ineligible for shared training
- SimLab/frozen sources cannot become trainable
- leakage guard catches cross-split lineage contamination

Done when focused adapter tests, governance tests, `ruff check`, and `ruff format --check` pass.
