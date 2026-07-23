"""PR 3 tests — dataset v0 assembly + the Phase-3 paid-gate evidence.

Hermetic ($0). Covers: eligible/rejected partitioning (governance PASS + approval), typed
reject reasons (governance codes + APPROVAL_MISSING), a content-addressed manifest that hashes
the *training* content (not just the source evidence id), and the tightened, fixed-policy paid
gate — a full PASS fixture plus an independent FAIL case for every check, including the
adversarial-review regressions: rejected records must NOT satisfy trainable source
representation, and model-support evidence must name the intended target. No spend, no network.
"""

from __future__ import annotations

import inspect
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from factorylm_ai.adapters import (  # noqa: E402
    drive_commander_candidate,
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
def _docs_for_split(prefix: str, n: int, split: str) -> list[str]:
    """`n` deterministic document numbers whose public ("acme") lineage hashes to `split`."""
    out: list[str] = []
    i = 0
    while len(out) < n:
        doc = f"{prefix}-{i}"
        if ln.assign_split(ln.public_lineage_key("acme", doc)) == split:
            out.append(doc)
        i += 1
    return out


def _train_docs(n: int) -> list[str]:
    return _docs_for_split("doc", n, "train")


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


def _eligible_drive_commander_record(rid: str = "dc-elig") -> DatasetRecord:
    """A trainable Drive Commander shared pack (manifest grants a resolved public-train license)
    on a train-side lineage — a genuine eligible training record."""
    doc = _docs_for_split("dc", 1, "train")[0]
    cand = drive_commander_candidate(
        {
            "record_id": rid,
            "manufacturer": "acme",
            "document_number": doc,
            "gold_status": "gold",
            "validation_passed": True,
            "provenance": ["dc manual p.3"],
            "manifest": {
                "license_class": "public-eval-and-train",
                "confidentiality_class": "public",
                "rights": {
                    "rights_resolved": True,
                    "training_allowed": True,
                    "evaluation_allowed": True,
                    "public_export_allowed": True,
                },
            },
        }
    )
    return DatasetRecord(candidate=cand, messages=_MSGS, approved_by="mike")


def _passing_dataset(
    lineages: int = 21,
    per_lineage: int = 6,
    valued: int = 24,
    safety: int = 18,
    dc_eligible: bool = True,
) -> DatasetV0:
    """`lineages` is the TOTAL distinct eligible lineages; when ``dc_eligible`` one of them is a
    trainable Drive Commander lineage and the rest are PrintSense."""
    ps_lineages = lineages - (1 if dc_eligible else 0)
    docs = _train_docs(ps_lineages)
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
    if dc_eligible:
        records.append(_eligible_drive_commander_record())
    return assemble_dataset_v0(records)


def _held_out_keys(n: int = 6) -> tuple[str, ...]:
    return tuple(ln.public_lineage_key("acme", d) for d in _docs_for_split("ho", n, "held_out"))


def _model_support(
    *,
    supported: bool = True,
    model_id: str = "Qwen/Qwen3.5-9B",
    provider: str = "together",
    checked_at: str = "2026-07-22T00:00:00+00:00",
    method: str = "serverless-catalog",
    receipt_ref: str | None = None,
) -> ModelSupportEvidence:
    return ModelSupportEvidence(
        model_id=model_id,
        provider=provider,
        checked_at=checked_at,
        method=method,
        supported=supported,
        receipt_ref=receipt_ref,
    )


def _readiness(**over: object) -> ReadinessEvidence:
    kw: dict = {
        "held_out_lineage_keys": _held_out_keys(),
        "synthetic_composition_report_ref": "s3://reports/synth-composition-2026-07-22.json",
        "base_vs_tools_benchmark_ref": "s3://reports/base-vs-tools-2026-07-22.json",
        "rights_report_ref": "s3://reports/rights-2026-07-22.json",
        "frozen_benchmark_baseline_ref": "s3://reports/frozen-baseline-2026-07-22.json",
    }
    kw.update(over)
    return ReadinessEvidence(**kw)


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
    assert ds.source_systems == {"printsense"}  # only the eligible record's source counts
    by_id = {r.record_id: r for r in ds.rejected}
    assert rc.TRAINING_NOT_ALLOWED in by_id["e1"].codes
    assert APPROVAL_MISSING in by_id["u1"].codes and by_id["u1"].approved is False
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
    assert {"printsense", "drive_commander"} <= ds.source_systems
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert report.passed and report.verdict == "PAID_GATE_PASS", report.to_dict()
    assert report.blocking == []


# ── paid gate: one independent failure per check ─────────────────────────────
def test_paid_gate_blocks_on_too_few_records() -> None:
    docs = _train_docs(15)
    recs = [_eligible_record(doc=d, rid=f"r{i}") for i, d in enumerate(docs)]  # 15 records
    report = evaluate_paid_gate(assemble_dataset_v0(recs), **_pass_kwargs())
    assert not report.passed and "min_records" in report.blocking


def test_paid_gate_blocks_on_too_few_lineages() -> None:
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
    ds = _passing_dataset(valued=0)
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert not report.passed and "min_valued_interactions" in report.blocking


def test_paid_gate_blocks_when_cost_exceeds_cap() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, train_tokens=50_000_000, **_pass_kwargs())
    assert not report.passed and "cost_within_cap" in report.blocking


def test_paid_gate_cost_override_cannot_understate_known_tokens() -> None:
    # FIX 3 (original): a low supplied est_cost_usd must NOT let over-cap train_tokens through.
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, est_cost_usd=0.01, train_tokens=50_000_000, **_pass_kwargs())
    assert not report.passed and "cost_within_cap" in report.blocking


def test_paid_gate_blocks_on_held_out_contamination() -> None:
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


def test_paid_gate_blocks_when_rights_report_ref_missing() -> None:
    # FIX 4: the rights check also requires a rights report reference.
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, **_pass_kwargs(readiness=_readiness(rights_report_ref=None)))
    assert not report.passed and "all_rights_training_allowed" in report.blocking


# ── paid gate: dataset-eligibility re-assertion (FIX 2 original) ──────────────
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
        approved_by="mike",
    )
    ds = DatasetV0(dataset_version="v0", eligible=[eval_only], rejected=[], manifest={})
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert not report.passed and "all_records_dataset_eligible" in report.blocking


# ── paid gate: readiness-evidence checks ─────────────────────────────────────
def test_paid_gate_blocks_on_too_few_held_out_lineages() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(
        ds, **_pass_kwargs(readiness=_readiness(held_out_lineage_keys=_held_out_keys(3)))
    )
    assert not report.passed and "min_held_out_lineages" in report.blocking


def test_paid_gate_blocks_on_invalid_held_out_keys() -> None:
    # ADVERSARIAL (FIX 4): a "held-out" key that actually assigns to train must not count.
    ds = _passing_dataset()
    train_key = ln.public_lineage_key("acme", _train_docs(1)[0])
    assert ln.assign_split(train_key) == "train"
    bad = (*_held_out_keys(5), train_key)  # 6 keys, but one is train-split
    report = evaluate_paid_gate(ds, **_pass_kwargs(readiness=_readiness(held_out_lineage_keys=bad)))
    assert not report.passed and "min_held_out_lineages" in report.blocking


def test_paid_gate_blocks_on_too_few_safety_sensitive() -> None:
    ds = _passing_dataset(safety=5)
    assert ds.safety_sensitive_count == 5
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert not report.passed and "min_safety_sensitive" in report.blocking


def test_paid_gate_blocks_on_missing_trainable_source_representation() -> None:
    ds = _passing_dataset(dc_eligible=False)  # printsense only in the eligible set
    assert ds.source_systems == {"printsense"}
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert not report.passed and "trainable_source_representation" in report.blocking


def test_source_representation_not_satisfied_by_rejected_drive_commander() -> None:
    # ADVERSARIAL FINDING 1: a REJECTED Drive Commander record (no manifest rights → fail closed)
    # must NOT satisfy trainable source representation while the eligible set is all PrintSense.
    docs = _train_docs(20)
    recs: list[DatasetRecord] = []
    idx = 0
    for doc in docs:
        for _ in range(6):
            recs.append(
                _eligible_record(
                    doc=doc,
                    rid=f"r-{idx}",
                    interaction_type="uncertainty" if idx < 24 else None,
                    tags=(SAFETY_SENSITIVE_TAG,) if idx < 18 else (),
                )
            )
            idx += 1
    dc_rejected = DatasetRecord(
        candidate=drive_commander_candidate(
            {"record_id": "dc-bad", "manufacturer": "acme", "document_number": "dc-rej-1"}
        ),  # no manifest → rights fail closed → rejected
        messages=_MSGS,
        approved_by="mike",
    )
    ds = assemble_dataset_v0(recs + [dc_rejected])
    assert "drive_commander" not in ds.source_systems  # rejected → not counted
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    assert not report.passed and "trainable_source_representation" in report.blocking


def test_paid_gate_blocks_when_frozen_benchmark_baseline_missing() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(
        ds, **_pass_kwargs(readiness=_readiness(frozen_benchmark_baseline_ref=None))
    )
    assert not report.passed and "frozen_benchmark_baseline" in report.blocking


def test_paid_gate_blocks_when_synthetic_composition_undisclosed() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(
        ds, **_pass_kwargs(readiness=_readiness(synthetic_composition_report_ref=None))
    )
    assert not report.passed and "synthetic_composition_disclosed" in report.blocking


def test_paid_gate_blocks_when_base_vs_tools_benchmark_incomplete() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(
        ds, **_pass_kwargs(readiness=_readiness(base_vs_tools_benchmark_ref=None))
    )
    assert not report.passed and "base_vs_tools_benchmark_complete" in report.blocking


# ── paid gate: model-support evidence (FIX 2 / adversarial FINDING 2) ─────────
def test_paid_gate_blocks_on_missing_model_support_evidence() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, readiness=_readiness(), model_support=None)
    assert not report.passed and "model_support_confirmed" in report.blocking


def test_paid_gate_blocks_on_unsupported_model() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, **_pass_kwargs(model_support=_model_support(supported=False)))
    assert not report.passed and "model_support_confirmed" in report.blocking


def test_paid_gate_blocks_on_wrong_model() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(
        ds, **_pass_kwargs(model_support=_model_support(model_id="Some/Other-70B"))
    )
    assert not report.passed and "model_support_confirmed" in report.blocking


def test_paid_gate_blocks_on_wrong_provider() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(
        ds, **_pass_kwargs(model_support=_model_support(provider="not-together"))
    )
    assert not report.passed and "model_support_confirmed" in report.blocking


def test_paid_gate_blocks_on_invalid_checked_at_timestamp() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(
        ds, **_pass_kwargs(model_support=_model_support(checked_at="not-a-date"))
    )
    assert not report.passed and "model_support_confirmed" in report.blocking


def test_paid_gate_blocks_on_unrecognized_method_without_receipt() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, **_pass_kwargs(model_support=_model_support(method="trust-me")))
    assert not report.passed and "model_support_confirmed" in report.blocking


def test_paid_gate_accepts_unrecognized_method_with_receipt_ref() -> None:
    ds = _passing_dataset()
    ms = _model_support(method="manual-review", receipt_ref="s3://receipts/together-qwen.json")
    report = evaluate_paid_gate(ds, **_pass_kwargs(model_support=ms))
    assert report.passed and report.blocking == [], report.to_dict()


def test_paid_gate_passes_with_complete_model_support_evidence() -> None:
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, **_pass_kwargs(model_support=_model_support()))
    assert report.passed and report.blocking == [], report.to_dict()


# ── fixed policy (FIX 3) + auditable evidence (FIX 4) ────────────────────────
def test_paid_gate_has_no_policy_override_knobs() -> None:
    # FIX 3: thresholds/cap/epochs are fixed module policy, not caller-relaxable parameters.
    params = set(inspect.signature(evaluate_paid_gate).parameters)
    forbidden = {
        "cost_cap_usd",
        "min_records",
        "min_lineages",
        "min_valued",
        "min_held_out",
        "min_safety_sensitive",
        "epochs",
    }
    assert not (params & forbidden), sorted(params & forbidden)


def test_paid_gate_report_includes_auditable_evidence_refs() -> None:
    # FIX 4: the report exposes the audit refs so a PASS is inspectable, not opaque.
    ds = _passing_dataset()
    report = evaluate_paid_gate(ds, **_pass_kwargs())
    ev = report.to_dict()["evidence"]
    for k in (
        "held_out_lineage_keys",
        "rights_report_ref",
        "frozen_benchmark_baseline_ref",
        "synthetic_composition_report_ref",
        "base_vs_tools_benchmark_ref",
        "eligible_source_systems",
        "est_cost_usd",
        "model_support",
    ):
        assert k in ev, k
    assert ev["model_support"]["confirmed"] is True
    assert ev["held_out_lineage_count"] >= 5


# ── cost estimator ───────────────────────────────────────────────────────────
def test_finetune_cost_is_floored_and_scales() -> None:
    assert estimate_finetune_cost(1_000) == 4.00  # FT_MIN_JOB_USD floor
    assert estimate_finetune_cost(50_000_000, epochs=3) > 5.00
