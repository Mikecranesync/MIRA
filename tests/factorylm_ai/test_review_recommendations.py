"""Review-by-exception generator — safety invariants.

Server-side enforcement is proven by the console selftest
(tools/factorylm_ai/review_console_v2/server.py --selftest); these tests pin
the GENERATOR's policy: unsafe cards can never be recommended, the model
being trained can never be the independent reviewer, and disagreement or
missing/low-confidence verdicts always route to individual review.
"""

from __future__ import annotations

import pytest

from factorylm_ai.dataset import review_recommendations as rr


def _candidate(**over):
    base = {
        "record_id": "r1",
        "split": "train",
        "rights": {"training_allowed": True},
        "interaction_type": "diagnostic",
        "safety": {"safety_sensitive": False},
        "answer_key": {
            "evidence_hash": "ev1",
            "withheld_payload": {"claim": "F9 is Overvoltage with numeric code 9"},
        },
        "messages": [
            {"role": "system", "content": "sys"},
            {
                "role": "user",
                "content": "Identify F9.\nEvidence (pack, page 3): F9 is Overvoltage with "
                "numeric code 9.",
            },
            {
                "role": "assistant",
                "content": "Per the provided evidence: F9 is Overvoltage "
                "with numeric code 9. Not authorization for energized work.",
            },
        ],
    }
    base.update(over)
    return base


def _verdict(
    content_hash="h1", verdict="approve", confidence=0.95, reviewer="claude-sonnet-independent"
):
    return {
        content_hash: rr.IndependentVerdict(
            reviewer_id=reviewer, content_hash=content_hash, verdict=verdict, confidence=confidence
        )
    }


def _run(cand, verdicts):
    return rr.build_recommendations(
        [cand], verdicts, manifest_sha256="m1", content_hash_of={cand["record_id"]: "h1"}
    )[0]


def test_happy_path_is_auto_approve_ok() -> None:
    row = _run(_candidate(), _verdict())
    assert row["recommendation"] == "auto_approve_ok"
    assert row["reasons"] == []
    assert row["policy_version"] == rr.POLICY_VERSION
    assert row["evidence_hash"] == "ev1"
    assert row["independent_reviewer"] == "claude-sonnet-independent"


@pytest.mark.parametrize(
    ("override", "reason"),
    [
        ({"safety": {"safety_sensitive": True}}, rr.REASON_SAFETY),
        ({"split": "held_out"}, rr.REASON_SPLIT),
        ({"rights": {"training_allowed": False}}, rr.REASON_SPLIT),
        ({"interaction_type": "correction"}, rr.REASON_CORRECTION),
        ({"messages": [{"role": "user", "content": "only user"}]}, rr.REASON_SCHEMA),
    ],
)
def test_unsafe_cards_always_individual(override, reason) -> None:
    row = _run(_candidate(**override), _verdict())
    assert row["recommendation"] == "individual_review"
    assert reason in row["reasons"]


def test_evidence_contract_violation_is_individual() -> None:
    cand = _candidate()
    cand["messages"][1]["content"] = "Identify F9."  # claim no longer in user turn
    row = _run(cand, _verdict())
    assert row["recommendation"] == "individual_review"
    assert rr.REASON_CONTRACT in row["reasons"]


def test_unreadable_text_is_individual() -> None:
    cand = _candidate()
    cand["messages"][2]["content"] = "garbled �� answer"
    row = _run(cand, _verdict())
    assert rr.REASON_UNREADABLE in row["reasons"]


def test_missing_verdict_is_individual() -> None:
    row = _run(_candidate(), {})
    assert row["recommendation"] == "individual_review"
    assert rr.REASON_NO_VERDICT in row["reasons"]


def test_low_confidence_is_individual() -> None:
    row = _run(_candidate(), _verdict(confidence=0.5))
    assert rr.REASON_LOW_CONF in row["reasons"]


def test_reviewer_disagreement_is_individual() -> None:
    row = _run(_candidate(), _verdict(verdict="flag"))
    assert rr.REASON_CONFLICT in row["reasons"]


@pytest.mark.parametrize(
    "reviewer",
    [
        "mike_578c/Qwen3.5-9B-technician-v0-47089483",
        "technician-v1-checkpoint",
        "MIKE-578C/anything",
    ],
)
def test_model_under_training_can_never_be_the_reviewer(reviewer, tmp_path) -> None:
    p = tmp_path / "verdicts.jsonl"
    p.write_text(
        '{"reviewer_id": "%s", "content_hash": "h1", "verdict": "approve", "confidence": 1.0}\n'
        % reviewer,
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="never approve its own training examples"):
        rr._load_verdicts(p)
