"""PR 2 corpus-adapter tests — the three adapters lower real sources into the PR-1 gate.

Hermetic ($0). Covers the required set: candidate → EligibilityInput mapping for each
adapter, public vs tenant lineage keys, rights fail-closed, tenant/private data ineligible
for shared training, SimLab/frozen sources un-trainable by construction, content/pack hashes
kept as evidence (never lineage), and the leakage guard catching cross-split contamination
while confirming adapters never create it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from factorylm_ai.adapters import (  # noqa: E402
    SourceCandidate,
    drive_commander_candidate,
    frozen_benchmark_candidate,
    printsense_candidate,
    simlab_candidate,
)
from factorylm_ai.adapters.source_candidate import (  # noqa: E402
    build_corpus_source,
    find_candidate_leakage,
    frozen_lineage_key,
)
from factorylm_ai.governance import lineage as ln  # noqa: E402
from factorylm_ai.governance import rejection_codes as rc  # noqa: E402
from factorylm_ai.governance import splits as sp  # noqa: E402


# ── helpers ─────────────────────────────────────────────────────────────────
def _public_train_parts() -> tuple[str, str]:
    """A deterministic (manufacturer, document) whose public lineage hashes to `train`."""
    for i in range(200):
        mfr, doc = "acme", f"pf-{i}"
        if ln.assign_split(ln.public_lineage_key(mfr, doc)) == "train":
            return mfr, doc
    raise AssertionError("no train-side public key found (should be ~70% of keys)")


def _public_train_record(**over) -> dict:
    mfr, doc = _public_train_parts()
    rec = {
        "record_id": "ps-1",
        "manufacturer": mfr,
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
        "source_sha256": "d" * 64,
    }
    rec.update(over)
    return rec


# ── PR 2A: PrintSense ────────────────────────────────────────────────────────
def test_printsense_public_lineage_key_and_eligible_on_train_side() -> None:
    c = printsense_candidate(_public_train_record())
    mfr, doc = _public_train_parts()
    assert c.document_lineage_key == ln.public_lineage_key(mfr, doc)
    assert ":" in c.document_lineage_key and not ln.is_bare_content_hash(c.document_lineage_key)
    # a fully-declared, gold, train-side public print is training-eligible
    assert c.assigned_split() == "train"
    assert c.is_training_eligible(), c.check().codes


def test_printsense_content_hash_is_evidence_not_lineage() -> None:
    c = printsense_candidate(_public_train_record(source_sha256="a" * 64))
    assert c.evidence_id == "a" * 64  # the hash is preserved as evidence
    assert c.document_lineage_key != "a" * 64  # but never used as the lineage key


def test_printsense_public_eval_only_is_not_trainable() -> None:
    c = printsense_candidate(_public_train_record(eval_only=True))
    assert c.rights.training_allowed is False
    assert c.rights.evaluation_allowed is True
    assert rc.TRAINING_NOT_ALLOWED in c.check().codes


def test_printsense_undeclared_rights_fail_closed() -> None:
    # a public record that declares no license / no rights → unknown, unresolved → denied
    c = printsense_candidate({"record_id": "x", "manufacturer": "acme", "document_number": "z-1"})
    assert c.rights.rights_resolved is False
    codes = c.check().codes
    assert rc.RIGHTS_UNRESOLVED in codes and rc.TRAINING_NOT_ALLOWED in codes


def test_printsense_tenant_lineage_key_and_stays_ineligible() -> None:
    c = printsense_candidate(
        {
            "record_id": "t-1",
            "tenant_id": "acme-co",
            "document_uuid": "11111111-2222-3333-4444-555555555555",
            "gold_status": "gold",
            "validation_passed": True,
            "provenance": ["upload"],
        }
    )
    assert c.document_lineage_key == "tenant:acme-co:document:11111111-2222-3333-4444-555555555555"
    assert c.sensitive is True and c.tenant_id == "acme-co"
    # even fully approved, a tenant upload is not shared-training material
    codes = c.check().codes
    assert not c.is_training_eligible()
    assert rc.SENSITIVE_TENANT in codes and rc.TRAINING_NOT_ALLOWED in codes


def test_printsense_tenant_without_uuid_raises() -> None:
    with pytest.raises(ValueError):
        printsense_candidate({"record_id": "t", "tenant_id": "acme-co"})


def test_printsense_public_without_document_raises() -> None:
    with pytest.raises(ValueError):
        printsense_candidate({"record_id": "p", "manufacturer": "acme"})


# ── PR 2B: Drive Commander ───────────────────────────────────────────────────
def test_drive_commander_pack_hash_is_evidence_not_lineage() -> None:
    c = drive_commander_candidate(
        {
            "pack_id": "b" * 64,
            "manufacturer": "AutomationDirect",
            "drive_model": "GS10",
            "manifest": {
                "license_class": "public-eval-and-train",
                "rights": {"rights_resolved": True, "training_allowed": True},
            },
        }
    )
    assert c.evidence_id == "b" * 64
    assert c.document_lineage_key == ln.public_lineage_key("AutomationDirect", "GS10")
    assert not ln.is_bare_content_hash(c.document_lineage_key)


def test_drive_commander_shared_pack_rights_fail_closed_without_manifest() -> None:
    c = drive_commander_candidate(
        {"pack_id": "c" * 64, "manufacturer": "AutomationDirect", "drive_model": "GS10"}
    )
    assert c.rights.training_allowed is False
    assert rc.TRAINING_NOT_ALLOWED in c.check().codes


def test_drive_commander_tenant_pack_is_sensitive_and_not_cross_tenant() -> None:
    c = drive_commander_candidate(
        {
            "pack_id": "e" * 64,
            "tenant_id": "acme-co",
            "pack_uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "gold_status": "gold",
            "validation_passed": True,
            "provenance": ["drive nameplate"],
        }
    )
    assert c.sensitive is True
    assert c.rights.cross_tenant_reuse_allowed is False
    assert c.document_lineage_key.startswith("tenant:acme-co:document:")
    assert rc.SENSITIVE_TENANT in c.check().codes


def test_drive_commander_tenant_pack_without_uuid_raises() -> None:
    with pytest.raises(ValueError):
        drive_commander_candidate({"pack_id": "f" * 64, "tenant_id": "acme-co"})


# ── PR 2C: MIRA + SimLab ─────────────────────────────────────────────────────
def test_simlab_is_frozen_eval_only_and_untrainable() -> None:
    c = simlab_candidate(
        {
            "scenario_id": "juice-line-fault-3",
            "gold_status": "gold",  # even graded gold...
            "validation_passed": True,
            "provenance": ["sim ground truth"],
        }
    )
    assert c.frozen_eval is True
    assert c.metadata["synthetic"] is True and c.metadata["origin"] == "simlab"
    assert c.document_lineage_key == "simlab:juice-line-fault-3"
    assert not ln.is_bare_content_hash(c.document_lineage_key)
    # two independent locks — frozen_eval AND eval-only license
    codes = c.check().codes
    assert not c.is_training_eligible()
    assert rc.FROZEN_EVAL in codes and rc.TRAINING_NOT_ALLOWED in codes


def test_simlab_cannot_be_forced_trainable_via_rights() -> None:
    # even if the record smuggles in trainable rights, the adapter ignores them
    c = simlab_candidate(
        {
            "scenario_id": "s1",
            "rights": {"rights_resolved": True, "training_allowed": True},
            "license_class": "public-eval-and-train",
        }
    )
    assert c.rights.training_allowed is False
    assert rc.FROZEN_EVAL in c.check().codes


def test_simlab_without_scenario_raises() -> None:
    with pytest.raises(ValueError):
        simlab_candidate({"record_id": "x"})


def test_frozen_benchmark_generic_source_visible_in_metadata() -> None:
    c = frozen_benchmark_candidate(source="mira", ident="bench-42")
    assert c.frozen_eval is True and c.document_lineage_key == "mira:bench-42"
    assert c.metadata["origin"] == "mira"


# ── shared SourceCandidate invariants ────────────────────────────────────────
def test_bare_content_hash_lineage_is_rejected_at_construction() -> None:
    with pytest.raises(ValueError):
        SourceCandidate(
            source_system="x",
            record_id="r",
            document_lineage_key="a" * 64,  # a bare content hash is not a lineage key
            corpus_source=build_corpus_source(
                license_class="public-eval-and-train", confidentiality_class="public"
            ),
        )


def test_missing_lineage_fails_closed_at_gate() -> None:
    c = SourceCandidate(
        source_system="x",
        record_id="r",
        document_lineage_key=None,
        corpus_source=build_corpus_source(
            license_class="public-eval-and-train", confidentiality_class="public"
        ),
    )
    assert c.assigned_split() is None
    assert rc.LINEAGE_MISSING in c.check().codes


def test_frozen_lineage_key_rejects_empty() -> None:
    with pytest.raises(ValueError):
        frozen_lineage_key("simlab", "")


# ── leakage guard ────────────────────────────────────────────────────────────
def test_adapter_built_set_is_leakage_clean_but_guard_catches_corruption() -> None:
    # siblings of one lineage (two crops of the same public print) always share a split →
    # adapters cannot create a cross-split collision.
    mfr, doc = _public_train_parts()
    a = printsense_candidate(_public_train_record(record_id="a", source_sha256="1" * 64))
    b = printsense_candidate(_public_train_record(record_id="b", source_sha256="2" * 64))
    assert a.document_lineage_key == b.document_lineage_key
    assert a.assigned_split() == b.assigned_split()
    assert find_candidate_leakage([a, b]) == []

    # now simulate a registry violation: the SAME lineage stamped into two splits.
    corrupted = [
        {"record_id": "a", "document_lineage_key": a.document_lineage_key, "split": "train"},
        {"record_id": "b", "document_lineage_key": a.document_lineage_key, "split": "validation"},
    ]
    assert rc.LINEAGE_SPLIT_COLLISION in [x.code for x in sp.find_leakage(corrupted)]


def test_leakage_guard_flags_eligible_record_on_eval_side() -> None:
    # a candidate whose lineage lands on the eval side is never eligible, so a set built
    # from adapters can't put an *eligible* record on the eval side — the guard is the
    # backstop if some other producer does.
    leaked = [
        {
            "record_id": "r",
            "document_lineage_key": "acme:leak",
            "split": "test",
            "training_eligibility": "eligible",
        }
    ]
    assert rc.LINEAGE_ON_EVAL_SIDE in [x.code for x in sp.find_leakage(leaked)]
