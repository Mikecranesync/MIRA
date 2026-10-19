"""tools/stale_pr_sweep.py — the mechanism behind SDLC v1 §1.5's WIP policy.

Hermetic: `decide()` and `parse_pr()` are pure; no `gh`, no network.
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import sys
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "stale_pr_sweep", Path(__file__).resolve().parents[1] / "tools" / "stale_pr_sweep.py"
)
assert _SPEC and _SPEC.loader
sps = importlib.util.module_from_spec(_SPEC)
sys.modules["stale_pr_sweep"] = sps  # dataclasses resolve annotations via sys.modules
_SPEC.loader.exec_module(sps)

NOW = dt.datetime(2026, 10, 19, tzinfo=dt.timezone.utc)


def days_ago(n: float) -> dt.datetime:
    return NOW - dt.timedelta(days=n)


def make_pr(*, created: float = 60, commit: float | None = 60, labels=(), events=()) -> sps.PR:
    return sps.PR(
        number=1,
        title="t",
        created_at=days_ago(created),
        head_committed_at=days_ago(commit) if commit is not None else None,
        labels=set(labels),
        events=list(events),
    )


def warn_event(age: float) -> sps.Event:
    return sps.Event("github-actions", days_ago(age), sps.WARN_BODY)


# --- warn ---------------------------------------------------------------------------


def test_idle_past_threshold_is_warned() -> None:
    assert sps.decide(make_pr(created=30, commit=sps.WARN_DAYS + 1), NOW) == "warn"


def test_recent_commit_is_not_warned() -> None:
    """Control for the test above: the same PR with a fresh commit stays open."""
    assert sps.decide(make_pr(created=30, commit=sps.WARN_DAYS - 1), NOW) == "none"


def test_recent_human_comment_keeps_a_pr_alive() -> None:
    pr = make_pr(events=[sps.Event("Mikecranesync", days_ago(2), "still on it")])
    assert sps.decide(pr, NOW) == "none"


@pytest.mark.parametrize("bot", ["github-actions", "dependabot[bot]", "copilot[bot]"])
def test_bot_comments_do_not_reset_the_clock(bot: str) -> None:
    """The AI-review and staging-gate sticky comments must not keep a dead PR alive."""
    pr = make_pr(events=[sps.Event(bot, days_ago(1), "AI review: ...")])
    assert sps.decide(pr, NOW) == "warn"


def test_keep_label_exempts() -> None:
    assert sps.decide(make_pr(labels={"keep"}), NOW) == "keep"


def test_other_labels_do_not_exempt() -> None:
    """Control: only `keep` exempts — a `stale` or random label must not."""
    assert sps.decide(make_pr(labels={"stale", "P1"}), NOW) == "warn"


# --- close ----------------------------------------------------------------------------


def test_warned_and_still_idle_after_grace_is_closed() -> None:
    pr = make_pr(events=[warn_event(sps.CLOSE_GRACE_DAYS + 0.5)])
    assert sps.decide(pr, NOW) == "close"


def test_warned_inside_grace_is_left_alone() -> None:
    pr = make_pr(events=[warn_event(sps.CLOSE_GRACE_DAYS - 1)])
    assert sps.decide(pr, NOW) == "none"


def test_activity_after_the_warning_cancels_the_close() -> None:
    pr = make_pr(
        events=[warn_event(10), sps.Event("Mikecranesync", days_ago(9), "rebased, re-scoping")]
    )
    assert sps.decide(pr, NOW) == "none"


def test_the_warning_itself_does_not_count_as_activity() -> None:
    """A warning posted by a NON-bot account (a manual run) must not reset the clock."""
    pr = make_pr(events=[sps.Event("Mikecranesync", days_ago(8), sps.WARN_BODY)])
    assert sps.decide(pr, NOW) == "close"


def test_a_stale_pr_that_revived_and_died_again_is_rewarned_not_closed() -> None:
    """Old warning, then activity, then 14+ idle days: warn again, never close on the old notice."""
    pr = make_pr(
        events=[warn_event(40), sps.Event("Mikecranesync", days_ago(sps.WARN_DAYS + 2), "x")]
    )
    assert sps.decide(pr, NOW) == "warn"


# --- parsing and side effects ------------------------------------------------------------


def test_parse_pr_reads_commit_comments_reviews_and_labels() -> None:
    node = {
        "number": 7,
        "title": "x",
        "createdAt": "2026-10-01T00:00:00Z",
        "labels": {"nodes": [{"name": "keep"}]},
        "commits": {"nodes": [{"commit": {"committedDate": "2026-10-02T00:00:00Z"}}]},
        "comments": {"nodes": [{"author": None, "createdAt": "2026-10-03T00:00:00Z", "body": "b"}]},
        "reviews": {"nodes": [{"author": {"login": "r"}, "submittedAt": "2026-10-04T00:00:00Z"}]},
    }
    pr = sps.parse_pr(node)
    assert pr.labels == {"keep"}
    assert pr.head_committed_at == dt.datetime(2026, 10, 2, tzinfo=dt.timezone.utc)
    assert [e.author for e in pr.events] == ["", "r"]  # a deleted (ghost) author parses as ""
    assert sps.last_activity(pr) == dt.datetime(2026, 10, 4, tzinfo=dt.timezone.utc)


def test_close_never_deletes_the_branch(monkeypatch) -> None:
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(sps, "_gh", lambda *a: calls.append(a))
    sps.apply("o/r", make_pr(), "close")
    assert calls and calls[0][:2] == ("pr", "close")
    assert not any("--delete-branch" in c for c in calls)


def test_dry_run_makes_no_github_writes(monkeypatch) -> None:
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(sps, "_gh", lambda *a: calls.append(a))
    monkeypatch.setattr(sps, "fetch_open_prs", lambda repo: [make_pr()])
    assert sps.main(["--repo", "o/r"]) == 0
    assert calls == []
