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
    return sps.Event("github-actions", days_ago(age), sps.WARN_BODY, "Bot")


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


# --- notice authenticity (#4528) ----------------------------------------------------------


def test_a_marker_in_a_human_comment_is_activity_not_a_warning() -> None:
    """#4528: a 10-day-old PR, eight days after someone quotes the notice and replies.

    The quote must neither start the close clock nor erase the reply as activity.
    """
    quoted = sps.Event("someone", days_ago(8), f"{sps.WARN_BODY}\n\nStill on this, see #12.")
    pr = make_pr(created=10, commit=10, events=[quoted])
    assert sps.last_warning(pr) is None
    assert sps.last_activity(pr) == days_ago(8)
    assert sps.decide(pr, NOW) == "none"


def test_an_exact_notice_from_a_human_account_is_activity() -> None:
    """Only the workflow posts notices; the same text from a person is a person talking."""
    pr = make_pr(events=[sps.Event("Mikecranesync", days_ago(8), sps.WARN_BODY)])
    assert sps.last_warning(pr) is None
    assert sps.decide(pr, NOW) == "none"


@pytest.mark.parametrize(
    "author,body",
    [
        ("github-actions", f"> {sps.WARN_BODY}"),  # the sweep's account, quoting
        ("github-actions", f"{sps.WARN_BODY}\nextra"),  # the sweep's account, extended
        ("dependabot[bot]", sps.WARN_BODY),  # exact text, wrong bot
    ],
)
def test_only_the_exact_notice_from_the_sweep_account_is_a_warning(author: str, body: str) -> None:
    pr = make_pr(events=[sps.Event(author, days_ago(sps.CLOSE_GRACE_DAYS + 1), body, "Bot")])
    assert sps.last_warning(pr) is None
    assert sps.decide(pr, NOW) == "warn", "an unauthenticated notice must never lead to close"


def test_the_authentic_notice_survives_crlf_and_trailing_whitespace() -> None:
    """Control: the real notice still counts when GitHub hands it back re-encoded."""
    body = sps.WARN_BODY.replace("\n", "\r\n") + "\r\n"
    pr = make_pr(
        events=[sps.Event("github-actions", days_ago(sps.CLOSE_GRACE_DAYS + 1), body, "Bot")]
    )
    assert sps.last_warning(pr) == days_ago(sps.CLOSE_GRACE_DAYS + 1)
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


def test_apply_writes_at_most_the_cap_closes_first(monkeypatch) -> None:
    """The first apply run faces ~100 stale PRs; it must drain them over several runs."""
    stale = [make_pr(created=60, commit=60 - i) for i in range(30)]
    for i, pr in enumerate(stale):
        pr.number = i + 1
    due_close = make_pr(events=[warn_event(sps.CLOSE_GRACE_DAYS + 1)])
    due_close.number = 99
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(sps, "_gh", lambda *a: calls.append(a))
    monkeypatch.setattr(sps, "fetch_open_prs", lambda repo: [*stale, due_close])

    assert sps.main(["--repo", "o/r", "--mode", "apply", "--max-actions", "5"]) == 0

    touched = [c[2] for c in calls if c[0] == "pr"]
    assert touched[0] == "99", "a due close must never wait behind new warnings"
    assert len(set(touched)) == 5
    # PR 1 has been idle longest (60 days), PR 30 shortest (31 days).
    assert "1" in touched and "30" not in touched, "longest-idle PRs are warned first"


# --- nested-connection completeness (#4529) ---------------------------------------------

_T = "2026-10-01T00:00:00Z"


def _node(
    *,
    labels=(),
    comments=(),
    reviews=(),
    more_labels=False,
    more_comments=False,
    more_reviews=False,
) -> dict:
    return {
        "number": 5,
        "title": "t",
        "createdAt": "2026-08-01T00:00:00Z",
        "labels": {
            "pageInfo": {"hasNextPage": more_labels},
            "nodes": [{"name": n} for n in labels],
        },
        "commits": {"nodes": [{"commit": {"committedDate": "2026-08-01T00:00:00Z"}}]},
        "comments": {"pageInfo": {"hasPreviousPage": more_comments}, "nodes": list(comments)},
        "reviews": {"pageInfo": {"hasPreviousPage": more_reviews}, "nodes": list(reviews)},
    }


def _bot_comment(at: str = _T) -> dict:
    return {"author": {"login": "github-actions"}, "createdAt": at, "body": "staging-gate: ..."}


class FakeGraphQL:
    """Serves one outer page, then the full contents of any connection asked for."""

    def __init__(self, node: dict, full: dict[str, list[dict]] | None = None, fail=False):
        self.node, self.full, self.fail = node, full or {}, fail
        self.calls: list[str] = []

    def __call__(self, query: str, **variables) -> dict:
        if "pullRequests(" in query:
            self.calls.append("outer")
            page = {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": [self.node]}
            return {"data": {"repository": {"pullRequests": page}}}
        conn = next(c for c in ("labels", "comments", "reviews") if f"{c}(" in query)
        self.calls.append(conn)
        if self.fail:
            raise sps.subprocess.CalledProcessError(1, ["gh"], stderr="HTTP 502")
        page = {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": self.full[conn]}
        return {"data": {"repository": {"pullRequest": {conn: page}}}}


def test_keep_on_a_second_label_page_still_exempts() -> None:
    first = [f"l{i}" for i in range(100)]
    gql = FakeGraphQL(
        _node(labels=first, more_labels=True),
        {"labels": [{"name": n} for n in first] + [{"name": "keep"}]},
    )
    [pr] = sps.fetch_open_prs("o/r", gql=gql)
    assert gql.calls == ["outer", "labels"]
    assert sps.decide(pr, NOW) == "keep"


def test_a_human_comment_behind_a_page_of_bot_comments_still_counts() -> None:
    recent = (NOW - dt.timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    human = {"author": {"login": "Mikecranesync"}, "createdAt": recent, "body": "on it"}
    bots_after = [_bot_comment(NOW.strftime("%Y-%m-%dT%H:%M:%SZ")) for _ in range(100)]
    gql = FakeGraphQL(
        _node(comments=bots_after, more_comments=True), {"comments": [human, *bots_after]}
    )
    [pr] = sps.fetch_open_prs("o/r", gql=gql)
    assert gql.calls == ["outer", "comments"]
    assert sps.decide(pr, NOW) == "none"


def test_a_human_review_behind_a_page_of_reviews_still_counts() -> None:
    recent = (NOW - dt.timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    bot_reviews = [{"author": {"login": "copilot[bot]"}, "submittedAt": _T} for _ in range(100)]
    human = {"author": {"login": "Mikecranesync"}, "submittedAt": recent}
    gql = FakeGraphQL(
        _node(reviews=bot_reviews, more_reviews=True), {"reviews": [*bot_reviews, human]}
    )
    [pr] = sps.fetch_open_prs("o/r", gql=gql)
    assert gql.calls == ["outer", "reviews"]
    assert sps.decide(pr, NOW) == "none"


def test_a_complete_node_needs_no_further_queries() -> None:
    """Control: nothing truncated, nothing refetched, and the PR is decided normally."""
    gql = FakeGraphQL(_node(labels=["P1"], comments=[_bot_comment()]))
    [pr] = sps.fetch_open_prs("o/r", gql=gql)
    assert gql.calls == ["outer"]
    assert pr.complete and sps.decide(pr, NOW) == "warn"


def test_a_connection_that_cannot_be_completed_fails_closed(monkeypatch) -> None:
    """If the rest of a truncated list cannot be read, the PR is skipped, never warned/closed."""
    gql = FakeGraphQL(_node(labels=["P1"], comments=[_bot_comment()], more_labels=True), fail=True)
    monkeypatch.setattr(sps, "_graphql", gql)
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(sps, "_gh", lambda *a: calls.append(a))

    [pr] = sps.fetch_open_prs("o/r")
    assert not pr.complete
    assert sps.decide(pr, NOW) == "skip"

    assert sps.main(["--repo", "o/r", "--mode", "apply"]) == 0
    assert not [c for c in calls if c[0] == "pr"], "an incomplete PR must receive no write"


# --- the sweep's own identity, as GitHub really reports it (#4558 Codex F1) ---------------


def _graphql_notice(login: str, typename: str) -> dict:
    """A comment node shaped like the live GraphQL response for a workflow-posted comment.

    Captured 2026-10-20 from Mikecranesync/MIRA comment 6270104165, posted by GITHUB_TOKEN:
    GraphQL reports ``{"login": "github-actions", "__typename": "Bot"}`` while the REST API
    reports the same comment as ``github-actions[bot]``. Both spellings name one account.
    """
    at = (NOW - dt.timedelta(days=sps.CLOSE_GRACE_DAYS + 1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "author": {"login": login, "__typename": typename},
        "createdAt": at,
        "body": sps.WARN_BODY,
    }


@pytest.mark.parametrize("login", ["github-actions", "github-actions[bot]"])
def test_a_notice_posted_by_the_workflow_token_leads_to_close(login: str) -> None:
    [pr] = sps.fetch_open_prs(
        "o/r", gql=FakeGraphQL(_node(comments=[_graphql_notice(login, "Bot")]))
    )
    assert sps.last_warning(pr) is not None
    assert sps.decide(pr, NOW) == "close"


def test_a_human_account_named_like_the_bot_is_not_the_sweep() -> None:
    """Control: the login alone is not the identity; the account must be a Bot."""
    node = _node(comments=[_graphql_notice("github-actions", "User")])
    [pr] = sps.fetch_open_prs("o/r", gql=FakeGraphQL(node))
    assert sps.last_warning(pr) is None
    assert sps.decide(pr, NOW) != "close"
