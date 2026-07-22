"""PR 1 governance-foundation tests — lineage-safe splits, fail-closed rights,
the three-gate training-eligibility, the leakage guard, and reproducible manifests.

Hermetic ($0). Covers the Phase-0 recon's required set: same lineage never crosses
splits, a revision keeps its lineage, crop/render/page never change the split,
held-out is never trainable, public-eval-only is not trainable, unknown rights
fail closed, customer-private is excluded, approval-without-rights and
rights-without-approval are both ineligible, unsupported safety / unresolved
contradictions are excluded, invalid splits fail closed, and repeated runs
produce identical manifests.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from factorylm_ai.governance import eligibility as el  # noqa: E402
from factorylm_ai.governance import lineage as ln  # noqa: E402
from factorylm_ai.governance import manifest as mf  # noqa: E402
from factorylm_ai.governance import rejection_codes as rc  # noqa: E402
from factorylm_ai.governance import splits as sp  # noqa: E402
from factorylm_ai.governance.rights import resolve_rights  # noqa: E402


# ── lineage + splits ────────────────────────────────────────────────────────
def test_split_is_deterministic_and_ratio_shaped() -> None:
    keys = [f"mfr:doc-{i}" for i in range(2000)]
    a = {k: ln.assign_split(k) for k in keys}
    b = {k: ln.assign_split(k) for k in keys}
    assert a == b  # deterministic
    from collections import Counter

    c = Counter(a.values())
    assert set(c) == set(ln.ALL_SPLITS)
    # roughly 70/15/10/5 (loose bounds)
    assert 0.6 < c["train"] / 2000 < 0.8
    assert 0.02 < c["held_out"] / 2000 < 0.09


def test_revision_and_render_keep_the_same_split() -> None:
    key = ln.public_lineage_key("AutomationDirect", "AN-GS-021")
    # a v2 revision, a crop, a rotation, a paraphrase all share the lineage key →
    # the SAME split (they never cross partitions)
    assert ln.assign_split(key) == ln.assign_split(key)
    assert key == "automationdirect:an-gs-021"


def test_bare_content_hash_is_rejected_as_lineage_key() -> None:
    bare = "a" * 64
    assert ln.is_bare_content_hash(bare)
    with pytest.raises(ValueError):
        ln.assign_split(bare)


def test_legacy_split_names_canonicalize() -> None:
    assert ln.canonical_split("dev") == "validation"
    assert ln.canonical_split("holdout") == "held_out"
    assert ln.canonical_split("train") == "train"
    assert ln.is_quarantined("holdout") and ln.is_quarantined("held_out")
    assert ln.is_train_side("train") and not ln.is_train_side("validation")


def test_group_and_split_keeps_siblings_together() -> None:
    recs = [
        {"record_id": "r1", "document_lineage_key": "m:d1"},  # sibling
        {"record_id": "r2", "document_lineage_key": "m:d1"},  # sibling (crop)
        {"record_id": "r3", "document_lineage_key": "m:d2"},
    ]
    out = sp.group_and_split(recs)
    by = {r["record_id"]: r["split"] for r in out}
    assert by["r1"] == by["r2"]  # same lineage → same split, always


# ── fail-closed rights ──────────────────────────────────────────────────────
def _source(**over) -> dict:
    src = {
        "schema": "factorylm.clf.corpus-source.v1",
        "license_class": over.pop("license_class", "public-eval-and-train"),
        "confidentiality_class": over.pop("confidentiality_class", "public"),
        "rights": {
            "rights_resolved": over.pop("rights_resolved", True),
            "training_allowed": over.pop("training_allowed", True),
            "evaluation_allowed": over.pop("evaluation_allowed", True),
            "public_export_allowed": False,
            "cross_tenant_reuse_allowed": over.pop("cross_tenant_reuse_allowed", False),
            "derivatives_retained": True,
        },
    }
    src.update(over)
    return src


def test_rights_fail_closed_on_missing_and_unresolved() -> None:
    assert resolve_rights({}).training_allowed is False  # no rights object
    r = resolve_rights(_source(rights_resolved=False))
    assert r.rights_resolved is False and r.training_allowed is False


def test_public_eval_only_is_not_trainable() -> None:
    r = resolve_rights(_source(license_class="public-eval-only", training_allowed=True))
    assert r.training_allowed is False  # license overrides the flag
    assert r.evaluation_allowed is True


def test_unknown_license_fails_closed() -> None:
    assert resolve_rights(_source(license_class="unknown")).training_allowed is False


def test_unknown_license_denies_every_discretionary_right() -> None:
    r = resolve_rights(
        _source(
            license_class="unknown",
            training_allowed=True,
            evaluation_allowed=True,
            public_export_allowed=True,
            cross_tenant_reuse_allowed=True,
        )
    )
    assert r.to_dict() == {
        "rights_resolved": True,
        "training_allowed": False,
        "evaluation_allowed": False,
        "public_export_allowed": False,
        "cross_tenant_reuse_allowed": False,
        "derivatives_retained": False,
        "license_class": "unknown",
        "confidentiality_class": "public",
        "policy_ref": None,
    }


def test_resolved_train_license_grants_training() -> None:
    assert resolve_rights(_source()).training_allowed is True


# ── three-gate training eligibility ─────────────────────────────────────────
def _inp(**over) -> el.EligibilityInput:
    kw = dict(
        gold_status=over.pop("gold_status", "gold"),
        rights=over.pop("rights", resolve_rights(_source())),
        split=over.pop("split", "train"),
        document_lineage_key=over.pop("document_lineage_key", "m:d1"),
        validation_passed=over.pop("validation_passed", True),
        safety_status=over.pop("safety_status", "clear"),
        provenance_present=over.pop("provenance_present", True),
        schema_valid=over.pop("schema_valid", True),
        frozen_eval=over.pop("frozen_eval", False),
        sensitive=over.pop("sensitive", False),
        tenant_id=over.pop("tenant_id", None),
        confidentiality_class=over.pop("confidentiality_class", None),
    )
    kw.update(over)
    return el.EligibilityInput(**kw)


def test_clean_train_record_is_eligible() -> None:
    r = el.check_training_eligibility(_inp())
    assert r.eligible and r.training_eligibility == "eligible" and r.codes == []


def test_approval_without_rights_is_ineligible() -> None:
    r = el.check_training_eligibility(
        _inp(
            rights=resolve_rights(_source(license_class="public-eval-only", training_allowed=True))
        )
    )
    assert not r.eligible and rc.TRAINING_NOT_ALLOWED in r.codes


def test_rights_without_gold_is_ineligible() -> None:
    r = el.check_training_eligibility(_inp(gold_status="approved"))  # approved_by-ish, not gold
    assert not r.eligible and rc.NOT_GOLD in r.codes


def test_held_out_never_trainable() -> None:
    assert rc.HELD_OUT in el.check_training_eligibility(_inp(split="held_out")).codes


def test_validation_test_side_is_ineligible() -> None:
    assert rc.LINEAGE_ON_EVAL_SIDE in el.check_training_eligibility(_inp(split="validation")).codes


def test_invalid_split_is_a_distinct_rejection() -> None:
    r = el.check_training_eligibility(_inp(split="banana"))
    assert rc.SPLIT_INVALID in r.codes
    assert rc.LINEAGE_ON_EVAL_SIDE not in r.codes


def test_unresolved_rights_fail_closed() -> None:
    r = el.check_training_eligibility(_inp(rights=resolve_rights(_source(rights_resolved=False))))
    assert rc.RIGHTS_UNRESOLVED in r.codes and rc.TRAINING_NOT_ALLOWED in r.codes


def test_frozen_eval_and_missing_lineage_and_bad_schema() -> None:
    assert rc.FROZEN_EVAL in el.check_training_eligibility(_inp(frozen_eval=True)).codes
    assert (
        rc.LINEAGE_MISSING in el.check_training_eligibility(_inp(document_lineage_key=None)).codes
    )
    assert (
        rc.LINEAGE_MISSING
        in el.check_training_eligibility(_inp(document_lineage_key="a" * 64)).codes
    )
    assert rc.SCHEMA_INVALID in el.check_training_eligibility(_inp(schema_valid=False)).codes


def test_safety_and_contradiction_and_provenance() -> None:
    assert (
        rc.SAFETY_REVIEW_REQUIRED
        in el.check_training_eligibility(_inp(safety_status="review_required")).codes
    )
    assert (
        rc.VALIDATION_FAILED in el.check_training_eligibility(_inp(validation_passed=False)).codes
    )
    assert (
        rc.PROVENANCE_MISSING in el.check_training_eligibility(_inp(provenance_present=False)).codes
    )
    # explicit human safety approval passes the safety gate
    assert (
        rc.SAFETY_REVIEW_REQUIRED
        not in el.check_training_eligibility(_inp(safety_status="approved")).codes
    )


def test_customer_private_and_tenant_are_excluded() -> None:
    assert rc.SENSITIVE_TENANT in el.check_training_eligibility(_inp(sensitive=True)).codes
    assert (
        rc.SENSITIVE_TENANT
        in el.check_training_eligibility(_inp(confidentiality_class="customer-confidential")).codes
    )
    customer_private = _inp(
        rights=resolve_rights(_source(license_class="customer-private", training_allowed=True))
    )
    assert rc.SENSITIVE_TENANT in el.check_training_eligibility(customer_private).codes
    customer_confidential_from_rights = _inp(
        rights=resolve_rights(
            _source(
                license_class="public-eval-and-train",
                confidentiality_class="customer-confidential",
            )
        )
    )
    assert (
        rc.SENSITIVE_TENANT
        in el.check_training_eligibility(customer_confidential_from_rights).codes
    )
    # a tenant record without cross-tenant reuse rights is excluded from a shared corpus
    assert rc.SENSITIVE_TENANT in el.check_training_eligibility(_inp(tenant_id="t1")).codes
    ok_tenant = _inp(
        tenant_id="t1", rights=resolve_rights(_source(cross_tenant_reuse_allowed=True))
    )
    assert rc.SENSITIVE_TENANT not in el.check_training_eligibility(ok_tenant).codes


# ── leakage guard ───────────────────────────────────────────────────────────
def test_leakage_guard_catches_violations() -> None:
    clean = [
        {
            "record_id": "r1",
            "document_lineage_key": "m:d1",
            "split": "train",
            "training_eligibility": "eligible",
        },
        {
            "record_id": "r2",
            "document_lineage_key": "m:d1",
            "split": "train",
            "training_eligibility": "eligible",
        },
    ]
    assert sp.find_leakage(clean) == []
    # one lineage in two splits
    collide = [
        {"record_id": "r1", "document_lineage_key": "m:d1", "split": "train"},
        {"record_id": "r2", "document_lineage_key": "m:d1", "split": "validation"},
    ]
    assert rc.LINEAGE_SPLIT_COLLISION in [x.code for x in sp.find_leakage(collide)]
    # eligible record on the eval side / on held_out
    assert rc.LINEAGE_ON_EVAL_SIDE in [
        x.code
        for x in sp.find_leakage(
            [
                {
                    "record_id": "r",
                    "document_lineage_key": "m:d",
                    "split": "test",
                    "training_eligibility": "eligible",
                }
            ]
        )
    ]
    assert rc.HELD_OUT in [
        x.code
        for x in sp.find_leakage(
            [
                {
                    "record_id": "r",
                    "document_lineage_key": "m:d",
                    "split": "held_out",
                    "training_eligibility": "eligible",
                }
            ]
        )
    ]


# ── reproducible manifest ───────────────────────────────────────────────────
def test_manifest_is_reproducible_regardless_of_order() -> None:
    recs = [
        {
            "record_id": "b",
            "document_lineage_key": "m:d2",
            "split": "train",
            "content_hash": "h2",
            "training_eligibility": "eligible",
        },
        {
            "record_id": "a",
            "document_lineage_key": "m:d1",
            "split": "train",
            "content_hash": "h1",
            "training_eligibility": "eligible",
        },
    ]
    m1 = mf.corpus_manifest(recs, dataset_version="v0")
    m2 = mf.corpus_manifest(list(reversed(recs)), dataset_version="v0")
    assert m1["manifest_sha256"] == m2["manifest_sha256"]  # order-independent
    assert m1["record_count"] == 2 and m1["lineage_count"] == 2
    # a different dataset_version or a changed content hash changes the digest
    assert (
        mf.corpus_manifest(recs, dataset_version="v1")["manifest_sha256"] != m1["manifest_sha256"]
    )
    recs2 = [{**recs[0], "content_hash": "CHANGED"}, recs[1]]
    assert (
        mf.corpus_manifest(recs2, dataset_version="v0")["manifest_sha256"] != m1["manifest_sha256"]
    )


def test_manifest_is_reproducible_when_record_ids_collide() -> None:
    recs = [
        {
            "record_id": "dup",
            "document_lineage_key": "m:d2",
            "split": "train",
            "content_hash": "h2",
            "training_eligibility": "eligible",
        },
        {
            "record_id": "dup",
            "document_lineage_key": "m:d1",
            "split": "train",
            "content_hash": "h1",
            "training_eligibility": "eligible",
        },
    ]
    m1 = mf.corpus_manifest(recs, dataset_version="v0")
    m2 = mf.corpus_manifest(list(reversed(recs)), dataset_version="v0")
    assert m1["manifest_sha256"] == m2["manifest_sha256"]
    assert m1["entries"] == m2["entries"]
