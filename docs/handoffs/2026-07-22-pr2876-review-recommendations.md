# PR 2876 Review Recommendations

PR 2876 merged the PR 1 governance gate. The remaining fixes below should be handled before PR 2 adapters rely on it heavily.

## 1. Verify Split Against Lineage

`check_training_eligibility()` currently trusts caller-provided `split`.

Change it so eligibility verifies:

```python
canonical_split(inp.split) == assign_split(inp.document_lineage_key)
```

If the caller-supplied split does not match the lineage-derived split, reject with a typed governance code such as `LINEAGE_SPLIT_MISMATCH`.

Add tests proving:

- a lineage whose derived split is not `train` cannot become eligible by passing `split="train"`
- legacy names like `dev` and `holdout` still canonicalize correctly
- bare content-hash lineage keys still fail before split comparison

## 2. Treat Unknown License As Unresolved

`resolve_rights()` denies capabilities for `license_class="unknown"`, but still returns `rights_resolved=True` when the manifest flag is true.

The policy says unknown license is the same as unresolved. Update behavior so unknown license either:

- returns `rights_resolved=False`, or
- causes `check_training_eligibility()` to emit `RIGHTS_UNRESOLVED`

Preferred: make `RightsStatus.rights_resolved` false when the license is unknown. That keeps the semantic truth in the rights layer.

Update the existing unknown-license test to expect `rights_resolved=False`.

## 3. Fix Tautological Revision/Render Test

`test_revision_and_render_keep_the_same_split()` currently compares `assign_split(key)` to itself.

Replace it with records that represent distinct revisions/renders/crops sharing one `document_lineage_key`, then assert `group_and_split()` stamps the same split on all of them.

Example shape:

```python
[
    {"record_id": "v1-page", "document_lineage_key": key, "revision": "v1"},
    {"record_id": "v2-page", "document_lineage_key": key, "revision": "v2"},
    {"record_id": "crop", "document_lineage_key": key, "render": "crop"},
]
```

## 4. PR 2 Adapter Guardrail

PR 2 should introduce a shared `SourceCandidate` and make all adapters lower into it before constructing `EligibilityInput`.

Require each adapter to prove:

- it derives or receives a valid PR 1 lineage key
- it never uses source/page/render/pack hashes as lineage keys
- it resolves rights through `resolve_rights()`
- it passes the lineage-derived split, not a hand-written split
- it runs `check_training_eligibility()` and `find_leakage()`

## Done Criteria

- focused governance tests pass
- PR 2 adapter tests pass
- `ruff check` passes
- `ruff format --check` passes
- Pyright has no errors on touched governance/adapter files
