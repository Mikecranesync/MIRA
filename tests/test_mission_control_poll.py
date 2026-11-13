"""Mission control v2 (#4737): polling GitHub REST for events and lane reports.

The HTTP getter is injected, so these run offline against synthetic responses.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

MC = Path(__file__).resolve().parents[1] / "tools" / "mission-control"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


poll = _load("mission_control_poll", MC / "poll.py")
store_mod = _load("mission_control_store_p", MC / "store.py")

REST_EVENT = {
    "id": "999",
    "type": "PullRequestEvent",
    "actor": {"login": "someone"},
    "repo": {"name": "o/r"},
    "created_at": "2026-11-12T22:30:00Z",
    "payload": {
        "action": "opened",
        "number": 12,
        "pull_request": {
            "html_url": "https://github.com/o/r/pull/12",
            "head": {"sha": "0123456789abcdef0123456789abcdef01234567"},
        },
    },
}
COMMENT = {
    "id": 77,
    "html_url": "https://github.com/o/r/issues/5232#issuecomment-77",
    "updated_at": "2026-11-12T23:00:00Z",
    "user": {"login": "owner"},
    "body": "[DELIVERY-UPDATE: BRAVO-CLAUDE]\nUpdated: 2026-11-12T23:00:00Z\nState: ACTIVE\n",
}


class FakeGet:
    """Records calls; answers from a dict of url -> (status, headers, json)."""

    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def __call__(self, url, headers=None):
        self.calls.append((url, dict(headers or {})))
        return self.answers[url]


def test_rest_event_normalises_like_a_webhook_row():
    row = poll.normalise_rest_event(REST_EVENT)
    assert row["delivery_id"] == "rest-999" and row["source"] == "poll"
    assert row["kind"] == "pull_request" and row["action"] == "opened"
    assert row["number"] == 12 and row["repo"] == "o/r" and row["actor"] == "someone"
    assert row["head_sha"] == "0123456789abcdef0123456789abcdef01234567"
    assert row["url"] == "https://github.com/o/r/pull/12"
    assert row["received_at"] == "2026-11-12T22:30:00Z"


def test_unknown_rest_event_type_becomes_other():
    row = poll.normalise_rest_event({"id": "1", "type": "WatchEvent", "created_at": "t"})
    assert row["kind"] == "other" and row["payload"]["type"] == "WatchEvent"


def test_poll_events_stores_rows_and_honours_etag(tmp_path):
    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/events?per_page=100"
    get = FakeGet({url: (200, {"ETag": 'W/"abc"', "X-Poll-Interval": "90"}, [REST_EVENT])})
    state = {}
    added = poll.poll_events(get, "o/r", st, state)
    assert added == 1 and st.counts()["events"] == 1
    assert state["etag"] == 'W/"abc"' and state["interval"] == 90
    get.answers[url] = (304, {}, None)
    assert poll.poll_events(get, "o/r", st, state) == 0
    assert get.calls[-1][1].get("If-None-Match") == 'W/"abc"'  # the etag was sent


def test_poll_reports_reads_lane_comments_from_the_coordination_issue(tmp_path):
    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page=1"
    other = dict(COMMENT, id=78, body="just chatter")
    get = FakeGet({url: (200, {}, [COMMENT, other])})
    n = poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert n == 1 and st.counts()["reports"] == 1
    r = st.reports()[0]
    assert r["id"] == 77 and r["trusted"] == 1 and r["parsed"]["state"] == "ACTIVE"
    assert r["url"] == "https://github.com/o/r/issues/5232#issuecomment-77"


def test_poll_reports_marks_other_authors_untrusted(tmp_path):
    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page=1"
    get = FakeGet({url: (200, {}, [dict(COMMENT, user={"login": "stranger"})])})
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert st.reports()[0]["trusted"] == 0


def test_poll_survives_a_github_error(tmp_path):
    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/events?per_page=100"
    get = FakeGet({url: (502, {}, {"message": "bad gateway"})})
    assert poll.poll_events(get, "o/r", st, {}) == 0


def test_rest_event_without_html_url_falls_back_to_the_canonical_github_url():
    ev = dict(
        REST_EVENT,
        payload={"action": "closed", "number": 12, "pull_request": {"head": {"sha": "0" * 40}}},
    )
    assert poll.normalise_rest_event(ev)["url"] == "https://github.com/o/r/pull/12"
    issue = dict(
        REST_EVENT, type="IssuesEvent", payload={"action": "opened", "issue": {"number": 7}}
    )
    assert poll.normalise_rest_event(issue)["url"] == "https://github.com/o/r/issues/7"


# --- Codex round 1 (PR #5455) findings -------------------------------------------------


def test_poll_events_reads_headers_case_insensitively_like_the_runtime_getter(tmp_path):  # F6
    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/events?per_page=100"
    lowered = {"etag": 'W/"abc"', "x-poll-interval": "90"}  # what dict(httpx.Headers) yields
    get = FakeGet({url: (200, lowered, [REST_EVENT])})
    state = {}
    poll.poll_events(get, "o/r", st, state)
    assert state["etag"] == 'W/"abc"' and state["interval"] == 90
    get.answers[url] = (304, {}, None)
    poll.poll_events(get, "o/r", st, state)
    assert get.calls[-1][1].get("If-None-Match") == 'W/"abc"'


def test_complete_poll_removes_reports_whose_comments_are_gone_or_edited_away(tmp_path):  # F9
    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page=1"
    gone = dict(COMMENT, id=78, html_url="https://github.com/o/r/issues/5232#issuecomment-78")
    get = FakeGet({url: (200, {}, [COMMENT, gone])})
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert {r["id"] for r in st.reports()} == {77, 78}
    edited = dict(COMMENT, body="no marker any more", updated_at="2026-11-12T23:30:00Z")
    get.answers[url] = (200, {}, [edited])  # 78 deleted, 77 edited to drop the marker
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert st.reports() == []


def test_a_failed_poll_page_never_removes_reports(tmp_path):  # F9 control
    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page=1"
    get = FakeGet({url: (200, {}, [COMMENT])})
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    get.answers[url] = (502, {}, "bad gateway")
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert len(st.reports()) == 1
