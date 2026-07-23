"""PR 3 tests — dataset v0 assembly + the Phase-3 paid-gate evidence.

Hermetic ($0). Covers: eligible/rejected partitioning (governance PASS + approval), typed
reject reasons (governance codes + APPROVAL_MISSING), reproducible manifest, and the paid
gate — a full PASS fixture plus an independent FAIL case for each of the seven thresholds.
No spend, no network — the gate is evidence only.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from factorylm_ai.adapters import printsense_candidate  # noqa: E402
from factorylm_ai.dataset import (  # noqa: E402
    DatasetRecord,
    assemble_dataset_v0,
    estimate_finetune_cost,
    evaluate_paid_gate,
)
from factorylm_ai.dataset.assemble import APPROVAL_MISSING, DatasetV0  # noqa: E402
from factorylm_ai.governance import lineage as ln  # noqa: E402
from factorylm_ai.governance import rejection_codes as rc  # noqa: E402

_MSGS = [
    {"role": "user", "content": "GS10 shows F0004 — what should I check?"},
    {"role": "assistant", "content": "Cited from the manual: F0004 is an overcurrent trip..."},
]


# ── builders ─────────────────────────────────────────────────────────────────
def _train_docs(n: int) -> list[str]:
    """`n` deterministic document numbers whose public lineage hashes to `train`."""
    out: list[str] = []
    i = 0
    while len(out) < n:
        doc = f"doc-{i}"
        if ln.assign_split(ln.public_lineage_key("acme", doc)) == "train":
            out.append(doc)
        i += 1
    return out


def _eligible_record(
    *, doc: str, rid: str, interaction_type: str | None = None, approved_by: str | None = "mike"
) -> DatasetRecord:
    cand = printsense_candidate(
        {
            "record_id": rid,
            "manufacturer": "acme",
            "document_number": doc,
            "gold_status": "gold",
            "validation_passed": True,
            "safety_status": "clear",
            "provenance": ["manual p.12"],
            "license_class": "public-eval-and-train",
            "rights": {
                "rights_resolved": True,
                "training_allowed": True,
                "evaluation_allowed": True,
                "public_export_allowed": True,
                "derivatives_retained": True,
            },
        }
    )
    return DatasetRecord(
        candidate=cand,
        messages=_MSGS,
        approved_by=approved_by,
        interaction_type=interaction_type,
    )


def _passing_dataset(lineages: int = 20, per_lineage: int = 6, valued: int = 24) -> DatasetV0:
    docs = _train_docs(lineages)
    records: list[DatasetRecord] = []
    idx = 0
    for doc in docs:
        for k in range(per_lineage):
            itype = "uncertainty" if idx < valued else None
            records.append(_eligible_record(doc=doc, rid=f"r-{idx}", interaction_type=itype))
            idx += 1
    return assemble_dataset_v0(records)


# ── assembly ─────────────────────────────────────────────────────────────────
def test_assemble_partitions_eligible_and_rejected() -> None:
    good = _eligible_record(doc=_train_docs(1)[0], rid="g1", interaction_type="refusal")
    # ineligible source (public-eval-only → not trainable) but approved
    eval_only = DatasetRecord(
        candidate=printsense_candidate(
            {"record_id": "e1", "manufacturer": "acme", "document_number": "z-1", "eval_only": True}
        ),
        messages=_MSGS,
        approved_by="mike",
    )
    # eligible source but NOT approved
    unapproved = _eligible_record(doc=_train_docs(1)[0], rid="u1", approved_by=None)

    ds = assemble_dataset_v0([good, eval_only, unapproved])
    assert [r.record_id for r in ds.eligible] == ["g1"]
    by_id = {r.record_id: r for r in ds.rejected}
    assert rc.TRAINING_NOT_ALLOWED in by_id["e1"].codes
    assert APPROVAL_MISSING in by_id["u1"].codes and by_id["u1"].approved is False
    # the eligible one is not in the reject list
    assert "g1" not in by_id


def test_assemble_manifest_is_reproducible_regardless_of_order() -> None:
    docs = _train_docs(3)
    recs = [_eligible_record(doc=d, rid=f"r{i}") for i, d in enumerate(docs)]
    m1 = assemble_dataset_v0(recs).manifest
    m2 = assemble_dataset_v0(list(reversed(recs))).manifest
    assert m1["manifest_sha256"] == m2["manifest_sha256"]
    assert m1["lineage_count"] == 3 and m1["record_count"] == 3


# ── paid gate: the passing case ──────────────────────────────────────────────
def test_paid_gate_passes_on_a_qualifying_dataset() -> None:
    ds = _passing_dataset()
    assert ds.record_count >= 100 and ds.lineage_count >= 15 and ds.valued_interaction_count >= 20
    report = evaluate_paid_gate(ds, model_support_confirmed=True)
    assert report.passed and report.verdict == "PAID_GATE_PASS", report.to_dict()
    assert report.blocking == []


# ── paid gate: one independent failure per threshold ─────────────────────────
def test_paid_gate_blocks_on_too_few_records() -> None:
    docs = _train_docs(15)
    recs = [_eligible_record(doc=d, rid=f"r{i}") for i, d in enumerate(docs)]  # 15 records
    report = evaluate_paid_gate(assemble_dataset_v0(recs), model_support_confirmed=True)
    assert not report.passed and "min_records" in report.blocking


def test_paid_gate_blocks_on_too_few_lineages() -> None:
    # 120 records but all one lineage → 1 lineage
    doc = _train_docs(1)[0]
    recs = [_eligible_record(doc=doc, rid=f"r{i}", interaction_type="refusal") for i in range(120)]
    report = evaluate_paid_gate(assemble_dataset_v0(recs), model_support_confirmed=True)
    assert not report.passed and "min_lineages" in report.blocking


def test_paid_gate_blocks_on_too_few_valued_interactions() -> None:
    ds = _passing_dataset(valued=0)  # plenty of records/lineages, zero valued
    report = evaluate_paid_gate(ds, model_support_confirmed=True)
    assert not report.passed and "min_valued_interactions" in report.blocking


def test_paid_gate_blocks_on_unconfirmed_model_support() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, model_support_confirmed=False)
    assert not report.passed and "model_support_confirmed" in report.blocking


def test_paid_gate_blocks_when_cost_exceeds_cap() -> None:
    ds = _passing_dataset()
    # a huge token count drives the estimate past the $5 cap
    report = evaluate_paid_gate(ds, train_tokens=50_000_000, model_support_confirmed=True)
    assert not report.passed and "cost_within_cap" in report.blocking


def test_paid_gate_blocks_on_held_out_contamination() -> None:
    # hand-build a dataset with an eligible record forced onto a non-train lineage to prove the
    # contamination check fires even if assembly somehow admitted it.
    held_key = next(
        ln.public_lineage_key("acme", f"h-{i}")
        for i in range(500)
        if ln.assign_split(ln.public_lineage_key("acme", f"h-{i}")) == "held_out"
    )
    contam = DatasetRecord(
        candidate=printsense_candidate(
            {
                "record_id": "bad",
                "manufacturer": "acme",
                "document_number": held_key.split(":", 1)[1],
                "gold_status": "gold",
                "validation_passed": True,
                "provenance": ["x"],
                "license_class": "public-eval-and-train",
                "rights": {"rights_resolved": True, "training_allowed": True},
            }
        ),
        messages=_MSGS,
        approved_by="mike",
    )
    ds = DatasetV0(dataset_version="v0", eligible=[contam], rejected=[], manifest={})
    report = evaluate_paid_gate(ds, model_support_confirmed=True)
    assert not report.passed and "no_held_out_contamination" in report.blocking


def test_paid_gate_blocks_on_rights_not_training_allowed() -> None:
    # directly exercise the rights re-assertion with a hand-placed eval-only record in eligible
    eval_only = DatasetRecord(
        candidate=printsense_candidate(
            {"record_id": "e", "manufacturer": "acme", "document_number": "z-9", "eval_only": True}
        ),
        messages=_MSGS,
        approved_by="mike",
    )
    ds = DatasetV0(dataset_version="v0", eligible=[eval_only], rejected=[], manifest={})
    report = evaluate_paid_gate(ds, model_support_confirmed=True)
    assert not report.passed and "all_rights_training_allowed" in report.blocking


# ── cost estimator ───────────────────────────────────────────────────────────
def test_finetune_cost_is_floored_and_scales() -> None:
    # a tiny job floors at the minimum; a large token count scales above it
    assert estimate_finetune_cost(1_000) == 4.00  # FT_MIN_JOB_USD floor
    assert estimate_finetune_cost(50_000_000, epochs=3) > 5.00
