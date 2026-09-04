"""Hermetic tests for mission_loop.py proving AC A–H.

No live Gateway, tunnel, Doppler, VPS, or secret access. All tests are offline.

AC reference: docs/missions/AUTONOMOUS-FOREMAN-V1.md
Issue: https://github.com/Mikecranesync/MIRA/issues/3566
"""

from __future__ import annotations

import json

import pytest
from mission_loop import (
    FORBIDDEN_ACTIONS,
    HELD_PR_NUMBERS,
    ForemanPolicy,
    GoNoGo,
    MissionState,
    Worker,
    WorkerRole,
    WorkerState,
)

BASE_SHA = "d16faa5ed000a22319cf45688aff3293a0c1db6f"
HEAD_SHA = "a" * 40
PR_URL = "https://github.com/Mikecranesync/MIRA/pull/9999"


def _fresh_state() -> MissionState:
    return MissionState(
        mission_id="AUTONOMOUS-FOREMAN-V1",
        base_sha=BASE_SHA,
        branch="fleet/AUTONOMOUS-FOREMAN-V1",
    )


def _fresh_policy() -> ForemanPolicy:
    return ForemanPolicy(_fresh_state())


# ---------------------------------------------------------------------------
# AC A — manager ≠ implementer
# ---------------------------------------------------------------------------


class TestACManagerNotImplementer:
    def test_policy_has_no_open_worktree_method(self):
        """ForemanPolicy must never grow an open_worktree — manager ≠ implementer."""
        policy = _fresh_policy()
        assert not hasattr(policy, "open_worktree")

    def test_policy_has_no_edit_file_method(self):
        """ForemanPolicy must never grow an edit_file — manager ≠ implementer."""
        policy = _fresh_policy()
        assert not hasattr(policy, "edit_file")

    def test_policy_has_no_commit_method(self):
        """ForemanPolicy must never grow a commit — manager ≠ implementer."""
        policy = _fresh_policy()
        assert not hasattr(policy, "commit")

    def test_dispatch_implementer_is_allowed(self):
        """Dispatching a worker IS the manager's job (AC A)."""
        policy = _fresh_policy()
        result = policy.dispatch_implementer(session_id="sess-abc123")
        assert result.allowed, result.reason


# ---------------------------------------------------------------------------
# AC B — max one implementation worker
# ---------------------------------------------------------------------------


class TestACMaxOneImplementer:
    def test_second_implementer_refused_when_first_running(self):
        policy = _fresh_policy()
        r1 = policy.dispatch_implementer(session_id="sess-1")
        assert r1.allowed

        r2 = policy.dispatch_implementer(session_id="sess-2")
        assert not r2.allowed
        assert "running" in r2.reason.lower()

    def test_new_implementer_allowed_after_first_stopped(self):
        policy = _fresh_policy()
        policy.dispatch_implementer(session_id="sess-1")
        policy.stop_implementer(head_sha=HEAD_SHA)

        result = policy.dispatch_implementer(session_id="sess-2")
        assert result.allowed, result.reason

    def test_reviewer_does_not_block_implementer_slot(self):
        """Reviewers do not count as implementation workers (AC B)."""
        policy = _fresh_policy()
        # Implementer does its work and stops.
        policy.dispatch_implementer(session_id="impl-1")
        policy.stop_implementer(head_sha=HEAD_SHA)

        # Reviewer is active.
        policy.dispatch_reviewer(git_ref=HEAD_SHA, session_id="rev-1")

        # A fix-round implementer should still be allowed.
        result = policy.dispatch_implementer(session_id="impl-fix")
        assert result.allowed, result.reason

    def test_can_dispatch_implementer_reflects_state(self):
        policy = _fresh_policy()
        assert policy.can_dispatch_implementer().allowed

        policy.dispatch_implementer(session_id="sess-1")
        assert not policy.can_dispatch_implementer().allowed

        policy.stop_implementer()
        assert policy.can_dispatch_implementer().allowed


# ---------------------------------------------------------------------------
# AC C — Charlie reviews an exact SHA
# ---------------------------------------------------------------------------


class TestACExactSHAForReview:
    def test_valid_40char_sha_accepted(self):
        policy = _fresh_policy()
        result = policy.can_dispatch_reviewer(BASE_SHA)
        assert result.allowed, result.reason

    def test_branch_name_rejected(self):
        policy = _fresh_policy()
        result = policy.can_dispatch_reviewer("fleet/AUTONOMOUS-FOREMAN-V1")
        assert not result.allowed
        assert "sha" in result.reason.lower()

    def test_origin_main_rejected(self):
        policy = _fresh_policy()
        result = policy.can_dispatch_reviewer("origin/main")
        assert not result.allowed

    def test_prose_summary_rejected(self):
        policy = _fresh_policy()
        result = policy.can_dispatch_reviewer("the head of the foreman branch")
        assert not result.allowed

    def test_short_sha_rejected(self):
        policy = _fresh_policy()
        result = policy.can_dispatch_reviewer("d16faa5")
        assert not result.allowed

    def test_uppercase_sha_rejected(self):
        """SHA_RE requires lowercase hex."""
        policy = _fresh_policy()
        result = policy.can_dispatch_reviewer(BASE_SHA.upper())
        assert not result.allowed

    def test_reviewer_must_be_charlie(self):
        policy = _fresh_policy()
        result = policy.dispatch_reviewer(git_ref=HEAD_SHA, session_id="rev-1", node="bravo")
        assert not result.allowed
        assert "charlie" in result.reason.lower()

    def test_reviewer_must_use_codex(self):
        policy = _fresh_policy()
        result = policy.dispatch_reviewer(git_ref=HEAD_SHA, session_id="rev-1", provider="claude")
        assert not result.allowed
        assert "codex" in result.reason.lower()

    def test_valid_reviewer_dispatch_records_sha(self):
        policy = _fresh_policy()
        result = policy.dispatch_reviewer(git_ref=HEAD_SHA, session_id="rev-1")
        assert result.allowed
        assert policy.state.reviewer is not None
        assert policy.state.reviewer.git_ref == HEAD_SHA
        assert policy.state.reviewer.node == "charlie"
        assert policy.state.reviewer.provider == "codex"


# ---------------------------------------------------------------------------
# AC D — no merge / no deploy
# ---------------------------------------------------------------------------


class TestACNoMergeDeploy:
    def test_can_merge_with_pr_number_always_false(self):
        policy = _fresh_policy()
        result = policy.can_merge(pr_number=9999)
        assert not result.allowed

    def test_can_merge_no_args_also_false(self):
        policy = _fresh_policy()
        result = policy.can_merge()
        assert not result.allowed

    def test_can_deploy_always_false(self):
        policy = _fresh_policy()
        result = policy.can_deploy()
        assert not result.allowed

    def test_merge_in_forbidden_actions(self):
        assert "merge" in FORBIDDEN_ACTIONS

    def test_deploy_in_forbidden_actions(self):
        assert "deploy" in FORBIDDEN_ACTIONS

    def test_gh_pr_merge_in_forbidden_actions(self):
        assert "gh_pr_merge" in FORBIDDEN_ACTIONS

    def test_deploy_vps_in_forbidden_actions(self):
        assert "deploy_vps" in FORBIDDEN_ACTIONS

    def test_vps_compose_restart_in_forbidden_actions(self):
        assert "vps_compose_restart" in FORBIDDEN_ACTIONS


# ---------------------------------------------------------------------------
# AC E — HELD stays HELD
# ---------------------------------------------------------------------------


class TestACHeldStaysHeld:
    def test_pr_3533_is_held(self):
        policy = _fresh_policy()
        assert policy.is_pr_held(3533)

    def test_pr_3558_is_held(self):
        policy = _fresh_policy()
        assert policy.is_pr_held(3558)

    def test_held_pr_3533_refused(self):
        policy = _fresh_policy()
        result = policy.can_touch_pr(3533)
        assert not result.allowed
        assert "held" in result.reason.lower()

    def test_held_pr_3558_refused(self):
        policy = _fresh_policy()
        result = policy.can_touch_pr(3558)
        assert not result.allowed

    def test_pr_with_held_in_title_refused(self):
        policy = _fresh_policy()
        result = policy.can_touch_pr(9999, title="[HELD] some feature PR")
        assert not result.allowed

    def test_held_marker_case_insensitive(self):
        policy = _fresh_policy()
        result = policy.can_touch_pr(9999, title="held: important feature")
        assert not result.allowed

    def test_normal_pr_allowed(self):
        policy = _fresh_policy()
        result = policy.can_touch_pr(9001)
        assert result.allowed

    def test_held_prs_in_constant(self):
        assert 3533 in HELD_PR_NUMBERS
        assert 3558 in HELD_PR_NUMBERS


# ---------------------------------------------------------------------------
# AC F — hard boundaries
# ---------------------------------------------------------------------------


class TestACHardBoundaries:
    @pytest.mark.parametrize(
        "action",
        [
            "merge",
            "deploy",
            "gh_pr_merge",
            "deploy_vps",
            "vps_compose_restart",
            "vps_compose_up",
            "vps_compose_down",
            "gateway_config",
            "gateway_restart",
            "cloudflare_config",
            "tailscale_config",
            "tunnel_config",
            "doppler_read",
            "doppler_copy",
            "secret_print",
            "pay_vendor_bill",
            "stop_unowned_session",
            "delete_unowned_worktree",
        ],
    )
    def test_forbidden_action_refused(self, action: str):
        policy = _fresh_policy()
        result = policy.validate_action(action)
        assert not result.allowed, f"Expected {action!r} to be refused"

    def test_inspect_github_issues_allowed(self):
        policy = _fresh_policy()
        result = policy.validate_action("inspect_github_issues")
        assert result.allowed

    def test_rank_open_issues_allowed(self):
        policy = _fresh_policy()
        result = policy.validate_action("rank_open_issues")
        assert result.allowed

    def test_post_draft_pr_allowed(self):
        policy = _fresh_policy()
        result = policy.validate_action("post_draft_pr")
        assert result.allowed


# ---------------------------------------------------------------------------
# AC G — GitHub is source of truth (round-trip serialization)
# ---------------------------------------------------------------------------


class TestACGitHubSourceOfTruth:
    def test_mission_state_serializes_to_json(self):
        state = _fresh_state()
        json_str = state.to_json()
        data = json.loads(json_str)
        assert data["mission_id"] == "AUTONOMOUS-FOREMAN-V1"
        assert data["base_sha"] == BASE_SHA

    def test_mission_state_roundtrips_without_workers(self):
        state = _fresh_state()
        restored = MissionState.from_json(state.to_json())
        assert restored.mission_id == state.mission_id
        assert restored.base_sha == state.base_sha
        assert restored.branch == state.branch
        assert restored.implementer is None
        assert restored.reviewer is None

    def test_mission_state_roundtrips_with_implementer(self):
        state = _fresh_state()
        state.pr_url = PR_URL
        state.head_sha = HEAD_SHA
        state.implementer = Worker(
            role=WorkerRole.IMPLEMENTER,
            state=WorkerState.STOPPED,
            session_id="sess-abc",
            node="bravo",
            provider="claude",
            git_ref=HEAD_SHA,
        )
        restored = MissionState.from_json(state.to_json())
        assert restored.pr_url == PR_URL
        assert restored.head_sha == HEAD_SHA
        assert restored.implementer is not None
        assert restored.implementer.session_id == "sess-abc"
        assert restored.implementer.role == WorkerRole.IMPLEMENTER
        assert restored.implementer.state == WorkerState.STOPPED

    def test_mission_state_roundtrips_with_reviewer(self):
        state = _fresh_state()
        state.reviewer_verdict = "PASS"
        state.reviewer = Worker(
            role=WorkerRole.REVIEWER,
            state=WorkerState.STOPPED,
            session_id="rev-xyz",
            node="charlie",
            provider="codex",
            git_ref=HEAD_SHA,
        )
        restored = MissionState.from_json(state.to_json())
        assert restored.reviewer_verdict == "PASS"
        assert restored.reviewer is not None
        assert restored.reviewer.node == "charlie"
        assert restored.reviewer.provider == "codex"

    def test_policy_save_and_load(self):
        policy = _fresh_policy()
        policy.dispatch_implementer("sess-123")

        saved = policy.save_state()
        restored = ForemanPolicy.load_state(saved)

        impl = restored.state.implementer
        assert impl is not None
        assert impl.session_id == "sess-123"
        assert impl.state == WorkerState.RUNNING

    def test_policy_save_is_valid_json(self):
        policy = _fresh_policy()
        saved = policy.save_state()
        parsed = json.loads(saved)
        assert isinstance(parsed, dict)
        assert "mission_id" in parsed

    def test_slack_only_state_not_acceptable(self):
        """State must be dict-serializable — Slack memory is not enough (AC G)."""
        state = _fresh_state()
        state.go_no_go = "GO"
        d = state.to_dict()
        assert "go_no_go" in d
        assert isinstance(d, dict)


# ---------------------------------------------------------------------------
# AC H — GO/NO-GO shape
# ---------------------------------------------------------------------------


class TestACGoNoGoShape:
    def test_no_go_when_no_reviewer_verdict(self):
        policy = _fresh_policy()
        result = policy.evaluate_go_no_go()
        assert result.verdict == "NO-GO"

    def test_no_go_when_reviewer_fail(self):
        policy = _fresh_policy()
        policy._state.head_sha = HEAD_SHA
        policy._state.pr_url = PR_URL
        policy._state.reviewer_verdict = "FAIL"
        result = policy.evaluate_go_no_go()
        assert result.verdict == "NO-GO"

    def test_no_go_when_missing_pr_url(self):
        policy = _fresh_policy()
        policy._state.head_sha = HEAD_SHA
        policy._state.reviewer_verdict = "PASS"
        result = policy.evaluate_go_no_go()
        assert result.verdict == "NO-GO"

    def test_no_go_when_missing_head_sha(self):
        policy = _fresh_policy()
        policy._state.pr_url = PR_URL
        policy._state.reviewer_verdict = "PASS"
        result = policy.evaluate_go_no_go()
        assert result.verdict == "NO-GO"

    def test_go_when_all_conditions_met(self):
        policy = _fresh_policy()
        policy._state.head_sha = HEAD_SHA
        policy._state.pr_url = PR_URL
        policy.dispatch_reviewer(HEAD_SHA, session_id="cao-review-ac-h")
        policy.record_reviewer_verdict("PASS")
        result = policy.evaluate_go_no_go()
        assert result.verdict == "GO"

    def test_go_no_go_has_pr_url_field(self):
        policy = _fresh_policy()
        policy._state.head_sha = HEAD_SHA
        policy._state.pr_url = PR_URL
        policy._state.reviewer_verdict = "PASS"
        result = policy.evaluate_go_no_go()
        assert result.pr_url == PR_URL

    def test_go_no_go_has_exact_sha_field(self):
        policy = _fresh_policy()
        policy._state.head_sha = HEAD_SHA
        policy._state.pr_url = PR_URL
        policy._state.reviewer_verdict = "PASS"
        result = policy.evaluate_go_no_go()
        assert len(result.head_sha) == 40

    def test_go_no_go_has_reviewer_verdict_field(self):
        policy = _fresh_policy()
        policy._state.head_sha = HEAD_SHA
        policy._state.pr_url = PR_URL
        policy._state.reviewer_verdict = "PASS"
        result = policy.evaluate_go_no_go()
        assert result.reviewer_verdict == "PASS"

    def test_go_no_go_has_human_gates(self):
        policy = _fresh_policy()
        policy._state.head_sha = HEAD_SHA
        policy._state.pr_url = PR_URL
        policy._state.reviewer_verdict = "PASS"
        result = policy.evaluate_go_no_go()
        assert isinstance(result.human_gates, list)
        assert len(result.human_gates) >= 1

    def test_verdict_is_exactly_go_or_no_go(self):
        policy = _fresh_policy()
        result = policy.evaluate_go_no_go()
        assert result.verdict in ("GO", "NO-GO")

    def test_go_no_go_invalid_verdict_raises(self):
        with pytest.raises(ValueError, match="GO.*NO-GO"):
            GoNoGo(
                verdict="MAYBE",
                pr_url="",
                head_sha="",
                reviewer_verdict="",
                human_gates=[],
            )

    def test_human_gates_always_present_even_on_go(self):
        """GO still requires human merge — no auto-merge (AC D + AC H)."""
        policy = _fresh_policy()
        policy._state.head_sha = HEAD_SHA
        policy._state.pr_url = PR_URL
        policy.dispatch_reviewer(HEAD_SHA, session_id="cao-review-ac-h2")
        policy.record_reviewer_verdict("PASS")
        result = policy.evaluate_go_no_go()
        assert result.verdict == "GO"
        # Human merge gate must still be in the list.
        assert any("merge" in g.lower() or "human" in g.lower() for g in result.human_gates)
