"""Tests for the PR merge-blocker resolver (tools/pr_merge_blocker.py).

Issue #3109: a bare `mergeStateStatus == "BLOCKED"` is a catch-all that also
lags reality, so reporting it verbatim cries wolf. These tests pin the two
failure modes that have actually bitten — the stale aggregate (#3106) and the
"anything not SUCCESS is a failure" misclassification that reads running checks
as red (#3111) — plus the required-context intersection that a scan of reported
checks alone cannot do.

`tools/` is not a Python package, so the module is loaded by file path.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "pr_merge_blocker.py"
_spec = importlib.util.spec_from_file_location("pr_merge_blocker", _MODULE_PATH)
assert _spec and _spec.loader
pmb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pmb)


REQUIRED = ["staging-gate", "CI Gate"]
PROTECTION = {"contexts": REQUIRED, "strict": True}


def _pr(**overrides):
    """An open, non-draft, unreviewed, mergeable PR — override one field per test."""
    base = {
        "number": 1,
        "state": "OPEN",
        "isDraft": False,
        "mergeable": "MERGEABLE",
        "mergeStateStatus": "CLEAN",
        "reviewDecision": "",
        "baseRefName": "main",
    }
    base.update(overrides)
    return base


def _check(name, state, started="2026-08-09T10:00:00Z"):
    return {"name": name, "state": state, "startedAt": started}


def _all_required_passing():
    return [_check(n, "SUCCESS") for n in REQUIRED]


# --- The #3106 case: the aggregate is stale ---------------------------------


def test_stale_blocked_with_everything_passing_reports_clean_not_blocked():
    """The bug this tool exists for: BLOCKED while nothing is pending or failed."""
    verdict = pmb.classify(_pr(mergeStateStatus="BLOCKED"), PROTECTION, _all_required_passing())
    assert verdict.exit_code == pmb.EXIT_CLEAN
    assert verdict.code == "CLEAN"
    assert "status was stale" in verdict.lines[0]
    assert "BLOCKED" in verdict.lines[0]


def test_genuinely_clean_reports_clean_without_the_stale_caveat():
    verdict = pmb.classify(_pr(), PROTECTION, _all_required_passing())
    assert verdict.exit_code == pmb.EXIT_CLEAN
    assert verdict.lines == ["CLEAN"]


def test_no_verdict_is_ever_a_bare_blocked():
    """Whatever happens, the word BLOCKED is never the report — only a cause is."""
    scenarios = [
        (_pr(mergeStateStatus="BLOCKED"), PROTECTION, _all_required_passing()),
        (_pr(), PROTECTION, [_check("staging-gate", "FAILURE"), _check("CI Gate", "SUCCESS")]),
        (_pr(), PROTECTION, [_check("staging-gate", "IN_PROGRESS"), _check("CI Gate", "SUCCESS")]),
        (_pr(isDraft=True), PROTECTION, _all_required_passing()),
        (_pr(mergeable="CONFLICTING"), PROTECTION, _all_required_passing()),
        (_pr(), None, _all_required_passing()),
    ]
    for pr, protection, checks in scenarios:
        verdict = pmb.classify(pr, protection, checks)
        for line in verdict.lines:
            assert not line.strip().startswith("BLOCKED"), line


# --- The #3111 case: running checks are pending, not failed -----------------


def test_queued_and_in_progress_are_pending_not_failed():
    """`state != SUCCESS` is NOT `failed` — that reads running checks as red."""
    for running in ("QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "REQUESTED"):
        verdict = pmb.classify(
            _pr(mergeStateStatus="BLOCKED"),
            PROTECTION,
            [_check("staging-gate", running), _check("CI Gate", "SUCCESS")],
        )
        assert verdict.exit_code == pmb.EXIT_BLOCKED
        assert verdict.code == "PENDING", running
        assert "staging-gate" in verdict.lines[0]
        assert "FAILED" not in verdict.lines[0]


def test_skipped_and_neutral_count_as_passing():
    verdict = pmb.classify(
        _pr(), PROTECTION, [_check("staging-gate", "SKIPPED"), _check("CI Gate", "NEUTRAL")]
    )
    assert verdict.exit_code == pmb.EXIT_CLEAN


def test_terminal_unsuccessful_states_are_failures():
    for bad in ("FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STALE"):
        verdict = pmb.classify(
            _pr(mergeStateStatus="BLOCKED"),
            PROTECTION,
            [_check("staging-gate", bad), _check("CI Gate", "SUCCESS")],
        )
        assert verdict.exit_code == pmb.EXIT_BLOCKED
        assert verdict.code == "FAILED", bad
        assert "staging-gate [%s]" % bad in verdict.lines[0]


def test_unrecognized_state_is_pending_and_named_never_silently_passing():
    verdict = pmb.classify(
        _pr(), PROTECTION, [_check("staging-gate", "SOMETHING_NEW"), _check("CI Gate", "SUCCESS")]
    )
    assert verdict.exit_code == pmb.EXIT_BLOCKED
    assert verdict.code == "PENDING"
    assert "SOMETHING_NEW" in verdict.lines[0]


def test_rerun_takes_the_latest_attempt_so_a_fixed_failure_clears():
    """A re-run leaves the old row in the response; the newer one wins."""
    checks = [
        _check("staging-gate", "FAILURE", "2026-08-09T10:00:00Z"),
        _check("staging-gate", "SUCCESS", "2026-08-09T11:00:00Z"),
        _check("CI Gate", "SUCCESS"),
    ]
    verdict = pmb.classify(_pr(), PROTECTION, checks)
    assert verdict.exit_code == pmb.EXIT_CLEAN


# --- Required-context intersection ------------------------------------------


def test_required_context_that_never_reported_is_pending_not_passing():
    """Invisible to any scan of reported checks — this is why protection is read."""
    verdict = pmb.classify(
        _pr(mergeStateStatus="BLOCKED"), PROTECTION, [_check("CI Gate", "SUCCESS")]
    )
    assert verdict.exit_code == pmb.EXIT_BLOCKED
    assert verdict.code == "PENDING"
    assert "staging-gate (never reported)" in verdict.lines[0]


def test_a_failing_non_required_check_does_not_block():
    """Only required contexts gate the merge — an advisory red must not cry wolf."""
    checks = _all_required_passing() + [_check("AI Code Review", "FAILURE")]
    verdict = pmb.classify(_pr(), PROTECTION, checks)
    assert verdict.exit_code == pmb.EXIT_CLEAN
    assert verdict.lines == ["CLEAN"]


# --- Blockers that are not check states -------------------------------------


def test_draft_blocks_however_green():
    verdict = pmb.classify(_pr(isDraft=True), PROTECTION, _all_required_passing())
    assert verdict.exit_code == pmb.EXIT_BLOCKED
    assert verdict.code == "DRAFT"


def test_conflicting_blocks():
    verdict = pmb.classify(
        _pr(mergeable="CONFLICTING", mergeStateStatus="DIRTY"),
        PROTECTION,
        _all_required_passing(),
    )
    assert verdict.exit_code == pmb.EXIT_BLOCKED
    assert verdict.code == "CONFLICTING"


def test_behind_blocks():
    verdict = pmb.classify(_pr(mergeStateStatus="BEHIND"), PROTECTION, _all_required_passing())
    assert verdict.exit_code == pmb.EXIT_BLOCKED
    assert verdict.code == "BEHIND"


def test_review_gates_block():
    for decision in ("REVIEW_REQUIRED", "CHANGES_REQUESTED"):
        verdict = pmb.classify(
            _pr(reviewDecision=decision, mergeStateStatus="BLOCKED"),
            PROTECTION,
            _all_required_passing(),
        )
        assert verdict.exit_code == pmb.EXIT_BLOCKED
        assert verdict.code == "REVIEW_REQUIRED", decision


def test_approved_review_is_not_a_blocker():
    verdict = pmb.classify(_pr(reviewDecision="APPROVED"), PROTECTION, _all_required_passing())
    assert verdict.exit_code == pmb.EXIT_CLEAN


def test_every_applicable_blocker_is_named_not_just_the_first():
    verdict = pmb.classify(
        _pr(isDraft=True, mergeable="CONFLICTING", reviewDecision="CHANGES_REQUESTED"),
        PROTECTION,
        [_check("staging-gate", "FAILURE"), _check("CI Gate", "IN_PROGRESS")],
    )
    joined = "\n".join(verdict.lines)
    for expected in ("CONFLICTING", "DRAFT", "FAILED", "PENDING", "REVIEW_REQUIRED"):
        assert expected in joined, expected


# --- Honest degradation ------------------------------------------------------


def test_unreadable_protection_is_unknown_never_clean():
    """No admin scope → required set unknown → must not claim CLEAN."""
    verdict = pmb.classify(_pr(), None, _all_required_passing())
    assert verdict.exit_code == pmb.EXIT_UNKNOWN
    assert verdict.code == "UNKNOWN"
    assert not any(line.startswith("CLEAN") for line in verdict.lines)


def test_uncomputed_mergeability_is_unknown_never_clean():
    """`mergeable=UNKNOWN` means "not computed yet", NOT "no conflict"."""
    verdict = pmb.classify(
        _pr(mergeable="UNKNOWN", mergeStateStatus="UNKNOWN"),
        PROTECTION,
        _all_required_passing(),
    )
    assert verdict.exit_code == pmb.EXIT_UNKNOWN
    assert verdict.code == "UNKNOWN"
    assert not any(line.startswith("CLEAN") for line in verdict.lines)
    assert "mergeability not computed" in verdict.lines[0]


def test_both_unknowns_are_reported_together():
    verdict = pmb.classify(_pr(mergeable="UNKNOWN"), None, _all_required_passing())
    joined = "\n".join(verdict.lines)
    assert "branch protection unreadable" in joined
    assert "mergeability not computed" in joined


def test_unreadable_protection_still_reports_advisory_findings():
    verdict = pmb.classify(
        _pr(), None, [_check("staging-gate", "FAILURE"), _check("CI Gate", "SUCCESS")]
    )
    assert verdict.exit_code == pmb.EXIT_UNKNOWN
    assert "staging-gate" in "\n".join(verdict.lines)


# --- Terminal PR states ------------------------------------------------------


def test_merged_pr_is_not_a_blocker():
    verdict = pmb.classify(_pr(state="MERGED", mergeStateStatus="UNKNOWN"), PROTECTION, [])
    assert verdict.exit_code == pmb.EXIT_CLEAN
    assert verdict.code == "MERGED"


def test_closed_pr_is_reported_as_closed():
    verdict = pmb.classify(_pr(state="CLOSED"), PROTECTION, [])
    assert verdict.exit_code == pmb.EXIT_BLOCKED
    assert verdict.code == "CLOSED"


# --- Bucket hygiene ----------------------------------------------------------


def test_state_buckets_are_disjoint():
    assert not (pmb.PENDING_STATES & pmb.FAILED_STATES)
    assert not (pmb.PENDING_STATES & pmb.PASSING_STATES)
    assert not (pmb.FAILED_STATES & pmb.PASSING_STATES)


# --- The fetch seam (no network — subprocess/_gh_json are stubbed) -----------


class _Proc:
    def __init__(self, stdout, returncode=0):
        self.stdout = stdout
        self.returncode = returncode


def test_gh_json_trusts_stdout_not_the_exit_code(monkeypatch):
    """`gh pr checks` overloads its exit code to report CHECK state (1=failed,
    8=pending), not command failure. Gating on it would empty the check list for
    exactly the PRs that have a failing check — turning FAILED into PENDING."""
    monkeypatch.setattr(
        pmb.subprocess, "run", lambda *a, **k: _Proc('[{"name":"x"}]', returncode=1)
    )
    assert pmb._gh_json(["pr", "checks", "1", "--json", "name"]) == [{"name": "x"}]


def test_gh_json_returns_none_on_empty_or_unparseable_output(monkeypatch):
    for stdout in ("", "   ", "not json at all"):
        monkeypatch.setattr(pmb.subprocess, "run", lambda *a, **k: _Proc(stdout))
        assert pmb._gh_json(["pr", "view", "1"]) is None


def test_gh_json_returns_none_when_gh_is_missing(monkeypatch):
    def _boom(*a, **k):
        raise OSError("gh: not found")

    monkeypatch.setattr(pmb.subprocess, "run", _boom)
    assert pmb._gh_json(["pr", "view", "1"]) is None


def test_fetch_pr_requeries_while_mergeability_is_uncomputed(monkeypatch):
    """The 're-query directly' remedy: asking is what makes GitHub compute it."""
    responses = [
        {"mergeable": "UNKNOWN", "state": "OPEN"},
        {"mergeable": "MERGEABLE", "state": "OPEN", "mergeStateStatus": "BEHIND"},
    ]
    calls = []

    def _fake(args):
        calls.append(args)
        return responses[min(len(calls) - 1, len(responses) - 1)]

    monkeypatch.setattr(pmb, "_gh_json", _fake)
    monkeypatch.setattr(pmb.time, "sleep", lambda _s: None)
    got = pmb.fetch_pr("1")
    assert got["mergeable"] == "MERGEABLE"
    assert len(calls) == 2  # stopped as soon as it resolved


def test_fetch_pr_gives_up_after_the_attempt_budget(monkeypatch):
    """Still UNKNOWN after retrying → return it, so classify() reports UNKNOWN."""
    calls = []

    def _fake(args):
        calls.append(args)
        return {"mergeable": "UNKNOWN", "state": "OPEN"}

    monkeypatch.setattr(pmb, "_gh_json", _fake)
    monkeypatch.setattr(pmb.time, "sleep", lambda _s: None)
    got = pmb.fetch_pr("1", attempts=3)
    assert len(calls) == 3
    assert pmb.classify(got, PROTECTION, []).exit_code == pmb.EXIT_UNKNOWN


def test_fetch_pr_returns_none_when_the_pr_cannot_be_read(monkeypatch):
    monkeypatch.setattr(pmb, "_gh_json", lambda args: None)
    assert pmb.fetch_pr("1") is None


def test_latest_checks_handles_missing_timestamps():
    got = pmb.latest_checks(
        [
            {"name": "x", "state": "FAILURE"},
            {"name": "x", "state": "SUCCESS", "startedAt": "2026-01-01T00:00:00Z"},
        ]
    )
    assert got["x"]["state"] == "SUCCESS"
