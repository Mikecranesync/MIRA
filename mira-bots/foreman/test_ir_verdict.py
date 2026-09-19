"""Regression tests for empty-result and stale-head IR coordinator failures."""
from __future__ import annotations

from ir_verdict import (
    MAX_IDENTICAL_EMPTY_RELAUNCHES,
    Outcome,
    ReviewArtifact,
    TaskSnapshot,
    classify_terminal_session,
    counts_as_approval,
    is_stale_for_head,
    parse_github_ir_comment,
    should_relaunch_ir,
)


HEAD_OLD = "269bab858bd46aa1a13d00e1942738fab4f85ee9"
HEAD_NEW = "818b11bf323901f6fc578fd6dfeb835e6a0b2eca"
HEAD_3808 = "dda698585e8cad674dd084ef5706bf85e7a375ed"


def _art(outcome: Outcome, head: str) -> ReviewArtifact:
    return ReviewArtifact(
        repo="Mikecranesync/MIRA",
        pr=3832,
        head_sha=head,
        base_sha="f10b687c6fcc63e8bc4c04206d13bab27a00d3ba",
        reviewer="charlie-claude",
        task_id="PR-3832-IR",
        session_id="cao-test",
        outcome=outcome,
        evidence="unit",
    )


def test_stale_pass_cannot_approve_new_head():
    art = _art(Outcome.PASS, HEAD_OLD)
    assert is_stale_for_head(art, HEAD_NEW) is True
    assert counts_as_approval(art, HEAD_NEW) is False
    assert counts_as_approval(art, HEAD_OLD) is True


def test_stopped_null_verdict_is_error_not_silent():
    task = TaskSnapshot(
        task_id="PR-3808-IR-dda69858",
        session_id="cao-PR-3808-IR-dda69858-59d53c72",
        commit=HEAD_3808,
        status="stopped",
        review_verdict=None,
        done=False,
        handoff=None,
    )
    assert classify_terminal_session(task, expected_head=HEAD_3808) == Outcome.ERROR


def test_successful_exit_without_artifact_is_error():
    task = TaskSnapshot(
        task_id="PR-3832-IR-818b11bf",
        session_id="cao-empty",
        commit=HEAD_NEW,
        status="stopped",
        review_verdict="",
        done=True,
        handoff=None,
    )
    assert classify_terminal_session(task, expected_head=HEAD_NEW) == Outcome.ERROR


def test_github_pass_comment_counts():
    body = "## Independent Review — PASS (with one CI-wiring gap flagged)\n**Reviewed tip:** `269bab858bd46aa1a13d00e1942738fab4f85ee9`"
    assert parse_github_ir_comment(body) == Outcome.PASS


def test_staging_gate_pass_does_not_count_as_ir():
    body = "### MIRA staging gate — ✅ PASS\n_Engine + NeonDB_"
    assert parse_github_ir_comment(body) is None


def test_bounded_relaunch_stops_after_identical_empty_exits():
    ok, reason = should_relaunch_ir(
        current_head=HEAD_3808,
        latest_artifact=None,
        empty_exit_count_for_head=MAX_IDENTICAL_EMPTY_RELAUNCHES,
        latch_free=True,
        active_claim_covers_tip=False,
    )
    assert ok is False
    assert "diagnose" in reason


def test_relaunch_allowed_when_under_bound_and_no_verdict():
    ok, reason = should_relaunch_ir(
        current_head=HEAD_NEW,
        latest_artifact=None,
        empty_exit_count_for_head=1,
        latch_free=True,
        active_claim_covers_tip=False,
    )
    assert ok is True


def test_pass_on_tip_blocks_relaunch():
    ok, reason = should_relaunch_ir(
        current_head=HEAD_NEW,
        latest_artifact=_art(Outcome.PASS, HEAD_NEW),
        empty_exit_count_for_head=0,
        latch_free=True,
        active_claim_covers_tip=False,
    )
    assert ok is False
    assert "PASS already" in reason


def test_stale_pass_allows_relaunch_on_new_tip():
    ok, _ = should_relaunch_ir(
        current_head=HEAD_NEW,
        latest_artifact=_art(Outcome.PASS, HEAD_OLD),
        empty_exit_count_for_head=0,
        latch_free=True,
        active_claim_covers_tip=False,
    )
    assert ok is True


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
