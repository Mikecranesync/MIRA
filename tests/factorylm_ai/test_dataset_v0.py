"""PR 3 tests — dataset v0 assembly + the Phase-3 paid-gate evidence.

Hermetic ($0). Covers: eligible/rejected partitioning (governance PASS + approval), typed
reject reasons (governance codes + APPROVAL_MISSING), a content-addressed manifest that hashes
the *training* content (not just the source evidence id), and the tightened paid gate — a full
PASS fixture plus an independent FAIL case for every threshold, including the re-asserted
dataset eligibility, the cost-override floor, the readiness-evidence checks, and model-support
evidence. No spend, no network — the gate is evidence only.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from factorylm_ai.adapters import (  # noqa: E402
    drive_commander_candidate,
    frozen_benchmark_candidate,
    printsense_candidate,
)
from factorylm_ai.dataset import (  # noqa: E402
    SAFETY_SENSITIVE_TAG,
    DatasetRecord,
    ModelSupportEvidence,
    ReadinessEvidence,
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
    *,
    doc: str,
    rid: str,
    interaction_type: str | None = None,
    approved_by: str | None = "mike",
    tags: tuple[str, ...] = (),
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
        tags=tags,
    )


def _source_mix() -> list[DatasetRecord]:
    """Non-training records that give the corpus build PrintSense + Drive Commander + SimLab/MIRA
    source representation. Each is governance-ineligible (a shared drive pack's rights fail closed
    with no manifest grant; SimLab/MIRA are eval-only by construction) — they contribute
    source-system coverage, never a training record."""
    dc = drive_commander_candidate(
        {"record_id": "dc-1", "manufacturer": "acme", "document_number": "dc-manual-1"}
    )
    sl = frozen_benchmark_candidate(source="simlab", ident="scenario-a")
    mi = frozen_benchmark_candidate(source="mira", ident="bench-a")
    return [DatasetRecord(candidate=c, messages=_MSGS, approved_by="mike") for c in (dc, sl, mi)]


def _passing_dataset(
    lineages: int = 20,
    per_lineage: int = 6,
    valued: int = 24,
    safety: int = 18,
    include_sources: bool = True,
) -> DatasetV0:
    docs = _train_docs(lineages)
    records: list[DatasetRecord] = []
    idx = 0
    for doc in docs:
        for _ in range(per_lineage):
            itype = "uncertainty" if idx < valued else None
            tags = (SAFETY_SENSITIVE_TAG,) if idx < safety else ()
            records.append(
                _eligible_record(doc=doc, rid=f"r-{idx}", interaction_type=itype, tags=tags)
            )
            idx += 1
    if include_sources:
        records += _source_mix()
    return assemble_dataset_v0(records)


def _model_support(
    *,
    supported: bool = True,
    model_id: str = "Qwen/Qwen3.5-9B",
    provider: str = "together",
    checked_at: str = "2026-07-22T00:00:00Z",
    method: str = "serverless-catalog",
) -> ModelSupportEvidence:
    return ModelSupportEvidence(
        model_id=model_id,
        provider=provider,
        checked_at=checked_at,
        method=method,
        supported=supported,
    )


def _readiness(
    *, held_out: int = 8, synthetic: bool = True, benchmark: bool = True
) -> ReadinessEvidence:
    return ReadinessEvidence(
        held_out_lineage_count=held_out,
        synthetic_composition_disclosed=synthetic,
        base_vs_tools_benchmark_complete=benchmark,
    )


def _pass_kwargs(**over: object) -> dict:
    """Keyword args that make the paid gate PASS, so a blocked test overrides exactly one."""
    kw: dict = {"readiness": _readiness(), "model_support": _model_support()}
    kw.update(over)
    return kw


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


def test_manifest_hashes_training_content_not_just_source_evidence() -> None:
    # FIX 1: a source with an evidence id, reused across two records whose only difference is the
    # training `messages`, must still produce DIFFERENT manifest hashes.
    doc = _train_docs(1)[0]
    cand = printsense_candidate(
        {
            "record_id": "m1",
            "manufacturer": "acme",
            "document_number": doc,
            "gold_status": "gold",
            "validation_passed": True,
            "provenance": ["p.1"],
            "license_class": "public-eval-and-train",
            "source_sha256": "a" * 64,  # an evidence id — unchanged across both records
            "rights": {"rights_resolved": True, "training_allowed": True},
        }
    )
    assert cand.evidence_id == "a" * 64
    r1 = DatasetRecord(candidate=cand, messages=_MSGS, approved_by="mike")
    r2 = DatasetRecord(
        candidate=cand,
        messages=_MSGS + [{"role": "user", "content": "and F0005?"}],
        approved_by="mike",
    )
    m1 = assemble_dataset_v0([r1]).manifest["manifest_sha256"]
    m2 = assemble_dataset_v0([r2]).manifest["manifest_sha256"]
    assert m1 != m2


# ── paid gate: the passing case ──────────────────────────────────────────────
def test_paid_gate_passes_on_a_qualifying_dataset() -> None:
    ds = _passing_dataset()
    assert ds.record_count >= 100 and ds.lineage_count >= 20 and ds.valued_interaction_count >= 20
    assert ds.safety_sensitive_count >= 15
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert report.passed and report.verdict == "PAID_GATE_PASS", report.to_dict()
    assert report.blocking == []


# ── paid gate: one independent failure per threshold ─────────────────────────
def test_paid_gate_blocks_on_too_few_records() -> None:
    docs = _train_docs(15)
    recs = [_eligible_record(doc=d, rid=f"r{i}") for i, d in enumerate(docs)]  # 15 records
    report = evaluate_paid_gate(assemble_dataset_v0(recs), **_pass_kwargs())
    assert not report.passed and "min_records" in report.blocking


def test_paid_gate_blocks_on_too_few_lineages() -> None:
    # 120 records but all one lineage → 1 lineage
    doc = _train_docs(1)[0]
    recs = [_eligible_record(doc=doc, rid=f"r{i}", interaction_type="refusal") for i in range(120)]
    report = evaluate_paid_gate(assemble_dataset_v0(recs), **_pass_kwargs())
    assert not report.passed and "min_lineages" in report.blocking


def test_paid_gate_blocks_on_nineteen_lineages() -> None:
    # FIX 4: the tightened target is >= 20 lineages; 19 must block.
    ds = _passing_dataset(lineages=19)
    assert ds.lineage_count == 19
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert not report.passed and "min_lineages" in report.blocking


def test_paid_gate_blocks_on_too_few_valued_interactions() -> None:
    ds = _passing_dataset(valued=0)  # plenty of records/lineages, zero valued
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert not report.passed and "min_valued_interactions" in report.blocking


def test_paid_gate_blocks_when_cost_exceeds_cap() -> None:
    ds = _passing_dataset()
    # a huge token count drives the estimate past the $5 cap
    report = evaluate_paid_gate(ds, train_tokens=50_000_000, **_pass_kwargs())
    assert not report.passed and "cost_within_cap" in report.blocking


def test_paid_gate_cost_override_cannot_understate_known_tokens() -> None:
    # FIX 3: a low supplied est_cost_usd must NOT let over-cap train_tokens through.
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, est_cost_usd=0.01, train_tokens=50_000_000, **_pass_kwargs())
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
    report = evaluate_paid_gate(ds, **_pass_kwargs())
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
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert not report.passed and "all_rights_training_allowed" in report.blocking


# ── paid gate: dataset-eligibility re-assertion (FIX 2) ──────────────────────
def test_paid_gate_blocks_unapproved_record_smuggled_into_eligible() -> None:
    unapproved = _eligible_record(doc=_train_docs(1)[0], rid="u1", approved_by=None)
    ds = DatasetV0(dataset_version="v0", eligible=[unapproved], rejected=[], manifest={})
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert not report.passed and "all_records_dataset_eligible" in report.blocking


def test_paid_gate_blocks_governance_ineligible_record_smuggled_into_eligible() -> None:
    eval_only = DatasetRecord(
        candidate=printsense_candidate(
            {"record_id": "e", "manufacturer": "acme", "document_number": "z-3", "eval_only": True}
        ),
        messages=_MSGS,
        approved_by="mike",  # approved, but the source is not training-eligible
    )
    ds = DatasetV0(dataset_version="v0", eligible=[eval_only], rejected=[], manifest={})
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert not report.passed and "all_records_dataset_eligible" in report.blocking


# ── paid gate: readiness-evidence checks (FIX 5) ─────────────────────────────
def test_paid_gate_blocks_on_too_few_held_out_lineages() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, **_pass_kwargs(readiness=_readiness(held_out=3)))
    assert not report.passed and "min_held_out_lineages" in report.blocking


def test_paid_gate_blocks_on_too_few_safety_sensitive() -> None:
    ds = _passing_dataset(safety=5)  # only 5 tagged safety-sensitive
    assert ds.safety_sensitive_count == 5
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert not report.passed and "min_safety_sensitive" in report.blocking


def test_paid_gate_blocks_on_missing_source_representation() -> None:
    ds = _passing_dataset(include_sources=False)  # printsense only
    assert ds.source_systems == {"printsense"}
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert not report.passed and "source_representation" in report.blocking


def test_paid_gate_blocks_when_synthetic_composition_undisclosed() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, **_pass_kwargs(readiness=_readiness(synthetic=False)))
    assert not report.passed and "synthetic_composition_disclosed" in report.blocking


def test_paid_gate_blocks_when_base_vs_tools_benchmark_incomplete() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, **_pass_kwargs(readiness=_readiness(benchmark=False)))
    assert not report.passed and "base_vs_tools_benchmark_complete" in report.blocking


# ── paid gate: model-support evidence (FIX 6) ────────────────────────────────
def test_paid_gate_blocks_on_missing_model_support_evidence() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, readiness=_readiness(), model_support=None)
    assert not report.passed and "model_support_confirmed" in report.blocking


def test_paid_gate_blocks_on_incomplete_model_support_evidence() -> None:
    ds = _passing_dataset()
    incomplete = ModelSupportEvidence(
        model_id="Qwen/Qwen3.5-9B", provider="", checked_at="", method="", supported=True
    )
    report = evaluate_paid_gate(ds, **_pass_kwargs(model_support=incomplete))
    assert not report.passed and "model_support_confirmed" in report.blocking


def test_paid_gate_blocks_on_unsupported_model() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, **_pass_kwargs(model_support=_model_support(supported=False)))
    assert not report.passed and "model_support_confirmed" in report.blocking


def test_paid_gate_passes_with_complete_model_support_evidence() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, **_pass_kwargs(model_support=_model_support()))
    assert report.passed and report.blocking == [], report.to_dict()


# ── cost estimator ───────────────────────────────────────────────────────────
def test_finetune_cost_is_floored_and_scales() -> None:
    # a tiny job floors at the minimum; a large token count scales above it
    assert estimate_finetune_cost(1_000) == 4.00  # FT_MIN_JOB_USD floor
    assert estimate_finetune_cost(50_000_000, epochs=3) > 5.00
