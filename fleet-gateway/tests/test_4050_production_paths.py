"""#4050 — prove the lane-health fixes through the PRODUCTION code paths.

The earlier tests inject a blanket trust reader and set _blocked_until by hand;
these exercise the real seams instead: check_repo_trust's ssh/local reads,
LoopbackCAOClient.get_session/task_snapshot, and the service's limit pinning.
Never touches the real ~/.claude.json (HOME is redirected to tmp_path).
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError

import pytest

from fleet_gateway import lane_health
from fleet_gateway.cao import LoopbackCAOClient
from fleet_gateway.errors import ContractViolation
from fleet_gateway.lane_health import check_repo_trust, derive_lane_state
from helpers import LAUNCH_OK

LIMIT_TEXT = "⏺ You've hit your weekly limit · resets 12am (America/New_York)"


class _Prov:
    """Stands in for WorktreeProvisioner. Its _run EXECUTES the remote probe locally
    against a fake ~/.claude.json, so the real probe code is what gets tested."""

    def __init__(self, ssh_host: str | None, claude_json: str | None = None, rc: int | None = None) -> None:
        self.ssh_host = ssh_host
        self.claude_json, self.rc = claude_json, rc
        self.runs: list[list[str]] = []

    def _run(self, argv: list[str], *, timeout: float) -> subprocess.CompletedProcess[str]:
        self.runs.append(list(argv))
        if self.rc is not None:
            return subprocess.CompletedProcess(argv, self.rc, "", "ssh: connect failed")
        import tempfile
        with tempfile.TemporaryDirectory() as home:
            Path(home, ".claude.json").write_text(self.claude_json or "{}", encoding="utf-8")
            return subprocess.run(argv, capture_output=True, text=True, env={"HOME": home, "PATH": "/usr/bin:/bin:/opt/homebrew/bin"})


def _write_home(base: Path, doc: str) -> Path:
    home = base / "probe-home"
    home.mkdir(exist_ok=True)
    (home / ".claude.json").write_text(doc, encoding="utf-8")
    return home


def _claude_json(repo: str, trusted: bool | None) -> str:
    entry: dict[str, Any] = {} if trusted is None else {"hasTrustDialogAccepted": trusted}
    return json.dumps({"projects": {repo: entry}})


# ── D2: trust is read on the TARGET node ────────────────────────────────────
CHARLIE_REPO = "/Users/charlienode/MIRA"


def test_charlie_trust_is_read_over_ssh_not_locally(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))  # local file absent: any local read would raise
    monkeypatch.delenv("FLEET_GATEWAY_SKIP_TRUST_PREFLIGHT", raising=False)
    secret_doc = json.dumps({"oauthAccount": {"accessToken": "sk-SECRET"},
                             "projects": {CHARLIE_REPO: {"hasTrustDialogAccepted": True}}})
    prov = _Prov("charlie", claude_json=secret_doc)
    assert check_repo_trust(CHARLIE_REPO, provisioner=prov) is True
    argv = prov.runs[0]
    assert argv[0] == "python3" and argv[-1] == CHARLIE_REPO  # repo travels as argv, not code
    out = subprocess.run(argv, capture_output=True, text=True, env={"HOME": str(_write_home(tmp_path, secret_doc)), "PATH": "/usr/bin:/bin:/opt/homebrew/bin"}).stdout
    assert out.strip() == "True" and "sk-SECRET" not in out  # only the boolean crosses the wire


def test_charlie_missing_entry_is_trust_unknown(monkeypatch) -> None:
    monkeypatch.delenv("FLEET_GATEWAY_SKIP_TRUST_PREFLIGHT", raising=False)
    prov = _Prov("charlie", claude_json=json.dumps({"projects": {}}))
    with pytest.raises(ValueError, match="trust state unknown"):
        check_repo_trust(CHARLIE_REPO, provisioner=prov)


def test_charlie_ssh_failure_is_trust_unknown(monkeypatch) -> None:
    monkeypatch.delenv("FLEET_GATEWAY_SKIP_TRUST_PREFLIGHT", raising=False)
    with pytest.raises(ValueError, match="trust state unknown"):
        check_repo_trust(CHARLIE_REPO, provisioner=_Prov("charlie", rc=255))


def test_charlie_untrusted_is_false(monkeypatch) -> None:
    monkeypatch.delenv("FLEET_GATEWAY_SKIP_TRUST_PREFLIGHT", raising=False)
    assert check_repo_trust(CHARLIE_REPO, provisioner=_Prov("charlie", claude_json=_claude_json(CHARLIE_REPO, False))) is False


def test_bravo_reads_local_file_and_never_ssh(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.delenv("FLEET_GATEWAY_SKIP_TRUST_PREFLIGHT", raising=False)
    repo = "/Users/bravonode/Mira"
    (tmp_path / ".claude.json").write_text(_claude_json(repo, False), encoding="utf-8")
    prov = _Prov(None)
    assert check_repo_trust(repo, provisioner=prov) is False
    assert prov.runs == []  # bravo never shells out for trust
    (tmp_path / ".claude.json").write_text(_claude_json(repo, True), encoding="utf-8")
    assert check_repo_trust(repo, provisioner=prov) is True


def test_service_refuses_untrusted_bravo_before_worktree(service, auth, monkeypatch) -> None:
    """Real _check_repo_trust path (no injected reader): refusal names the fix, no worktree."""
    service._trust_reader = None
    monkeypatch.delenv("FLEET_GATEWAY_SKIP_TRUST_PREFLIGHT", raising=False)
    monkeypatch.setattr(lane_health, "check_repo_trust", lambda repo, provisioner=None, **_: False)
    import fleet_gateway.service as svc_mod

    monkeypatch.setattr(svc_mod, "check_repo_trust", lambda repo, provisioner=None, **_: False)
    created: list[Any] = []
    target = service.router.target("bravo")
    monkeypatch.setattr(target.worktrees, "create", lambda **kw: created.append(kw))
    with pytest.raises(ContractViolation, match="Yes, I trust this folder"):
        service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    assert created == []


# ── D3: readiness persists through the REAL client across a 404 ─────────────
def _client_with(responses: dict[str, Any]) -> LoopbackCAOClient:
    c = LoopbackCAOClient("http://127.0.0.1:9889")

    def fake_request(method, path, payload=None, *, params=None, timeout=None):
        r = responses.get(f"{method} {path}")
        if isinstance(r, Exception):
            raise r
        return r if r is not None else {}

    c._request = fake_request  # type: ignore[method-assign]
    return c


def _seed(c: LoopbackCAOClient, sid: str, *, launched_ago: float) -> None:
    c._sessions[sid] = {"session_id": sid, "task_id": "t-4050", "role": "bravo", "terminal_id": "t1",
                        "status": "running", "launched_at": time.time() - launched_ago, "terminal_status": None}
    c._session_order.append(sid)


def test_ready_lane_that_later_404s_is_stopped_not_init_failed() -> None:
    sid = "s-ready"
    resp: dict[str, Any] = {f"GET /sessions/{sid}": {"session": {}, "terminals": [{"id": "t1", "status": "idle"}]},
                            "GET /terminals/t1/output": {"output": "❯ "}}
    c = _client_with(resp)
    _seed(c, sid, launched_ago=500)
    assert derive_lane_state(c.task_snapshot("t-4050"))[0] == "ready"
    assert c._sessions[sid].get("ever_ready") is True  # persisted on the STORED dict
    resp[f"GET /sessions/{sid}"] = HTTPError("u", 404, "gone", None, None)  # type: ignore[arg-type]
    assert derive_lane_state(c.task_snapshot("t-4050"))[0] == "stopped"


def test_never_ready_lane_gone_after_grace_is_init_failed() -> None:
    sid = "s-dead"
    c = _client_with({f"GET /sessions/{sid}": HTTPError("u", 404, "gone", None, None)})  # type: ignore[dict-item]
    _seed(c, sid, launched_ago=500)
    state, err = derive_lane_state(c.task_snapshot("t-4050"))
    assert state == "init_failed" and err


# ── D1: output fetch → block → refused launch, through the real client ──────
def test_limit_text_from_real_output_endpoint_is_detected() -> None:
    sid = "s-limit"
    c = _client_with({f"GET /sessions/{sid}": {"session": {}, "terminals": [{"id": "t1", "status": "idle"}]},
                      "GET /terminals/t1/output": {"output": "old scrollback\n" + LIMIT_TEXT}})
    _seed(c, sid, launched_ago=30)
    snap = c.task_snapshot("t-4050")
    state, _ = derive_lane_state(snap)
    assert state == "blocked_usage_limit"
    assert snap["blocked_until"] > time.time()


def test_output_endpoint_error_is_fail_open() -> None:
    sid = "s-noout"
    c = _client_with({f"GET /sessions/{sid}": {"session": {}, "terminals": [{"id": "t1", "status": "idle"}]},
                      "GET /terminals/t1/output": RuntimeError("cao output down")})
    _seed(c, sid, launched_ago=30)
    assert derive_lane_state(c.task_snapshot("t-4050"))[0] == "ready"


def test_status_detection_blocks_next_launch_with_no_worktree(service, auth, cao, monkeypatch) -> None:
    first = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    sid = first.get("session_id") or next(iter(cao.sessions))
    cao.sessions[sid]["terminal_output"] = LIMIT_TEXT
    cao.sessions[sid]["terminal_status"] = "idle"
    status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    assert status["lane_state"] == "blocked_usage_limit"
    assert re.match(r"usage limit reached on bravo; resets \d{4}-\d{2}-\d{2} \d{4}Z$", status.get("lane_error", ""))
    created: list[Any] = []
    target = service.router.target("bravo")
    monkeypatch.setattr(target.worktrees, "create", lambda **kw: created.append(kw))
    with pytest.raises(ContractViolation, match=r"usage limit; resets at \d{4}-\d{2}-\d{2} \d{4}Z") as exc:
        service.invoke("launch_worker", dict(LAUNCH_OK, task_id="issue-3532-b"), authorization=auth)
    assert "[redacted]" not in str(exc.value)  # reset time survives the public-payload redactor
    assert created == []


def test_stale_limit_text_does_not_reblock_after_reset(service, auth, cao) -> None:
    """The limit line stays in scrollback; once its FIRST reset passes, the node unblocks."""
    first = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    sid = first.get("session_id") or next(iter(cao.sessions))
    cao.sessions[sid]["terminal_output"] = LIMIT_TEXT
    cao.sessions[sid]["terminal_status"] = "idle"
    service._limit_reset_by_session[sid] = time.time() - 1  # first sighting's reset already passed
    service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    assert service._blocked_until.get("bravo") is None
    service.invoke("launch_worker", dict(LAUNCH_OK, task_id="issue-3532-c"), authorization=auth)


# ── Limit detection must not fire on text that merely CONTAINS the message ──
_NOT_A_REFUSAL = {
    "diff_of_this_fixture": '+LIMIT_TEXT = "⏺ You\'ve hit your weekly limit · resets 12am (America/New_York)"',
    "grep_hit": "tests/x.py:12:You've hit your weekly limit · resets 12am (America/New_York)",
    "quoted_in_prose": '⏺ The lane printed "You\'ve hit your weekly limit" earlier, then recovered.',
    "scrolled_past_then_prompt": "\n".join(
        [LIMIT_TEXT] + [f"⏺ step {i} done" for i in range(25)] + ["❯ "]),
}


@pytest.mark.parametrize("label", sorted(_NOT_A_REFUSAL))
def test_quoted_limit_text_does_not_block(label: str) -> None:
    session = {"terminal_status": "idle", "terminal_output": _NOT_A_REFUSAL[label],
               "launched_at": time.time() - 30}
    assert derive_lane_state(session)[0] != "blocked_usage_limit", label
    assert "blocked_until" not in session


def test_limit_text_while_processing_does_not_block() -> None:
    """A lane mid-turn hasn't been refused; only an idle/completed lane's last answer counts."""
    session = {"terminal_status": "processing", "terminal_output": LIMIT_TEXT, "launched_at": time.time() - 30}
    assert derive_lane_state(session)[0] != "blocked_usage_limit"


# ── Reset parsing against the formats seen in real lane transcripts (09-10..09-27) ──
NY = "America/New_York"


def _at(y: int, mo: int, d: int, h: int = 12) -> float:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime(y, mo, d, h, 0, tzinfo=ZoneInfo(NY)).timestamp()


def test_parse_real_time_only_format() -> None:
    now = _at(2026, 9, 10, 15)
    got = lane_health._parse_reset_time(f"You've hit your weekly limit · resets 12am ({NY})", now)
    assert got == _at(2026, 9, 11, 0)  # next midnight, not today's


def test_parse_real_dated_weekly_format() -> None:
    """21 of 39 real refusals carry a date; before this fix they fell back to a 1 h backoff."""
    now = _at(2026, 9, 10, 15)
    got = lane_health._parse_reset_time(f"You've hit your weekly limit · resets Sep 12 at 12am ({NY})", now)
    assert got == _at(2026, 9, 12, 0)


def test_parse_dated_format_rolls_to_next_year() -> None:
    now = _at(2026, 12, 30, 15)
    got = lane_health._parse_reset_time(f"You've hit your weekly limit · resets Jan 2 at 12am ({NY})", now)
    assert got == _at(2027, 1, 2, 0)


def test_dated_limit_blocks_until_that_date_end_to_end() -> None:
    session = {"terminal_status": "idle", "launched_at": time.time() - 30,
               "terminal_output": f"❯ remount 3825\n⏺ You've hit your weekly limit · resets Sep 12 at 12am ({NY})\n"}
    assert derive_lane_state(session, now=_at(2026, 9, 10, 15))[0] == "blocked_usage_limit"
    assert session["blocked_until"] == _at(2026, 9, 12, 0)


def test_stale_dated_refusal_is_in_the_past_not_next_year() -> None:
    """A lane left idle on last week's refusal must not block its node for a year."""
    now = _at(2026, 10, 1, 11)
    got = lane_health._parse_reset_time(f"You've hit your weekly limit · resets Sep 12 at 12am ({NY})", now)
    assert got == _at(2026, 9, 12, 0)


def test_stale_dated_refusal_does_not_block_the_node() -> None:
    session = {"terminal_status": "idle", "launched_at": time.time() - 30,
               "terminal_output": f"⏺ You've hit your weekly limit · resets Sep 12 at 12am ({NY})\n"}
    derive_lane_state(session, now=_at(2026, 10, 1, 11))
    assert session["blocked_until"] < _at(2026, 10, 1, 11)


def test_feb_29_in_a_non_leap_year_does_not_raise() -> None:
    now = _at(2027, 2, 25, 12)
    got = lane_health._parse_reset_time(f"You've hit your weekly limit · resets Feb 29 at 1am ({NY})", now)
    assert got == _at(2028, 2, 29, 1)


def test_stale_dated_refusal_does_not_refuse_the_next_launch(service, auth, cao) -> None:
    """Behaviour, not the stored value: a lane idle on a weekly refusal dated 19 days ago
    is polled, and the next launch on that node must still go through."""
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    stale = datetime.now(ZoneInfo(NY)) - timedelta(days=19)
    refusal = f"⏺ You've hit your weekly limit · resets {stale:%b} {stale.day} at 12am ({NY})"
    first = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    sid = first.get("session_id") or next(iter(cao.sessions))
    cao.sessions[sid]["terminal_output"] = refusal
    cao.sessions[sid]["terminal_status"] = "idle"
    service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    assert service._blocked_until.get("bravo") is None
    service.invoke("launch_worker", dict(LAUNCH_OK, task_id="issue-3532-stale"), authorization=auth)
