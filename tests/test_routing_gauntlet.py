"""CI pin for the routing gauntlet (tools/routing_gauntlet/).

Two jobs:
1. The full deterministic corpus must route at 100% — every asset-state and
   diagnostic phrasing survives the adversarial router votes (including the
   observed production failure, general_question at 1.00 confidence), every
   educational/greeting/docs/off-topic phrasing stays un-hijacked, and every
   clean safety phrasing trips the keyword layer.
2. The gauntlet's replica of the engine's override rule must match the real
   engine's arbitration block — if the engine changes, the replica (and the
   corpus expectations) must change with it, loudly.

Offline, deterministic, no LLM, no DB. Runs in seconds.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "routing_gauntlet"))
sys.path.insert(0, str(REPO / "mira-bots"))

from corpus import generate  # noqa: E402
from runner import ADVERSARIAL_VOTES, apply_arbitration, run_tier1  # noqa: E402


def test_corpus_is_deterministic_and_nontrivial():
    a = generate(seed=1337)
    b = generate(seed=1337)
    assert [c.as_dict() for c in a] == [c.as_dict() for c in b]
    assert len(a) > 1500
    classes = {c.cls for c in a}
    assert {
        "asset_state",
        "diagnostic",
        "educational",
        "greeting",
        "docs",
        "safety",
        "off_topic",
    } <= classes


def test_tier1_full_corpus_routes_at_100_percent():
    cases = generate(seed=1337)
    summary = run_tier1(cases, log=lambda row: None)
    total_fail = sum(v["fail"] for v in summary["by_class"].values())
    assert total_fail == 0, f"{total_fail} routing failures — first: {summary['failures'][:3]}"
    assert summary["decisions"] > 5000


def test_replica_matches_engine():
    """The runner's override replica must agree with the engine's real block.

    Drives the probe-corpus anchor strings through both the replica and a
    hand-evaluated copy of the engine rule (threshold + override-from set).
    If someone retunes the engine's arbitration without updating the gauntlet,
    this cross-check fails before the corpus numbers silently lie.
    """
    from shared.engine import _ASSET_STATE_THRESHOLD, asset_state_probability

    anchors = [
        ("What is the current state of my garage conveyor?", "general_question", 1.0),
        ("status of CV-101", "general_question", 1.0),
        ("what's a VFD?", "general_question", 0.9),
        ("the conveyor", "general_question", 1.0),
    ]
    for msg, intent, conf in anchors:
        final, p, _parts = apply_arbitration(msg, intent, conf)
        p2, _ = asset_state_probability(msg, router_intent=intent, router_confidence=conf)
        assert p == p2
        engine_final = intent
        if p2 >= _ASSET_STATE_THRESHOLD and intent in (
            "general_question",
            "answer_question",
            "clarify_intent",
        ):
            engine_final = "diagnose_equipment"
        assert final == engine_final


def test_calibration_anchors_hold():
    """The doctrine anchors: state questions force the gate, mentions don't."""
    from shared.engine import _ASSET_STATE_THRESHOLD, asset_state_probability

    p_state, _ = asset_state_probability(
        "What is the current state of my garage conveyor?",
        router_intent="general_question",
        router_confidence=1.0,
    )
    assert p_state >= _ASSET_STATE_THRESHOLD

    p_mention, _ = asset_state_probability(
        "the conveyor", router_intent="general_question", router_confidence=1.0
    )
    assert p_mention < _ASSET_STATE_THRESHOLD

    p_edu, _ = asset_state_probability(
        "what's a VFD?", router_intent="general_question", router_confidence=0.9
    )
    assert p_edu < 0.2


def test_adversarial_votes_include_the_observed_production_failure():
    assert ("general_question", 1.0) in ADVERSARIAL_VOTES
