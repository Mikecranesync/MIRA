"""2026-07-28 pre-flight hardening — expanded eval set, validation carve,
per-judge side swap. All hermetic, $0, no network."""

from __future__ import annotations

import json

import pytest

from factorylm_ai.dataset import holdout_eval as he
from factorylm_ai.dataset import technician_v2 as v2

build_cache: dict = {}


def _expanded():
    return build_cache.setdefault("ps", he.build_prompt_set_expanded())


def test_expanded_set_size_tracks_and_determinism() -> None:
    a, b = _expanded(), he.build_prompt_set_expanded()
    assert a["prompt_set_hash"] == b["prompt_set_hash"]
    assert len(a["prompts"]) >= he.EXPANDED_MIN_RECORDS
    from collections import Counter

    tracks = Counter(p["track"] for p in a["prompts"])
    assert tracks == {"evidence_absent": 36, "evidence_present": 36, "distractor": 36}
    assert a["manual_inspection_min"] == 50


def test_expanded_keeps_frozen_25_verbatim_in_track_a() -> None:
    legacy = {p["record_id"]: p for p in he.build_prompt_set()["prompts"]}
    got = {
        p["record_id"]: p
        for p in _expanded()["prompts"]
        if p["track"] == "evidence_absent" and p["record_id"] in legacy
    }
    assert len(got) == 25
    for rid, row in got.items():
        assert row["messages"] == legacy[rid]["messages"], rid
        assert row["evidence"] == legacy[rid]["evidence"], rid


def test_expanded_distractor_shows_wrong_evidence_only() -> None:
    for p in _expanded()["prompts"]:
        if p["track"] != "distractor":
            continue
        claim = str(p["evidence"].get("claim", "")).strip().rstrip(".")
        user = "\n".join(m["content"] for m in p["messages"] if m["role"] == "user")
        assert claim.lower() not in user.lower(), p["record_id"]
        assert "Evidence (" in user, p["record_id"]


def test_expanded_leakage_guard_trips_on_planted_claim(tmp_path, monkeypatch) -> None:
    facts = he._pf40_facts()
    planted = {
        "record_id": "bad-1",
        "document_lineage_key": "other:lineage",
        "messages": [{"role": "assistant", "content": facts[0]["claim"]}],
    }
    fake = tmp_path / "reviewed.jsonl"
    fake.write_text(json.dumps(planted) + "\n", encoding="utf-8")
    monkeypatch.setattr(he, "REVIEWED", fake)
    with pytest.raises(SystemExit, match="LEAKAGE"):
        he.expanded_leakage_guard(facts)


def test_carve_validation_lineage_disjoint_and_sized() -> None:
    rows = [c.to_dict() for c in v2.build_review_candidates_v2() if c.to_dict()["split"] == "train"]
    train, val = v2.carve_validation(rows)
    t_lin = {r["document_lineage_key"] for r in train}
    v_lin = {r["document_lineage_key"] for r in val}
    assert not (t_lin & v_lin)
    assert len(train) + len(val) == len(rows)
    frac = len(val) / len(rows)
    assert 0.04 <= frac <= 0.25, frac
    # deterministic
    train2, val2 = v2.carve_validation(rows)
    assert [r["record_id"] for r in val2] == [r["record_id"] for r in val]


def test_carve_validation_rejects_non_train_rows() -> None:
    with pytest.raises(SystemExit, match="non-train"):
        v2.carve_validation([{"record_id": "x", "split": "held_out", "document_lineage_key": "l"}])


def test_judge_views_swap_roundtrip(tmp_path) -> None:
    rows = [
        {"record_id": f"r{i}", "left": {"text": f"L{i}"}, "right": {"text": f"R{i}"}}
        for i in range(40)
    ]
    (tmp_path / "outputs_blinded.jsonl").write_text(
        "\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8"
    )
    summary = he.make_judge_views(tmp_path, judge_ids=("j1", "j2", "j3"))
    assert summary["records"] == 40
    # some but not all records swapped for each judge (hash-random ~half)
    for j, n in summary["swapped_per_judge"].items():
        assert 5 <= n <= 35, (j, n)
    # roundtrip: a verdict on the swapped view maps back to the canonical side
    view = [
        json.loads(line)
        for line in (tmp_path / "judge_view_j1.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    for v in view:
        rid = v["record_id"]
        # judge says "left" meaning the view's left; unswap must name the
        # canonical side whose text the view's left carries
        canonical = next(r for r in rows if r["record_id"] == rid)
        view_left_is_canonical_left = v["left"]["text"] == canonical["left"]["text"]
        mapped = he.unswap_verdict("j1", rid, "left")
        assert mapped == ("left" if view_left_is_canonical_left else "right"), rid
    assert he.unswap_verdict("j1", "r0", "tie") == "tie"
