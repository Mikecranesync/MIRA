"""Mission control (#4737): rules, pagination, read-only and escaping guarantees.

Synthetic fixtures only; no real Project #4 content is stored in the repo.
"""

from __future__ import annotations

import datetime as dt
import http.client
import importlib.util
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

MC = Path(__file__).resolve().parents[1] / "tools" / "mission-control"


def _load(name, path):
    # Unique module names: the full suite already imports other modules called "server".
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


server = _load("mission_control_server", MC / "server.py")
board = server.board

NOW = dt.datetime(2026, 10, 24, 12, 0, tzinfo=dt.timezone.utc)


def node(
    number, status="In Progress", state="OPEN", labels=(), updated="2026-10-23T12:00:00Z", title="t"
):
    return {
        "fieldValueByName": {"name": status} if status else None,
        "content": {
            "__typename": "Issue",
            "number": number,
            "title": title,
            "url": f"https://github.com/o/r/issues/{number}",
            "state": state,
            "updatedAt": updated,
            "repository": {"nameWithOwner": "o/r"},
            "labels": {"nodes": [{"name": lb} for lb in labels]},
            "assignees": {"nodes": []},
        },
    }


def page(nodes, has_next, cursor=None):
    return {
        "data": {
            "user": {
                "projectV2": {
                    "items": {
                        "pageInfo": {"hasNextPage": has_next, "endCursor": cursor},
                        "nodes": nodes,
                    }
                }
            }
        }
    }


def test_fetch_reads_every_page_and_passes_the_cursor():
    calls = []
    pages = [page([node(1), node(2)], True, "c1"), page([node(3)], False)]

    def post(body):
        calls.append(body["variables"]["after"])
        return pages[len(calls) - 1]

    items = board.fetch_items(post)
    assert [i["number"] for i in items] == [1, 2, 3]
    assert calls == [None, "c1"]


def test_fetch_skips_draft_notes_and_raises_on_graphql_error():
    draft = {"fieldValueByName": None, "content": {"__typename": "DraftIssue"}}
    assert board.fetch_items(lambda b: page([draft, node(5)], False))[0]["number"] == 5
    with pytest.raises(RuntimeError):
        board.fetch_items(lambda b: {"errors": [{"message": "nope"}]})


def test_query_is_read_only():
    assert "mutation" not in board.QUERY.lower()
    assert board.QUERY.strip().startswith("query")


def test_focus_matches_saved_view_semantics():
    items = [
        board.normalise(node(1, "In Progress")),
        board.normalise(node(2, "in progress")),  # case-insensitive, like the saved filter
        board.normalise(node(3, "In Progress", state="CLOSED")),  # is:open excludes it
        board.normalise(node(4, "Todo")),
    ]
    v = board.build_views(items, NOW)
    assert sorted(i["number"] for i in v["focus"]) == [1, 2]


@pytest.mark.parametrize(
    ("kwargs", "option"),
    [
        ({"state": "CLOSED"}, "Mark Done"),
        ({"status": "Done"}, "Reopen or close"),
        ({"labels": ["blocked"]}, "Unblock"),
        ({"labels": ["ready-for-human"]}, "Decide"),
        ({"updated": "2026-09-01T00:00:00Z"}, "Hold"),
        ({}, "Continue"),  # control: a fresh, unlabelled, consistent card
    ],
)
def test_recommendation_rules(kwargs, option):
    assert board.recommend(board.normalise(node(1, **kwargs)), NOW)["option"] == option


def test_views_route_cards_to_owner_blocked_and_mismatch_lists():
    items = [
        board.normalise(node(1, labels=["needs-mike"])),
        board.normalise(node(2, labels=["blocked"])),
        board.normalise(node(3, state="CLOSED")),
        board.normalise(node(4)),
    ]
    v = board.build_views(items, NOW)
    assert [i["number"] for i in v["needs_owner"]] == [1]
    assert [i["number"] for i in v["blocked"]] == [2]
    assert [i["number"] for i in v["mismatched"]] == [3]


class _Snap:
    def __init__(self, items):
        self.items, self.at, self.error = items, NOW, None

    def get(self):
        return self


def test_render_escapes_card_text_and_keeps_send_disabled():
    hostile = board.normalise(node(1, title='<script>alert(1)</script>"x'))
    html = server.render(_Snap([hostile]))
    assert "<script>alert(1)" not in html
    assert "&lt;script&gt;" in html
    assert "<button" in html
    assert all("disabled" in b for b in html.split("<button")[1:])  # every Send button disabled


@pytest.mark.parametrize(
    "url", ["javascript:alert(1)", "https://github.com.evil.com/x", "https://github.com@evil.com/x"]
)
def test_render_refuses_non_github_links(url):
    bad = board.normalise(node(1))
    bad["url"] = url
    assert url not in server.render(_Snap([bad]))


def test_render_does_not_mutate_the_shared_snapshot():
    item = board.normalise(node(1))
    server.render(_Snap([item]))
    assert "rec" not in item  # concurrent requests share these dicts


@pytest.fixture
def running_server():
    server.Handler.snapshot = _Snap([board.normalise(node(1))])
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield srv.server_address[1]
    srv.shutdown()


def _req(port, method, path):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request(method, path)
    r = c.getresponse()
    return r.status, r.read()


def test_server_serves_page_and_rejects_writes(running_server):
    status, body = _req(running_server, "GET", "/")
    assert status == 200 and b"Mission Control" in body
    assert _req(running_server, "POST", "/")[0] == 405
    assert _req(running_server, "GET", "/healthz")[0] == 200


def test_bind_refuses_non_loopback_without_explicit_opt_in(monkeypatch):
    monkeypatch.setenv("MC_BIND", "0.0.0.0")
    monkeypatch.delenv("MC_ALLOW_NONLOOPBACK", raising=False)
    with pytest.raises(SystemExit):
        server.bind_address()
    monkeypatch.setenv("MC_BIND", "127.0.0.1")  # control: loopback is allowed
    assert server.bind_address() == "127.0.0.1"
