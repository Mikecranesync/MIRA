# Drive Commander — OEM Training-Rights Governance Record

Build: `technician-dataset-v0`
Decision date: 2026-07-25
Decided by: Mike (sole gold / rights / paid authority for this program)
Supersedes: the `BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED` posture recorded at
`docs/zta/2026-07-23-technician-dataset-inventory-gap-report.md#drive-commander`

## Why this record exists

`factorylm_ai/dataset/paid_gate.py` requires **both** trainable sources in the eligible set:

```python
REQUIRED_TRAINABLE_SOURCES: frozenset[str] = frozenset({"printsense", "drive_commander"})
```

Every `drive_commander` candidate was built `license_class=public-eval-only` /
`training_allowed=False`, and `_validate_decision_set` raises `DECISION_GOVERNANCE_BLOCKED`
on any attempt to approve one. The result was a gate that **no amount of human review could
pass** — `trainable_source_representation` was structurally unreachable.

The builder's own note named the remedy: *"Training remains blocked until the governance
record explicitly allows it."* This is that record.

## Decision

Training is **granted** for two Drive Commander sources:

| Source id | Manufacturer | Document | Lineage key | Train-side records |
|---|---|---|---|---|
| `durapulse_gs10` | AutomationDirect | GS10-UM | `automationdirect:gs10-um` | 20 |
| `powerflex_525` | Rockwell Automation | 520-UM001O-EN-E | `rockwell-automation:520-um001o-en-e` | 25 |

Effect: `license_class` → `public-eval-and-train`, `training_allowed` → `true`,
`rights_decision` → `ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL`. Records still require
per-record human approval and gold promotion — this grant removes the rights block, it does
**not** approve anything.

## Explicitly excluded — PowerFlex 40

`powerflex_40` (Rockwell `22B-UM001J-EN-E`) is **NOT** granted training rights, and this
exclusion is load-bearing rather than a matter of rights posture:

- Its lineage `rockwell-automation:22b-um001j-en-e` is one of exactly **five** entries in
  `_HELD_OUT_DOCS` (`factorylm_ai/dataset/technician_v0.py:94-100`).
- `paid_gate.MIN_HELD_OUT_LINEAGES = 5`.

Granting it would drop the held-out reserve to 4 and **fail `min_held_out_lineages`** — and
would additionally risk `no_held_out_contamination`, since its 25 records deterministically
assign to the `held_out` split. The evaluation reserve must remain intact for the trained
model to be measurable at all. Do not flip this source.

## Rights basis

> **REQUIRED — to be completed in Mike's own words before this dataset is used outside
> FactoryLM, published, or shipped to a customer.**
>
> `<basis pending>`

The agent preparing this record did **not** author a legal justification and must not. What
is recorded factually:

- Both documents are OEM end-user manuals distributed publicly and without charge by their
  manufacturers.
- The candidate records are **deterministic structured extractions** of pack facts
  (fault-code tables, parameter meanings) from `tools/drive-pack-extract/gold/<source>/gold.json`,
  not reproductions of manual prose or artwork.
- Public availability is **not** by itself a training licence. The determination that these
  extractions may be used as training data is a rights judgement, and it is Mike's.

Until the basis above is filled in, treat this grant as **internal-only**: fine for building
and evaluating a FactoryLM-internal v0 adapter, not cleared for external distribution of the
dataset or of a model demonstrably derived from it.

## Audit trail

- Gate constant demanding the source: `factorylm_ai/dataset/paid_gate.py:61`
- Rights resolution: `factorylm_ai/governance/rights.py:71` (`training_allowed` requires the
  flag **and** a member of `_TRAINABLE_LICENSES`)
- Source construction changed by this record: `factorylm_ai/dataset/technician_v0.py::_drive_sources`
- Held-out reserve protected by this record: `technician_v0.py:94-100`, `paid_gate.py:47`
- No spend, upload, job, endpoint, or deployment is authorised by this document. Paid
  execution remains gated on a separate signed `PaidEventAuthorization`.
