"""Unit tests for the Drive Commander self-eval scout — pure logic only.

No network, no PDF, no email. Covers target selection (must refuse a family that
already has a gold set) and the honest evaluation rendering (an EMPTY pack must
NOT be sold as a good grade; failures render an honest verdict).
"""

import pathlib
import sys

import pytest

_TOOL_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(_TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOL_DIR))

import self_eval_scout as scout  # noqa: E402


def test_targets_are_all_outside_gold():
    # Every configured scout target must be an unseen family (no gold set), else
    # it stops being a generalization test.
    gold = scout._gold_families()
    for t in scout.SCOUT_TARGETS:
        assert t["pack_id"] not in gold, f"{t['pack_id']} has a gold set — not unseen"


def _eligible():
    gold = scout._gold_families()
    return [t for t in scout.SCOUT_TARGETS if t["pack_id"] not in gold]


def test_pick_target_prefers_never_attempted_first_deterministic():
    # No history -> the FIRST declared eligible family (declaration order is the
    # priority: Magnetek G+ Mini leads). Deterministic across calls.
    eligible = _eligible()
    assert eligible, "need at least one non-gold target"
    a = scout.pick_target(None, attempted=set(), gold=scout._gold_families())
    assert a["pack_id"] == eligible[0]["pack_id"]
    assert a["pack_id"] == scout.pick_target(None, attempted=set())["pack_id"]


def test_pick_target_skips_already_attempted():
    eligible = _eligible()
    if len(eligible) < 2:
        pytest.skip("need >=2 eligible families to test skipping")
    first = eligible[0]["pack_id"]
    nxt = scout.pick_target(None, attempted={first}, gold=scout._gold_families())
    assert nxt["pack_id"] == eligible[1]["pack_id"]


def test_pick_target_fails_loud_when_pool_exhausted():
    # Core Phase-4 fix: NOT a modulo loop — when every eligible family has a
    # completed evaluation, refuse rather than silently re-run a done family.
    all_ids = {t["pack_id"] for t in _eligible()}
    with pytest.raises(SystemExit):
        scout.pick_target(None, attempted=all_ids, gold=scout._gold_families())


def test_pick_target_pin_overrides_attempted():
    # An explicit --target re-evaluates on purpose, even if already attempted.
    pinned = scout.SCOUT_TARGETS[0]["pack_id"]
    t = scout.pick_target(pinned, attempted={pinned}, gold=scout._gold_families())
    assert t["pack_id"] == pinned


def test_pick_target_unknown_id_fails_loud():
    with pytest.raises(SystemExit):
        scout.pick_target("no_such_drive")


def test_history_records_and_only_graded_retires(tmp_path):
    tgt = scout.SCOUT_TARGETS[0]
    # A failed fetch is recorded but does NOT retire the family (retry next run).
    scout.record_attempt(tmp_path, tgt, {"status": "FETCH_FAILURE", "generated_at": "t0"})
    hist = scout._load_history(tmp_path)
    assert len(hist) == 1 and hist[0]["pack_id"] == tgt["pack_id"]
    assert scout._graded_families(hist) == set(), "a failure must not retire a family"
    # A GRADED run retires it.
    scout.record_attempt(
        tmp_path, tgt,
        {"status": "GRADED", "generated_at": "t1", "sha256": "abc", "faults_extracted": 0},
    )
    hist = scout._load_history(tmp_path)
    assert scout._graded_families(hist) == {tgt["pack_id"]}
    # Corrupt history is tolerated (never crashes a run).
    (tmp_path / "history.json").write_text("{not json", encoding="utf-8")
    assert scout._load_history(tmp_path) == []


def _base(**kw):
    r = {
        "target": "durapulse_gs20",
        "series": "DURApulse GS20",
        "manufacturer": "AutomationDirect",
        "source_url": "https://example/gs20m.pdf",
        "generated_at": "2026-07-13T00-00-00Z",
        "status": "GRADED",
        "faults_extracted": 0,
        "params_extracted": 0,
    }
    r.update(kw)
    return r


def test_empty_pack_is_not_sold_as_a_grade():
    # 0 entries extracted -> the headline is the recall gap, NOT the vacuous
    # schema/domain grade the empty pack would score.
    r = _base(report={"grade": "B", "overall_score": 85.7, "incomplete": True})
    subject, text, _ = scout.render_evaluation(r)
    assert "0 entries" in subject.lower() or "generalization gap" in subject.lower()
    assert "85.7/100" not in subject
    assert "NOT a quality signal" in text


def test_nonempty_pack_shows_the_grade():
    r = _base(
        faults_extracted=12,
        params_extracted=30,
        report={"grade": "B", "overall_score": 88, "incomplete": False,
                "promotion_recommendation": "review", "categories": {}, "critical_failures": []},
    )
    subject, _, _ = scout.render_evaluation(r)
    assert "88/100" in subject


def test_failure_status_renders_honestly():
    r = _base(status="FETCH_FAILURE", error="ConnectTimeout: boom", report=None)
    subject, text, _ = scout.render_evaluation(r)
    assert "FETCH_FAILURE" in subject
    assert "boom" in text


def test_build_pack_is_schema_shaped():
    fragment = {
        "fault_codes": {"F1": {"name": "x"}},
        "fault_citations": [{"doc": "d", "page": 3, "excerpt": "F1 x"}],
        "parameters": [{"parameter_id": "P1"}],
    }
    target = scout.SCOUT_TARGETS[0]
    pack = scout.build_pack(fragment, target, "note")
    for key in scout._REQUIRED_TOP_LEVEL_KEYS:
        assert key in pack, f"missing {key}"
    assert pack["family"]["manufacturer"] == target["manufacturer"]
    assert pack["provenance"]["sources"][0]["page"] == "3"  # coerced to str
