"""Mission control v2 (#4737): the cockpit page and its view model.

Synthetic data only. Colour/state rules: GO needs every candidate DEPLOYED:production and
FIELD-VERIFIED; a missing report never implies success; report text is escaped.
"""

from __future__ import annotations

import datetime as dt
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


server = _load("mission_control_server_pg", MC / "server.py")
model = server.model
store_mod = server.store_mod
NOW = dt.datetime(2026, 11, 12, 23, 0, tzinfo=dt.timezone.utc)
SHA = "0123456789abcdef0123456789abcdef01234567"


class _Snap:
    def __init__(self, items=()):
        self.items, self.at, self.error = list(items), NOW, None

    def get(self):
        return self


def report(cid=1, lane="BRAVO-CLAUDE", updated="2026-11-12T22:30:00Z", trusted=1, **parsed):
    p = {
        "lane": lane,
        "state": "ACTIVE",
        "evidence": "NOT TESTED",
        "stage": "local",
        "goal": "MC v2 #4737",
        "next": "replay",
        "blocked_by": "Mike to merge #4985",
        "decision": "none",
        "changed": "x",
        "updated": updated,
        "sha": SHA,
        "items": [4737, 4985],
    }
    p.update(parsed)
    return {
        "id": cid,
        "lane": lane,
        "author": "owner" if trusted else "stranger",
        "trusted": trusted,
        "updated_at": updated,
        "url": f"https://github.com/o/r/issues/5232#issuecomment-{cid}",
        "raw": "",
        "parsed": p,
    }


def lifecycle_row(number=12, **on):
    cells = {
        n: {"on": on.get(n, False), "label": n.lower(), "source": "https://github.com/o/r/pull/12"}
        for n in server.lifecycle.STATES
    }
    return {
        "number": number,
        "title": "t",
        "url": "https://github.com/o/r/pull/12",
        "cells": cells,
        "reported": "no report",
    }


def build(tmp_path, reports=(), rows=(), events=(), envs=None, last_poll=None, last_webhook=None):
    st = store_mod.Store(tmp_path / "mc.sqlite")
    for r in reports:
        st.put_report(r)
    for e in events:
        st.add_event(e)
    for env, row in (envs or {}).items():
        st.put_env(env, row)
    ev = {"rows": list(rows), "envs": envs or {}, "at": "2026-11-12T22:59:00Z"}
    return model.build(
        st,
        ev,
        last_poll=last_poll,
        last_webhook=last_webhook,
        now=NOW,
        stale_hours=9,
        poll_seconds=60,
    )


def test_go_only_when_every_candidate_is_production_deployed_and_field_verified(tmp_path):
    full = lifecycle_row(**{"DEPLOYED:production": True, "FIELD-VERIFIED": True})
    m = build(tmp_path, rows=[full], last_poll="2026-11-12T22:59:30Z")
    assert m["readiness"]["decision"] == "GO"  # control
    html = server.render(_Snap(), m)
    assert 'class="go-badge go"' in html and "NO-GO" not in html.split("go-badge")[1][:40]
    staging = lifecycle_row(13, **{"DEPLOYED:staging": True})
    m = build(tmp_path, rows=[full, staging], last_poll="2026-11-12T22:59:30Z")
    assert m["readiness"]["decision"] == "NO-GO" and "#13" in m["readiness"]["reason"]
    assert 'class="go-badge no-go"' in server.render(_Snap(), m)


def test_stale_sources_force_no_go(tmp_path):
    full = lifecycle_row(**{"DEPLOYED:production": True, "FIELD-VERIFIED": True})
    m = build(tmp_path, rows=[full], last_poll="2026-11-12T22:00:00Z")  # 60 min old vs 60 s poll
    assert m["header"]["live"] is False
    assert m["readiness"]["decision"] == "NO-GO" and "stale" in m["readiness"]["reason"]
    assert "STALE" in server.render(_Snap(), m)


def test_no_report_lane_reads_no_report_never_green(tmp_path):
    m = build(tmp_path, reports=[report()])
    lanes = {ln["lane"]: ln for ln in m["lanes"]}
    assert (
        lanes["BRAVO-CLAUDE"]["freshness"] == "fresh" and lanes["BRAVO-CLAUDE"]["state"] == "ACTIVE"
    )
    assert (
        lanes["CHARLIE-CODEX"]["freshness"] == "missing"
        and lanes["CHARLIE-CODEX"]["state"] == "no report"
    )
    html = server.render(_Snap(), m)
    assert "no report" in html and html.count('class="lane"') == 4


def test_newest_trusted_report_per_lane_wins_and_untrusted_is_marked(tmp_path):
    older = report(1, updated="2026-11-12T20:00:00Z", state="BLOCKED")
    newer = report(2, updated="2026-11-12T22:00:00Z", state="ACTIVE")
    stranger = report(3, lane="CHARLIE-CODEX", trusted=0, state="COMPLETE")
    m = build(tmp_path, reports=[older, newer, stranger])
    lanes = {ln["lane"]: ln for ln in m["lanes"]}
    assert lanes["BRAVO-CLAUDE"]["state"] == "ACTIVE" and lanes["BRAVO-CLAUDE"]["url"].endswith(
        "-2"
    )
    assert lanes["CHARLIE-CODEX"]["trusted"] == 0 and lanes["CHARLIE-CODEX"]["state"] == "no report"
    assert "untrusted author" in server.render(_Snap(), m)


def test_report_text_is_escaped(tmp_path):
    hostile = report(next='<script>alert(1)</script>"x', blocked_by="<b>bold</b>")
    html = server.render(_Snap(), build(tmp_path, reports=[hostile]))
    assert "<script>alert(1)" not in html and "&lt;script&gt;" in html and "<b>bold</b>" not in html


def test_decisions_for_mike_come_from_blocked_by_and_decision_lines(tmp_path):
    r = report(decision="merge #4985 and #5314", blocked_by="Mike to merge #4985")
    m = build(tmp_path, reports=[r])
    assert [d["text"] for d in m["decisions"]] == ["merge #4985 and #5314", "Mike to merge #4985"]
    assert m["tiles"]["decisions"] == 2
    quiet = report(2, lane="BRAVO-CODEX", decision="not stated", blocked_by="unparsed")
    assert build(tmp_path / "quiet", reports=[quiet])["decisions"] == []  # placeholders are not decisions


def test_lifecycle_table_has_six_cells_per_row_with_sources(tmp_path):
    row = lifecycle_row(**{"TESTED": True})
    html = server.render(_Snap(), build(tmp_path, rows=[row]))
    table = html.split('class="lifecycle"')[1].split("</table>")[0]
    assert table.count("<td") == 6 + 2  # six state cells + item + reported
    assert table.count('class="cell on"') == 1  # only TESTED is on in this fixture
    assert 'href="https://github.com/o/r/pull/12"' in table


def test_feed_lists_events_newest_first_with_source_badge(tmp_path):
    ev = lambda i, t, src: {  # noqa: E731
        "delivery_id": i,
        "source": src,
        "kind": "pull_request",
        "repo": "o/r",
        "number": 12,
        "actor": "someone",
        "action": "opened",
        "head_sha": SHA,
        "url": "https://github.com/o/r/pull/12",
        "received_at": t,
        "payload": {},
    }
    m = build(
        tmp_path,
        events=[
            ev("a", "2026-11-12T22:00:00Z", "poll"),
            ev("b", "2026-11-12T22:30:00Z", "webhook"),
        ],
    )
    assert [e["delivery_id"] for e in m["feed"]] == ["b", "a"]
    html = server.render(_Snap(), m)
    assert html.index('class="src webhook"') < html.index('class="src poll"')


def test_env_cards_show_sha_or_unreachable(tmp_path):
    envs = {
        "production": {
            "git_sha": SHA,
            "built_at": "2026-11-07T21:22:34Z",
            "ok": 1,
            "fetched_at": "f",
            "behind_by": 3,
        },
        "staging": {
            "git_sha": None,
            "built_at": None,
            "ok": 0,
            "fetched_at": "f",
            "behind_by": None,
        },
    }
    html = server.render(_Snap(), build(tmp_path, envs=envs))
    assert "012345678" in html and "unreachable" in html and "3 merged, not deployed" in html


def test_render_without_a_model_still_serves_the_v1_board():
    html = server.render(_Snap())
    assert "Mission Control" in html and "no report" in html and "NO-GO" in html


def test_snapshot_json_route_serves_the_model(tmp_path, monkeypatch):
    import http.client
    import json
    import threading
    from http.server import ThreadingHTTPServer

    server.Handler.store = store_mod.Store(tmp_path / "mc.sqlite")
    server.Handler.snapshot = _Snap()
    server.Handler.evidence = {"rows": [], "envs": {}, "at": None}
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
        c.request("GET", "/api/snapshot.json")
        r = c.getresponse()
        assert r.status == 200
        body = json.loads(r.read())
        assert body["readiness"]["decision"] == "NO-GO" and body["lanes"][0]["state"] == "no report"
        c.request("GET", "/healthz")
        h = json.loads(c.getresponse().read())
        assert {"items", "ok", "events", "reports", "last_poll", "last_webhook"} <= set(h)
    finally:
        srv.shutdown()
