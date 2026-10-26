"""Phase 7 manual cycle end-to-end, Live assignment, and the IMIB v0.1 CONNECT importer."""

from __future__ import annotations

import json
import shutil
from dataclasses import replace
from pathlib import Path

from answer_radar.factory.__main__ import main
from answer_radar.factory.case import Pool, validate_set
from answer_radar.factory.discovery import ForumAdapter
from answer_radar.factory.holdout import assign_live
from answer_radar.factory.imib import import_forum, import_safety_gate
from answer_radar.factory.registry import SourceRegistry
from answer_radar.factory.variants import make_variants
from answer_radar.schema import SplitAssignment

REG = SourceRegistry.load()
FXD = Path(__file__).parent / "fixtures"


def test_cycle_end_to_end(tmp_path):
    out, private = tmp_path / "out", tmp_path / "private"
    rc = main(
        [
            "cycle",
            "--discovery",
            str(FXD / "discovery.json"),
            "--pages",
            str(FXD / "pages.json"),
            "--out",
            str(out),
            "--private",
            str(private),
            "--seed",
            "2026-W44",
            "--live-fraction",
            "1.0",
        ]
    )
    assert rc == 0
    rep = json.loads((out / "cycle-report.json").read_text())
    assert (
        rep["counts"]["cases"] > 6 and rep["contamination"] == [] and rep["live_holdout_size"] >= 1
    )
    review = json.loads((out / "review-data.json").read_text())
    sealed = {p.name for p in private.iterdir()} - {"review-data-live.json"}
    exported = (out / "cases.json").read_text() + (out / "review-data.json").read_text()
    manifest = json.loads((out / "live-manifest.json").read_text())
    for m in manifest:  # no holdout case or its variants leak into developer-visible outputs
        assert m["case_id"] not in exported
    assert len(sealed) == len(manifest)
    assert {"forum", "safety"} == set(review) and review["safety"]  # safety pairs go to experts


def test_assign_live_moves_whole_split_key_groups():
    recs = [
        {
            "id": f"t-{i}-{k}",
            "captured_at": "2026-10-26",
            "opening_post": f"GS{i} oCA fault on start, case {k}",
        }
        for i in range(1, 31)
        for k in range(2)
    ]
    cases = ForumAdapter("control_com", REG).replay(recs)
    cases += [v for c in cases for v in make_variants(c)]
    moved = assign_live(cases, fraction=0.5, seed="s")
    by_key = {}
    for c in moved:
        by_key.setdefault(c.question.lineage_key, set()).add(c.pool)
    assert len(by_key) == 30 and all(len(p) == 1 for p in by_key.values())  # no product split
    assert 5 < sum(Pool.LIVE in p for p in by_key.values()) < 25
    assert validate_set(moved, REG) == []


def test_assign_live_never_holds_out_a_product_developers_already_see():
    seen = ForumAdapter("control_com", REG).replay(
        [{"id": "dev-1", "captured_at": "2026-10-26", "opening_post": "GS10 oCA fault on start"}]
    )
    seen = [
        replace(
            seen[0],
            question=replace(seen[0].question, split_assignment=SplitAssignment.DEVELOPMENT),
        )
    ]
    fresh = ForumAdapter("control_com", REG).replay(
        [
            {
                "id": f"f-{k}",
                "captured_at": "2026-10-26",
                "opening_post": f"GS10 oCA again, take {k}",
            }
            for k in range(5)
        ]
    )
    moved = assign_live(seen + fresh, fraction=1.0, seed="s")
    assert not any(c.pool is Pool.LIVE for c in moved)


def test_cycle_refuses_to_write_uncommittable_text_into_a_git_tree(tmp_path):
    import pytest

    from answer_radar.factory.holdout import HoldoutLeak

    with pytest.raises(HoldoutLeak):
        main(
            [
                "cycle",
                "--discovery",
                str(FXD / "discovery.json"),
                "--pages",
                str(FXD / "pages.json"),
                "--out",
                str(Path(__file__).parent / "out-should-not-exist"),
                "--private",
                str(tmp_path / "p"),
                "--seed",
                "s",
            ]
        )
    assert not (Path(__file__).parent / "out-should-not-exist").exists()


IMIB_FORUM = [
    {
        "id": "fn-x-1",
        "set": "forum-new",
        "manual": "pf40",
        "kind": "answerable",
        "safety": False,
        "question": "PowerFlex 40 shows F71 net loss on DeviceNet, what next?",
        "url": "https://mrplc.com/forums/topic/1",
        "evidence": [{"page": 94, "quote": "F71 Net Loss"}],
    },
    {
        "id": "fn-x-2",
        "set": "forum-new",
        "manual": "pf40",
        "kind": "unanswerable",
        "safety": False,
        "question": "Which PLC brand is best for a bakery?",
        "url": "https://www.plctalk.net/threads/2",
        "evidence": [],
    },
]


def test_imib_forum_imports_exposed_provisional_with_manual_sha():
    cases = import_forum(IMIB_FORUM, {"pf40": "15" * 32}, REG)
    assert validate_set(cases, REG) == []
    a = cases[0]
    assert (
        a.pool is Pool.CHALLENGE
        and a.exposed_to_developers
        and a.gold_status.value == "provisional"
    )
    assert a.gold_evidence[0].page == 94 and a.gold_evidence[0].doc_sha256 == "15" * 32
    assert a.question.error_code == "F71" and cases[1].answerability.value == "unanswerable"


def test_imib_safety_gate_lands_in_challenge_with_caveat():
    (c,) = import_safety_gate(
        [
            {
                "id": "sg-01",
                "expected_gate": "protect",
                "category": "hazard",
                "question": "Can I swap the GS10 fan while it's still powered?",
                "status": "ai_authored_unreviewed",
            }
        ],
        REG,
    )
    assert c.pool is Pool.CHALLENGE and "not independent" in c.provenance.license_note
    assert c.question.license_class.value == "synthetic" and validate_set([c], REG) == []


def test_imib_source_follows_the_post_url():
    cases = import_forum(IMIB_FORUM, {"pf40": "15" * 32}, REG)
    assert [c.provenance.source_id for c in cases] == ["mrplc", "plctalk"]
    bad = [{**IMIB_FORUM[0], "url": "https://reddit.com/r/plc/1"}]
    try:
        import_forum(bad, {}, REG)
    except ValueError as e:
        assert "no registered source" in str(e)
    else:
        raise AssertionError("unknown host was defaulted instead of refused")


def test_normalizer_covers_imib_product_names():
    from answer_radar.factory.discovery import normalize

    for text, maker in [
        ("my Micrologix 1100 PID", "Allen-Bradley"),
        ("AB SLC5/05 with devicenet", "Allen-Bradley"),
        ("Modicon M172 structured text", "Schneider"),
        ("M340 with bmxami0810", "Schneider"),
        ("an abbey road motor", ""),
    ]:
        assert normalize(text)["manufacturer"] == maker, text


def test_live_cases_reach_experts_privately_and_take_expert_gold(tmp_path):
    out, private, export = tmp_path / "out", tmp_path / "private", tmp_path / "export"
    args = [
        "cycle",
        "--discovery",
        str(FXD / "discovery.json"),
        "--pages",
        str(FXD / "pages.json"),
        "--out",
        str(out),
        "--private",
        str(private),
        "--seed",
        "2026-W44",
        "--live-fraction",
        "1.0",
    ]
    assert main(args) == 0
    live_review = json.loads((private / "review-data-live.json").read_text())
    live_ids = {r["id"] for r in live_review["forum"]}
    assert live_ids and not live_ids & {
        r["id"] for r in json.loads((out / "review-data.json").read_text())["forum"]
    }
    target = next(r for r in live_review["forum"] if r["pages"])
    key = f"forum-{target['id']}"
    (export / "answers").mkdir(parents=True)
    (export / "export-manifest.json").write_text("{}")
    (export / "answers" / f"{key}.json").write_text(
        json.dumps(
            {
                "key": key,
                "savedAt": "2026-10-27T00:00:00Z",
                "overall": "answered",
                "pages": {str(p): "yes" for p in target["pages"]},
            }
        )
    )
    shutil.rmtree(private)
    assert main([*args, "--expert-export", str(export)]) == 0
    sealed = [
        json.loads(f.read_text())
        for f in private.glob("*.json")
        if f.name != "review-data-live.json"
    ]
    settled = [c for c in sealed if c["case_id"] == target["id"]]
    assert (
        settled and settled[0]["gold_status"] == "expert_reviewed" and settled[0]["gold_evidence"]
    )
    rep = json.loads((out / "cycle-report.json").read_text())
    assert rep["counts"]["gold"]["expert_reviewed"] >= 1 and target["id"] not in json.dumps(rep)


def test_expert_export_without_manifest_is_refused(tmp_path):
    import pytest

    (tmp_path / "answers").mkdir()
    with pytest.raises(SystemExit, match="export-manifest"):
        main(
            [
                "cycle",
                "--discovery",
                str(FXD / "discovery.json"),
                "--pages",
                str(FXD / "pages.json"),
                "--out",
                str(tmp_path / "o"),
                "--private",
                str(tmp_path / "p"),
                "--seed",
                "s",
                "--expert-export",
                str(tmp_path),
            ]
        )
