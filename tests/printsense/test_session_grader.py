"""Phase-3 session grader units + corpus freeze (hermetic, $0)."""

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "mira-bots"))

from printsense.benchmarks import session_cases as sc  # noqa: E402
from printsense.benchmarks import session_grader as sg  # noqa: E402


def _turn(session_id: str, turn_id: str) -> dict:
    s = next(s for s in sc.SESSIONS if s["session_id"] == session_id)
    return next(t for t in s["turns"] if t["turn_id"] == turn_id)


def test_session_expectations_frozen():
    committed = (REPO / "printsense/benchmarks/session_cases.sha256").read_text().strip()
    assert committed == sc.session_digest(), (
        "phase-3 session expectations edited without refreezing — two-file diff only"
    )
    assert not sg.expectations_frozen_ok([{**sc.SESSIONS[0], "session_id": "tampered"}])


def test_scripted_replies_satisfy_expectations():
    """Hermetic logic proof: every scripted reply passes its own turn grade,
    with facts_keep carried forward."""
    for session in sc.SESSIONS:
        kept: list[str] = []
        for turn in session["turns"]:
            claimed = bool(turn["expect"]["claimed"])
            answer = turn["scripted"]["reply"] if claimed else ""
            r = sg.grade_turn(turn, claimed, answer, kept_facts=kept, latency_s=0.01)
            assert r["status"] == "pass", (session["session_id"], turn["turn_id"], r)
            kept.extend(f for f in turn["expect"].get("facts_keep", []) if f not in kept)


def test_false_combine_is_hard_fail():
    t = _turn("s2_nonprint_refuse", "t1_mixed")
    r = sg.grade_turn(t, True, "Combined answer over a non-print set.")
    assert any(h["class"] == "path_wiring" for h in r["hard_failures"])


def test_fact_lost_detected():
    t = _turn("s1_continuation", "t2_resolved")
    r = sg.grade_turn(
        t,
        True,
        "With sheet 89 in view the continuation resolves at -X4.6.",
        kept_facts=["K891"],
    )
    classes = {h["class"] for h in r["hard_failures"]}
    assert "fact_lost" in classes or "missing_required_mention" in classes


def test_contradiction_requires_assertion():
    t = dict(_turn("s3_duplicates", "t1_dup"))
    t = {**t, "expect": {**t["expect"], "forbid_assert": ["normally closed"]}}
    honest = sg.grade_turn(
        t, True, "-91/K01 aux is 13/14 (normally open or normally closed states unknown)."
    )
    assert not any(h["class"] == "contradiction" for h in honest["hard_failures"])
    wrong = sg.grade_turn(t, True, "-91/K01 aux 13/14 is normally closed.")
    assert any(h["class"] == "contradiction" for h in wrong["hard_failures"])


def test_tag_invention_flagged():
    t = _turn("s3_duplicates", "t1_dup")
    r = sg.grade_turn(t, True, "Sheet 91 shows -91/K01 feeding K777 at 13/14 and K01.")
    assert any(h["class"] == "prose_tag_invention" for h in r["hard_failures"])


def test_state_claim_flagged():
    t = _turn("s3_duplicates", "t1_dup")
    r = sg.grade_turn(t, True, "-91/K01 (K01, 13/14) is energized so the chain is fine.")
    assert any(h["class"] == "unsupported_state_claim" for h in r["hard_failures"])


def test_revision_conflict_needs_honesty():
    t = _turn("s6_revision_conflict", "t1_conflict")
    silent = sg.grade_turn(t, True, "Both photos show sheet 91 with -91/K01 (K01).")
    assert any(h["class"] == "missing_conflict_honesty" for h in silent["hard_failures"])


def test_durability_grade_paths():
    good = sg.grade_durability(
        {"survived_restart": True, "raw_preserved": True, "caption_preserved": True}
    )
    assert good["status"] == "pass"
    bad = sg.grade_durability(
        {"survived_restart": True, "raw_preserved": False, "caption_preserved": True}
    )
    assert any(h["class"] == "durability_broken" for h in bad["hard_failures"])


def test_envelope_and_artifacts():
    results = []
    for session in sc.SESSIONS[:2]:
        kept: list[str] = []
        turns = []
        for turn in session["turns"]:
            claimed = bool(turn["expect"]["claimed"])
            answer = turn["scripted"]["reply"] if claimed else ""
            turns.append(sg.grade_turn(turn, claimed, answer, kept_facts=kept, latency_s=0.01))
            kept.extend(turn["expect"].get("facts_keep", []))
        results.append(sg.build_session_result(session, turns))
    env = sg.build_envelope(
        results,
        mode="hermetic",
        durability={"survived_restart": True, "raw_preserved": True, "caption_preserved": True},
        answers=["photograph sheet 89 next", "resolved on sheet 89"],
    )
    assert env["sessions_passed"] == 2 and not env["hard_failures"]
    assert env["recommended_missing_pages"] == ["89"]
    md = sg.render_report(env)
    js = sg.stable_envelope_json(env)
    assert sg.audit_artifact(md) == [] and sg.audit_artifact(js) == []
    assert "phase3" in sg.phone_summary(env)
