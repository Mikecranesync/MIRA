"""Technician dataset v2 — corpus invariants (Training Plan v2 Phase B).

The audit IS the invariant set (partition law, pair-dedup); these tests keep
it green in CI plus the frozen-build guarantees the earlier versions carry.
Generated strata are included only when the checked-in generated/*.jsonl
files exist — the deterministic core must hold either way.
"""

from __future__ import annotations

from factorylm_ai.dataset import technician_v0 as v0
from factorylm_ai.dataset import technician_v1 as v1
from factorylm_ai.dataset import technician_v1_1 as v11
from factorylm_ai.dataset import technician_v2 as v2

build_cache: dict = {}


def _candidates():
    return build_cache.setdefault("cands", v2.build_review_candidates_v2())


def test_audit_is_clean() -> None:
    report = v2.audit(_candidates())
    assert report["partition_violations"] == []
    assert report["exact_user_dupes"] == []
    assert report["ok"] is True


def test_core_strata_present_and_sized() -> None:
    report = v2.audit(_candidates())
    strata = report["strata"]
    assert strata["s1_v11"] == 211
    for fmt in ("json", "prose", "table", "ocr"):
        assert strata[f"stratum_format_{fmt}"] >= 100
    assert strata["stratum_distractor_mixed"] >= 100
    assert strata["stratum_distractor_wrong"] >= 100
    assert strata["stratum_safety_pushback"] >= 90


def test_every_record_id_unique() -> None:
    ids = [c.record.record_id for c in _candidates()]
    assert len(ids) == len(set(ids))


def test_frozen_builds_untouched_by_v2() -> None:
    v0_before = v0.candidate_manifest_for(v0.build_review_candidates())["manifest_sha256"]
    v1_before = v1.candidate_manifest_v1()["manifest_sha256"]
    v11_before = v11.candidate_manifest_v1_1()["manifest_sha256"]
    v2.candidate_manifest_v2()
    assert v0.candidate_manifest_for(v0.build_review_candidates())["manifest_sha256"] == v0_before
    assert v1.candidate_manifest_v1()["manifest_sha256"] == v1_before
    assert v11.candidate_manifest_v1_1()["manifest_sha256"] == v11_before
    assert v0.DATASET_VERSION == "factorylm-industrial-technician-v0"


def test_build_is_deterministic() -> None:
    m1 = v2.candidate_manifest_v2()
    m2 = v2.candidate_manifest_v2()
    assert m1["manifest_sha256"] == m2["manifest_sha256"]
    assert m1["dataset_version"] == v2.DATASET_VERSION


def test_wrong_evidence_records_never_leak_the_target_claim() -> None:
    for c in _candidates():
        if "stratum_distractor_wrong" not in c.record.tags:
            continue
        claim = str(c.answer_key["withheld_payload"].get("claim", "")).strip().rstrip(".")
        answers = " ".join(m["content"] for m in c.record.messages if m["role"] == "assistant")
        assert claim.lower() not in answers.lower(), c.record.record_id
