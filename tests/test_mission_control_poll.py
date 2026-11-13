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
    get.answers["https://api.github.com/repos/o/r/issues/comments/78"] = (404, {}, {})
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert st.reports() == []
    restored = dict(COMMENT, updated_at="2026-11-12T23:45:00Z")  # 77 edited back later
    get.answers[url] = (200, {}, [restored])
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert [r["id"] for r in st.reports()] == [77]  # a withdrawal is not a deletion


def test_a_failed_poll_page_never_removes_reports(tmp_path):  # F9 control
    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page=1"
    get = FakeGet({url: (200, {}, [COMMENT])})
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    get.answers[url] = (502, {}, "bad gateway")
    import pytest

    with pytest.raises(RuntimeError):
        poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert len(st.reports()) == 1


def test_reconciliation_spares_reports_that_arrived_after_the_poll_began(tmp_path):  # r2 F10
    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page=1"
    late = {
        "id": 99,
        "lane": "BRAVO-CODEX",
        "author": "owner",
        "trusted": 1,
        "updated_at": "2099-01-01T00:00:00Z",  # newer than any poll start
        "url": "https://github.com/o/r/issues/5232#issuecomment-99",
        "raw": "",
        "parsed": {"state": "ACTIVE", "items": []},
    }

    class RacyGet(FakeGet):
        def __call__(self, u, headers=None):
            st.put_report(late)  # a webhook lands while the (older) page is in flight
            return super().__call__(u, headers)

    get = RacyGet({url: (200, {}, [COMMENT])})
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert {r["id"] for r in st.reports()} == {77, 99}


def test_a_failed_poll_page_raises_so_the_caller_cannot_treat_it_as_a_read(tmp_path):  # r3 F11
    import pytest

    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page=1"
    get = FakeGet({url: (502, {}, "bad gateway")})
    with pytest.raises(RuntimeError, match="502"):
        poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))


def test_reconciliation_spares_a_report_that_arrived_in_the_same_second(tmp_path):  # r3 F10
    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page=1"
    late = {
        "id": 99,
        "lane": "BRAVO-CODEX",
        "author": "owner",
        "trusted": 1,
        "updated_at": "2026-11-12T23:00:00Z",  # older than the poll start: time cannot fence it
        "url": "https://github.com/o/r/issues/5232#issuecomment-99",
        "raw": "",
        "parsed": {"state": "ACTIVE", "items": []},
    }

    class RacyGet(FakeGet):
        def __call__(self, u, headers=None):
            st.put_report(late)  # a webhook lands while the (older, empty) page is in flight
            return super().__call__(u, headers)

    get = RacyGet({url: (200, {}, [])})
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert [r["id"] for r in st.reports()] == [99]
    assert st.put_report(dict(late, updated_at="2026-11-12T23:01:00Z"))  # no tombstone either


def test_a_report_re_edited_during_the_poll_is_not_deleted_by_a_page_that_predates_it(tmp_path):
    """r3 F10: the stored version is in the pre-poll set, the page lacks it, but a webhook
    wrote a newer version meanwhile — the conditional delete must leave the newer one."""
    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page=1"
    get = FakeGet({url: (200, {}, [COMMENT])})
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    newer = dict(
        poll.webhook.comment_report({"comment": COMMENT}, ("owner",), poll.reports.parse),
        updated_at="2026-11-12T23:30:00Z",
    )

    class RacyGet(FakeGet):
        def __call__(self, u, headers=None):
            st.put_report(newer)  # lands between the pre-poll capture and the page read
            return super().__call__(u, headers)

    get = RacyGet({url: (200, {}, [])})  # a stale page: 77 missing
    get.answers["https://api.github.com/repos/o/r/issues/comments/77"] = (
        200,
        {},
        dict(COMMENT, updated_at="2026-11-12T23:30:00Z"),  # the lookup sees the newer edit
    )
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert [(r["id"], r["updated_at"]) for r in st.reports()] == [(77, "2026-11-12T23:30:00Z")]
    assert st.put_report(dict(newer, updated_at="2026-11-12T23:31:00Z"))  # and no tombstone


def _comment_url(cid):
    return f"https://api.github.com/repos/o/r/issues/comments/{cid}"


def test_a_report_missing_from_the_pages_is_confirmed_before_it_is_deleted(tmp_path):  # r4 F13
    """Page-number pagination can skip a comment when an earlier one is deleted between
    page reads; absence from the pages is not proof of deletion."""
    st = store_mod.Store(tmp_path / "mc.sqlite")
    page = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page={}"
    get = FakeGet({page.format(1): (200, {}, [COMMENT])})
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    get.answers[page.format(1)] = (200, {}, [])  # 77 slipped between the pages
    get.answers[_comment_url(77)] = (200, {}, COMMENT)  # but it still exists
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert [r["id"] for r in st.reports()] == [77]
    get.answers[_comment_url(77)] = (404, {}, {"message": "Not Found"})  # control: really gone
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert st.reports() == []


def test_an_unconfirmed_absence_is_a_failed_read_not_a_deletion(tmp_path):  # r4 F13
    import pytest

    st = store_mod.Store(tmp_path / "mc.sqlite")
    page = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page={}"
    get = FakeGet({page.format(1): (200, {}, [COMMENT])})
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    get.answers[page.format(1)] = (200, {}, [])
    get.answers[_comment_url(77)] = (502, {}, "bad gateway")
    with pytest.raises(RuntimeError, match="502"):
        poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert [r["id"] for r in st.reports()] == [77]


def test_a_confirmed_deletion_still_spares_a_version_written_during_the_poll(tmp_path):
    """The permanent path is conditional too: a webhook version written between the
    pre-poll capture and the 404 survives this poll; the next complete poll settles it."""
    st = store_mod.Store(tmp_path / "mc.sqlite")
    url = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page=1"
    get = FakeGet({url: (200, {}, [COMMENT])})
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    newer = dict(
        poll.webhook.comment_report({"comment": COMMENT}, ("owner",), poll.reports.parse),
        updated_at="2026-11-12T23:30:00Z",
    )

    class RacyGet(FakeGet):
        def __call__(self, u, headers=None):
            st.put_report(newer)
            return super().__call__(u, headers)

    get = RacyGet({url: (200, {}, []), _comment_url(77): (404, {}, {})})
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert [r["updated_at"] for r in st.reports()] == ["2026-11-12T23:30:00Z"]
    assert st.put_report(dict(newer, updated_at="2026-11-12T23:31:00Z"))  # and no tombstone
    get = FakeGet({url: (200, {}, []), _comment_url(77): (404, {}, {})})  # no race this time
    poll.poll_reports(get, "o/r", 5232, st, trusted=("owner",))
    assert st.reports() == []


def test_a_complete_poll_drops_reports_stored_from_other_issues(tmp_path):  # r5 F16 cleanup
    st = store_mod.Store(tmp_path / "mc.sqlite")
    stray = {
        "id": 500,
        "lane": "BRAVO-CODEX",
        "author": "owner",
        "trusted": 1,
        "updated_at": "2026-11-12T23:00:00Z",
        "url": "https://github.com/o/r/issues/999#issuecomment-500",
        "raw": "",
        "parsed": {"state": "ACTIVE", "items": [9999]},
    }
    st.put_report(stray)
    url = "https://api.github.com/repos/o/r/issues/5232/comments?per_page=100&page=1"
    poll.poll_reports(FakeGet({url: (200, {}, [COMMENT])}), "o/r", 5232, st, trusted=("owner",))
    assert [r["id"] for r in st.reports()] == [77]
