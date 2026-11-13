"""Mission control v2 (#4737): the only write route, POST /webhook/github.

HMAC over the raw bytes, fail closed without a secret, idempotent on delivery id,
every other POST still 405. Synthetic payloads only.
"""

from __future__ import annotations

import hashlib
import hmac
import http.client
import importlib.util
import json
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

MC = Path(__file__).resolve().parents[1] / "tools" / "mission-control"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


server = _load("mission_control_server_wh", MC / "server.py")
webhook = server.webhook
store_mod = server.store_mod

SECRET = "test-secret-not-real"
PR_PAYLOAD = {
    "action": "opened",
    "number": 12,
    "pull_request": {
        "html_url": "https://github.com/o/r/pull/12",
        "head": {"sha": "0123456789abcdef0123456789abcdef01234567"},
    },
    "repository": {"full_name": "o/r"},
    "sender": {"login": "someone"},
}


def sign(body: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_verify_accepts_the_right_signature_and_rejects_everything_else():
    body = b'{"x":1}'
    assert webhook.verify(SECRET, body, sign(body)) is True  # control
    assert webhook.verify(SECRET, body, sign(body, "other")) is False
    assert webhook.verify(SECRET, body + b" ", sign(body)) is False  # tampered body
    assert webhook.verify(SECRET, body, None) is False
    assert webhook.verify(SECRET, body, "sha1=abc") is False
    assert webhook.verify("", body, sign(body, "")) is False  # empty secret never verifies


def test_normalise_pull_request_event_keeps_source_references():
    row = webhook.normalise("pull_request", "dlv-1", PR_PAYLOAD, "2026-11-12T23:00:00Z")
    assert row["delivery_id"] == "dlv-1" and row["source"] == "webhook"
    assert row["kind"] == "pull_request" and row["action"] == "opened"
    assert row["number"] == 12 and row["repo"] == "o/r" and row["actor"] == "someone"
    assert row["head_sha"] == "0123456789abcdef0123456789abcdef01234567"
    assert row["url"] == "https://github.com/o/r/pull/12"


def test_unknown_event_is_stored_as_other_not_dropped():
    row = webhook.normalise("star", "dlv-2", {"sender": {"login": "x"}}, "2026-11-12T23:00:00Z")
    assert row["kind"] == "other" and row["payload"]["event"] == "star"
    assert row["number"] is None and row["url"] is None


@pytest.fixture
def running(tmp_path, monkeypatch):
    monkeypatch.setenv("MC_WEBHOOK_SECRET", SECRET)
    server.Handler.store = store_mod.Store(tmp_path / "mc.sqlite")
    server.Handler.snapshot = server.Snapshot(lambda: [])
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1], server.Handler.store
    srv.shutdown()


def post(port, path, body: bytes, headers: dict):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request("POST", path, body=body, headers=headers)
    r = c.getresponse()
    return r.status, r.read()


def hdrs(body, delivery="dlv-1", event="pull_request", secret=SECRET):
    return {
        "Content-Type": "application/json",
        "X-GitHub-Event": event,
        "X-GitHub-Delivery": delivery,
        "X-Hub-Signature-256": sign(body, secret),
    }


def test_signed_delivery_is_stored_once(running):
    port, st = running
    body = json.dumps(PR_PAYLOAD).encode()
    assert st.counts()["events"] == 0  # precondition
    assert post(port, "/webhook/github", body, hdrs(body))[0] == 202
    assert post(port, "/webhook/github", body, hdrs(body))[0] == 202  # redelivery
    assert st.counts()["events"] == 1
    assert st.events()[0]["source"] == "webhook"


def test_bad_signature_is_401_and_stores_nothing(running):
    port, st = running
    body = json.dumps(PR_PAYLOAD).encode()
    assert post(port, "/webhook/github", body, hdrs(body, secret="wrong"))[0] == 401
    h = hdrs(body)
    del h["X-Hub-Signature-256"]
    assert post(port, "/webhook/github", body, h)[0] == 401
    assert st.counts()["events"] == 0


def test_other_posts_are_still_405(running):
    port, _ = running
    body = json.dumps(PR_PAYLOAD).encode()
    assert post(port, "/", body, hdrs(body))[0] == 405
    assert post(port, "/webhook/other", body, hdrs(body))[0] == 405


def test_missing_secret_fails_closed_with_503(running, monkeypatch):
    port, st = running
    monkeypatch.delenv("MC_WEBHOOK_SECRET")
    body = json.dumps(PR_PAYLOAD).encode()
    assert post(port, "/webhook/github", body, hdrs(body))[0] == 503
    assert st.counts()["events"] == 0


def test_delivery_update_comment_lands_in_reports_as_well(running):
    port, st = running
    payload = {
        "action": "created",
        "issue": {"number": 5232, "html_url": "https://github.com/o/r/issues/5232"},
        "comment": {
            "id": 77,
            "html_url": "https://github.com/o/r/issues/5232#issuecomment-77",
            "updated_at": "2026-11-12T23:00:00Z",
            "user": {"login": "owner"},
            "body": "[DELIVERY-UPDATE: BRAVO-CLAUDE]\nUpdated: 2026-11-12T23:00:00Z\nState: ACTIVE\n",
        },
        "repository": {"full_name": "o/r"},
        "sender": {"login": "owner"},
    }
    body = json.dumps(payload).encode()
    assert post(port, "/webhook/github", body, hdrs(body, "dlv-9", "issue_comment"))[0] == 202
    assert st.counts() == {"events": 1, "reports": 1}
    r = st.reports()[0]
    assert r["id"] == 77 and r["lane"] == "BRAVO-CLAUDE" and r["parsed"]["state"] == "ACTIVE"


def test_delivery_update_from_a_non_owner_is_untrusted(running, monkeypatch):
    port, st = running
    monkeypatch.setenv("MC_TRUSTED_AUTHORS", "owner")
    payload = {
        "action": "created",
        "issue": {"number": 5232, "html_url": "https://github.com/o/r/issues/5232"},
        "comment": {
            "id": 78,
            "html_url": "https://github.com/o/r/issues/5232#issuecomment-78",
            "updated_at": "2026-11-12T23:00:00Z",
            "user": {"login": "stranger"},
            "body": "[DELIVERY-UPDATE: BRAVO-CLAUDE]\nUpdated: now\nState: COMPLETE\n",
        },
        "repository": {"full_name": "o/r"},
        "sender": {"login": "stranger"},
    }
    body = json.dumps(payload).encode()
    assert post(port, "/webhook/github", body, hdrs(body, "dlv-10", "issue_comment"))[0] == 202
    assert st.reports()[0]["trusted"] == 0


# --- Codex round 1 (PR #5455) findings -------------------------------------------------


def comment_payload(cid, body, action="created", updated="2026-11-12T23:00:00Z"):
    return {
        "action": action,
        "issue": {"number": 5232, "html_url": "https://github.com/o/r/issues/5232"},
        "comment": {
            "id": cid,
            "html_url": f"https://github.com/o/r/issues/5232#issuecomment-{cid}",
            "updated_at": updated,
            "user": {"login": "owner"},
            "body": body,
        },
        "repository": {"full_name": "o/r"},
        "sender": {"login": "owner"},
    }


def test_replayed_or_late_deliveries_never_revert_a_newer_report(running):  # F5
    port, st = running
    old = "[DELIVERY-UPDATE: BRAVO-CLAUDE]\nUpdated: x\nState: COMPLETE\n"
    new = "[DELIVERY-UPDATE: BRAVO-CLAUDE]\nUpdated: y\nState: BLOCKED\n"
    b_new = json.dumps(comment_payload(77, new, "edited", "2026-11-12T23:00:00Z")).encode()
    b_old = json.dumps(comment_payload(77, old, "created", "2026-11-12T22:00:00Z")).encode()
    assert post(port, "/webhook/github", b_new, hdrs(b_new, "dlv-new", "issue_comment"))[0] == 202
    assert post(port, "/webhook/github", b_old, hdrs(b_old, "dlv-old", "issue_comment"))[0] == 202
    assert st.reports()[0]["parsed"]["state"] == "BLOCKED"  # late delivery ignored
    assert post(port, "/webhook/github", b_new, hdrs(b_new, "dlv-new", "issue_comment"))[0] == 202
    assert st.reports()[0]["parsed"]["state"] == "BLOCKED"  # replay is a no-op


def test_deleted_comment_removes_its_report_and_cannot_be_replayed_back(running):  # F9
    port, st = running
    body = "[DELIVERY-UPDATE: BRAVO-CLAUDE]\nUpdated: x\nState: ACTIVE\n"
    b1 = json.dumps(comment_payload(77, body)).encode()
    post(port, "/webhook/github", b1, hdrs(b1, "dlv-1", "issue_comment"))
    assert st.counts()["reports"] == 1  # precondition
    b2 = json.dumps(comment_payload(77, body, "deleted", "2026-11-12T23:30:00Z")).encode()
    assert post(port, "/webhook/github", b2, hdrs(b2, "dlv-2", "issue_comment"))[0] == 202
    assert st.reports() == []
    b3 = json.dumps(comment_payload(77, body, "created", "2026-11-12T23:40:00Z")).encode()
    post(port, "/webhook/github", b3, hdrs(b3, "dlv-3", "issue_comment"))
    assert st.reports() == []  # an old delivery arriving late cannot resurrect it


def test_editing_the_marker_away_removes_the_report(running):  # F9
    port, st = running
    body = "[DELIVERY-UPDATE: BRAVO-CLAUDE]\nUpdated: x\nState: ACTIVE\n"
    b1 = json.dumps(comment_payload(77, body)).encode()
    post(port, "/webhook/github", b1, hdrs(b1, "dlv-1", "issue_comment"))
    b2 = json.dumps(comment_payload(77, "withdrawn", "edited", "2026-11-12T23:30:00Z")).encode()
    post(port, "/webhook/github", b2, hdrs(b2, "dlv-2", "issue_comment"))
    assert st.reports() == []


def test_check_events_keep_their_conclusion_for_the_ci_tile():  # F7
    payload = {
        "action": "completed",
        "workflow_run": {"id": 5, "conclusion": "success", "status": "completed"},
    }
    row = webhook.normalise("workflow_run", "d", payload, "t")
    assert row["payload"]["conclusion"] == "success" and row["payload"]["status"] == "completed"
    cs = {
        "action": "completed",
        "check_suite": {"id": 6, "conclusion": "failure", "status": "completed"},
    }
    assert webhook.normalise("check_suite", "d", cs, "t")["payload"]["conclusion"] == "failure"
