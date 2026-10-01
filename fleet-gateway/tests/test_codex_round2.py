"""Codex round-2 findings on #4180 @ 0a17ee84d — one test per finding, through real paths.

The refusal render below is copied from a real CAO terminal log of a lane that hit its
limit (logs/terminal/f02ba53d): the refusal is ⎿-prefixed, then only chrome follows.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from fleet_gateway import lane_health
from fleet_gateway import service as service_mod
from fleet_gateway.errors import ContractViolation
from fleet_gateway.lane_health import derive_lane_state
from helpers import LAUNCH_OK

NY = "America/New_York"


def _real_refusal(reset: str = f"12am ({NY})", kind: str = "weekly") -> str:
    return (
        "❯ remount 3825\n"
        f"  ⎿  You've hit your {kind} limit · resets {reset}\n"
        "    /usage-credits to finish what you’re working on.\n"
        "\n"
        "✻ Sautéed for 1s\n"
        "────────────────────────────────\n"
        "❯ \n"
        "────────────────────────────────\n"
        "  ⏵⏵ bypass permissions on (shift+tab to cycle)\n"
    )


def _at(y: int, mo: int, d: int, h: int = 12) -> float:
    return datetime(y, mo, d, h, 0, tzinfo=ZoneInfo(NY)).timestamp()


def _idle(output: str) -> dict[str, Any]:
    return {"terminal_status": "idle", "launched_at": time.time() - 30, "terminal_output": output}


# ── F1: a terminal that errors before ever being ready is init_failed, never ready ──
@pytest.mark.parametrize("elapsed", [10, 100])
def test_f1_error_before_ready_is_init_failed(elapsed: int) -> None:
    session = {"terminal_status": "error", "launched_at": time.time() - elapsed}
    state, err = derive_lane_state(session)
    assert state == "init_failed" and err


def test_f1_unknown_status_past_grace_is_not_ready() -> None:
    session = {"terminal_status": "weird", "launched_at": time.time() - 500}
    assert derive_lane_state(session)[0] == "init_failed"


def test_f1_real_render_still_blocks() -> None:
    session = _idle(_real_refusal())
    assert derive_lane_state(session)[0] == "blocked_usage_limit"


# ── F2: only the lane's LAST answer counts ──
@pytest.mark.parametrize(
    "output",
    [
        "⏺ Bash(cat error.log)\n  ⎿  You've hit your weekly limit · resets 12am (America/New_York)\n"
        "⏺ Log inspected; tests pass.\n❯ \n",
        "Bash(cat error.log)\n⎿ You've hit your weekly limit · resets 12am (America/New_York)\n"
        "⏺ Log inspected; tests pass.\n",
        "⏺ Example:\n> You've hit your weekly limit · resets 12am (America/New_York)\nThis is only an example\n",
        "⏺ Read(log.txt)\n  ⎿  You've hit your weekly limit · resets 12am (America/New_York)\n"
        "✻ Sautéed for 1s\n❯ \n",
    ],
    ids=["answer_after", "tool_header_no_glyph", "blockquote", "tool_output_last"],
)
def test_f2_text_that_is_not_the_last_answer_does_not_block(output: str) -> None:
    assert derive_lane_state(_idle(output))[0] != "blocked_usage_limit"


# ── F3: valid zones parse ──
@pytest.mark.parametrize("tz", ["UTC", "America/Argentina/Buenos_Aires", "Etc/GMT+3"])
def test_f3_valid_zones_parse(tz: str) -> None:
    assert lane_health._parse_reset_time(f"resets 4am ({tz})", time.time()) is not None


# ── F4: a launch refreshes the node's own lanes; no prior task_status needed ──
def test_f4_refusal_blocks_next_launch_without_a_status_poll(service, auth, cao, monkeypatch) -> None:
    first = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    sid = first.get("session_id") or next(iter(cao.sessions))
    cao.sessions[sid]["terminal_output"] = _real_refusal()
    cao.sessions[sid]["terminal_status"] = "idle"
    created: list[Any] = []
    target = service.router.target("bravo")
    monkeypatch.setattr(target.worktrees, "create", lambda **kw: created.append(kw))
    with pytest.raises(ContractViolation, match="usage limit"):
        service.invoke("launch_worker", dict(LAUNCH_OK, task_id="issue-3532-f4"), authorization=auth)
    assert created == []


# ── F5: a NEW refusal on the same session is not masked by the first one's pin ──
def test_f5_second_refusal_after_recovery_blocks_again(service, auth, cao, monkeypatch) -> None:
    first = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    sid = first.get("session_id") or next(iter(cao.sessions))
    sess = cao.sessions[sid]
    sess["terminal_status"] = "idle"
    sess["terminal_output"] = _real_refusal("12am (America/New_York)", "session")
    service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    first_reset = service._blocked_until["bravo"]
    later = first_reset + 3600  # first reset passed
    monkeypatch.setattr(service_mod.time, "time", lambda: later)
    sess["terminal_output"] = "⏺ resumed work; all done.\n❯ \n"  # lane recovered
    service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    sess["terminal_output"] = _real_refusal("12am (America/New_York)", "session")  # refused again
    service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    assert service._blocked_until.get("bravo", 0) > later


# ── F6: an implausible or stale dated reset never blocks for months ──
@pytest.mark.parametrize(
    "reset, now",
    [(f"Mar 31 at 12am ({NY})", _at(2026, 10, 1)), (f"Feb 29 at 1am ({NY})", _at(2027, 2, 25))],
)
def test_f6_dated_reset_outside_a_week_never_blocks_long(reset: str, now: float) -> None:
    session = _idle(_real_refusal(reset))
    derive_lane_state(session, now=now)
    assert session.get("blocked_until", now) <= now + 8 * 86400


# ── F7: a reset already in the past does not report blocked ──
def test_f7_expired_dated_refusal_is_not_reported_blocked() -> None:
    session = _idle(_real_refusal(f"Sep 12 at 12am ({NY})"))
    assert derive_lane_state(session, now=_at(2026, 10, 1))[0] != "blocked_usage_limit"


# ── F8: reset-passed path produced by the code, not injected ──
def test_f8_stale_time_only_refusal_unblocks_after_its_first_reset(service, auth, cao, monkeypatch) -> None:
    first = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    sid = first.get("session_id") or next(iter(cao.sessions))
    cao.sessions[sid]["terminal_output"] = _real_refusal()
    cao.sessions[sid]["terminal_status"] = "idle"
    service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    first_reset = service._blocked_until["bravo"]
    monkeypatch.setattr(service_mod.time, "time", lambda: first_reset + 60)
    status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    assert status["lane_state"] != "blocked_usage_limit"
    service.invoke("launch_worker", dict(LAUNCH_OK, task_id="issue-3532-f8"), authorization=auth)


def test_f8_trust_preflight_reads_the_real_file(service, auth, tmp_path, monkeypatch) -> None:
    repo = str(service.router.target("bravo").worktrees.repo)
    service._trust_reader = None
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    (home / ".claude.json").write_text(json.dumps({"projects": {repo: {"hasTrustDialogAccepted": False}}}))
    with pytest.raises(ContractViolation):
        service.invoke("launch_worker", dict(LAUNCH_OK, task_id="trust-f"), authorization=auth)
    (home / ".claude.json").write_text(json.dumps({"projects": {repo: {"hasTrustDialogAccepted": True}}}))
    assert service.invoke("launch_worker", dict(LAUNCH_OK, task_id="trust-t"), authorization=auth)["session_id"]


def test_stale_week_old_dated_refusal_relative_to_now() -> None:
    stale = datetime.now(ZoneInfo(NY)) - timedelta(days=19)
    session = _idle(_real_refusal(f"{stale:%b} {stale.day} at 12am ({NY})"))
    assert derive_lane_state(session)[0] != "blocked_usage_limit"
