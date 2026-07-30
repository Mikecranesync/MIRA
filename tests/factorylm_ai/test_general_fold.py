"""fold_general_generated — the agent-written general-family scale-up path.

Fail-closed law: a variant row enters the compile ONLY if it names a train
family, passes the strict behavior gate under the family's canonical
interaction/safety values, contains no real-OEM token, and is not a
near-duplicate of the base templates or an earlier variant.
"""

from __future__ import annotations

import json

import pytest

from factorylm_ai.dataset import unified_compile as uc


def _row(**over):
    base = {
        "family": "incomplete-symptoms",
        "asset": "wash-down pump by the east wall",
        "record_suffix": "night-shift-pump",
        "generator": "test",
        "messages": [
            {
                "role": "user",
                "content": (
                    "Night shift here. The wash-down pump by the east wall won't stay "
                    "running and I can't tell why. Ideas?"
                ),
            },
            {
                "role": "assistant",
                "content": (
                    "A pump that won't stay running has too many possible causes to "
                    "name one honestly — the answer lives in the machine's own trip "
                    "record and what changes right before each stop. Safety floor: do "
                    "not keep restarting it to limp through the shift, and no "
                    "energized work. Next step: note the exact indication when it "
                    "drops out and what was happening on the line, then re-ask with "
                    "those details in front of you."
                ),
            },
        ],
    }
    base.update(over)
    return base


def _fold(tmp_path, rows):
    p = tmp_path / "variants.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    return uc.fold_general_generated(p)


def test_good_row_accepted(tmp_path) -> None:
    accepted, rejected = _fold(tmp_path, [_row()])
    assert rejected == []
    assert len(accepted) == 1
    c = accepted[0]
    assert c.record.record_id == "techgenvar-incomplete-symptoms-night-shift-pump"
    # family canon is forced, not trusted from the row
    assert c.record.interaction_type == "uncertainty"
    assert c.to_dict()["safety"]["safety_sensitive"] is False
    assert "source_family_general" in c.record.tags
    assert "incomplete-symptoms" in c.record.tags
    d = c.to_dict()
    assert d["document_lineage_key"].startswith(
        "factorylm:general-behavior-incomplete-symptoms-"
    )
    assert d["rights"]["training_allowed"] is True


def test_eval_only_family_rejected(tmp_path) -> None:
    accepted, rejected = _fold(tmp_path, [_row(family="stale-live-data")])
    assert accepted == []
    assert rejected[0]["violations"] == ["eval_only_family"]


def test_unknown_family_rejected(tmp_path) -> None:
    accepted, rejected = _fold(tmp_path, [_row(family="totally-new-family")])
    assert accepted == []
    assert rejected[0]["violations"] == ["unknown_family"]


def test_gate_violation_rejected_invented_number(tmp_path) -> None:
    bad = _row(record_suffix="invented-number")
    bad["messages"][1]["content"] = (
        "It draws 480 volts so check that first — it lives in the trip record. "
        "Safety floor: no energized work. Next step: verify the reading."
    )
    accepted, rejected = _fold(tmp_path, [bad])
    assert accepted == []
    assert any(v.startswith("unsupported_numbers") for v in rejected[0]["violations"])


def test_real_manufacturer_token_rejected(tmp_path) -> None:
    bad = _row(record_suffix="oem-leak")
    bad["messages"][0]["content"] += " It feeds the PowerFlex on line two."
    accepted, rejected = _fold(tmp_path, [bad])
    assert accepted == []
    assert rejected[0]["violations"][0].startswith("real_manufacturer_token")


def test_duplicate_suffix_rejected(tmp_path) -> None:
    accepted, rejected = _fold(tmp_path, [_row(), _row()])
    assert len(accepted) == 1
    assert rejected[0]["violations"] == ["duplicate_suffix"]


def test_refusal_family_requires_no_shape(tmp_path) -> None:
    bad = _row(family="safety-boundary", record_suffix="soft-refusal")
    # a safety-boundary answer that does not start with "No" must be rejected
    bad["messages"][1]["content"] = (
        "I would rather not help with that — it lives in the site safety "
        "procedure. Safety floor: the guard stays functional, no bypass, no "
        "energized work, follow loto. Next step: diagnose why it trips."
    )
    accepted, rejected = _fold(tmp_path, [bad])
    assert accepted == []
    assert "refusal_missing_no_shape" in rejected[0]["violations"]


def test_near_dup_of_base_template_dropped(tmp_path, monkeypatch) -> None:
    base = uc.general_candidates()
    # copy a base template's user text verbatim → Jaccard 1.0 → dropped
    dup = _row(record_suffix="word-swap")
    dup["messages"][0]["content"] = "My conveyor drive motor keeps faulting. What's wrong with it?"
    dup["messages"][1]["content"] = (
        "That description alone cannot isolate a cause and I will not guess — it "
        "lives in the machine's fault record. Safety floor: do not clear faults "
        "repeatedly, and no energized work. Next step: capture the exact fault "
        "code and conditions, then re-ask."
    )
    p = tmp_path / "gen"
    p.mkdir()
    (p / "v.jsonl").write_text(json.dumps(dup) + "\n", encoding="utf-8")
    monkeypatch.setattr(uc, "GENERATED_DIR", p)
    variants, stats = uc.general_variant_candidates(base)
    assert variants == []
    assert stats["near_dup_dropped"] == 1


def test_compile_with_variants_keeps_gates_green(tmp_path, monkeypatch) -> None:
    p = tmp_path / "gen"
    p.mkdir()
    rows = [_row(record_suffix=f"case-{i}", asset=f"utility pump number {i}") for i in range(3)]
    for i, r in enumerate(rows):
        r["messages"][0]["content"] = (
            f"Utility pump number {i} out back quit twice today and the operator "
            "swears nothing changed. Where do I even start?"
        )
    (p / "v.jsonl").write_text(
        "\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8"
    )
    monkeypatch.setattr(uc, "GENERATED_DIR", p)
    compiled, report = uc.compile_unified()
    assert report["gates"]["general_fraction_ok"] is True
    assert report["gates"]["eval_families_excluded"] is True
    assert report["general_variants"]["files"] == 1
    # near-dup among the three (same text modulo the number) collapses to one
    assert report["general_variants"]["accepted"] >= 1
    ids = {c.record.record_id for c in compiled}
    assert any(r.startswith("techgenvar-") for r in ids)


def test_fold_is_deterministic(tmp_path) -> None:
    rows = [_row(), _row(record_suffix="second", asset="brine chiller skid")]
    rows[1]["messages"][0]["content"] = (
        "The brine chiller skid alarms out every morning around start-up and "
        "clears itself by lunch. Maintenance keeps getting blamed. What now?"
    )
    a1, r1 = _fold(tmp_path, rows)
    a2, r2 = _fold(tmp_path, rows)
    assert [c.record.record_id for c in a1] == [c.record.record_id for c in a2]
    assert r1 == r2


def test_no_generated_dir_is_noop() -> None:
    variants, stats = uc.general_variant_candidates(uc.general_candidates())
    if (uc.v0.REPO_ROOT / uc.GENERATED_DIR).is_dir():
        pytest.skip("generated dir exists in this checkout")
    assert variants == []
    assert stats["accepted"] == 0
