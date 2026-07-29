"""ADR-0033 Phase-4 unified compiler — mixture, leakage, determinism."""

from __future__ import annotations

from factorylm_ai.dataset import behavior_spec as bs
from factorylm_ai.dataset import unified_compile as uc

build_cache: dict = {}


def _compiled():
    if "c" not in build_cache:
        build_cache["c"] = uc.compile_unified()
    return build_cache["c"]


def test_gates_pass_and_majority_general() -> None:
    compiled, report = _compiled()
    assert report["gates"]["general_fraction_ok"] is True
    assert report["gates"]["eval_families_excluded"] is True
    assert report["general_plus_bridge_fraction"] >= uc.GENERAL_FRACTION_MIN
    assert report["records"] == len(compiled)


def test_caps_hold() -> None:
    compiled, report = _compiled()
    total = report["records"]
    for fam, n in report["by_source_family"].items():
        if fam in ("general", "bridge"):
            continue
        assert n <= total * uc.PRODUCT_FAMILY_CAP + 1, (fam, n)
    for mfr, n in report["by_manufacturer"].items():
        if mfr in uc.HOUSE_MANUFACTURERS:
            continue
        assert n <= total * uc.MANUFACTURER_CAP + 1, (mfr, n)
    for tmpl, n in report["by_template_family"].items():
        assert n <= total * uc.TEMPLATE_FAMILY_CAP + 1, (tmpl, n)


def test_eval_only_families_never_in_training() -> None:
    compiled, _ = _compiled()
    lineages = {c.to_dict()["document_lineage_key"] for c in compiled}
    for fam in uc.EVAL_ONLY_FAMILIES:
        assert f"factorylm:general-behavior-{fam}" not in lineages, fam
    # and eval prompts only use reserved families
    for p in uc.eval_slice_prompts():
        assert p["slice"] in uc.EVAL_ONLY_FAMILIES


def test_compile_is_deterministic() -> None:
    c1, r1 = uc.compile_unified()
    c2, r2 = uc.compile_unified()
    assert [c.record.record_id for c in c1] == [c.record.record_id for c in c2]
    assert r1 == r2


def test_every_general_and_bridge_record_passes_strict_gate() -> None:
    compiled, _ = _compiled()
    for c in compiled:
        if uc._family_of(c) not in ("general", "bridge"):
            continue
        user = "\n".join(m["content"] for m in c.record.messages if m["role"] == "user")
        answer = next(m["content"] for m in c.record.messages if m["role"] == "assistant")
        v = bs.validate_training_record(
            user_text=user,
            answer=answer,
            evidence_text=user if "Evidence (" in user else "",
            claim="",
            evidence_present="Evidence (" in user,
            interaction_type=c.record.interaction_type,
            safety_sensitive=bool(c.to_dict()["safety"]["safety_sensitive"]),
        )
        assert v == [], (c.record.record_id, v)


def test_no_held_out_or_non_train_rows() -> None:
    compiled, _ = _compiled()
    for c in compiled:
        d = c.to_dict()
        assert d["split"] == "train", d["record_id"]
        assert d["rights"]["training_allowed"] is True, d["record_id"]


def test_frozen_builds_untouched_by_compile() -> None:
    from factorylm_ai.dataset import technician_v0 as v0

    before = v0.candidate_manifest_for(v0.build_review_candidates())["manifest_sha256"]
    uc.compile_unified()
    after = v0.candidate_manifest_for(v0.build_review_candidates())["manifest_sha256"]
    assert before == after
