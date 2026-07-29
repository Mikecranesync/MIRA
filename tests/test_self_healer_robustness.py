"""Guards the 2026-07-08 self-healer robustness fixes.

That night the self-healer crash-looped `docker compose up` against a running
deploy, firing a Telegram escalation every 15 min for the transient 502 window,
and concurrent heartbeat/self-healer writes deadlocked on `system_health_log`
(DDL SHARE lock vs INSERT RowExclusiveLock, run in the same transaction on every
persist). These tests lock the three behaviors that prevent a repeat:

  1. deploy_in_progress()      — stand down during a deploy (with stale-sentinel aging)
  2. is_retryable_db_error()   — classify deadlock/serialization for retry
  3. _should_notify()          — escalate once, not every run (crash-loop dedup)
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_AGENTS = _ROOT / "mira-crawler" / "agents"
# self_healer falls back to `import heartbeat_monitor` (agents dir on path) when
# the `mira_crawler.agents` package import fails (hyphen in dir name).
sys.path.insert(0, str(_AGENTS))
sys.path.insert(0, str(_ROOT))

import heartbeat_monitor as hb  # noqa: E402
import self_healer as sh  # noqa: E402


# ── deploy stand-down ─────────────────────────────────────────────────────────


def test_deploy_in_progress_absent(tmp_path, monkeypatch):
    monkeypatch.setenv("MIRA_DIR", str(tmp_path))
    assert hb.deploy_in_progress() is False


def test_deploy_in_progress_fresh_sentinel(tmp_path, monkeypatch):
    monkeypatch.setenv("MIRA_DIR", str(tmp_path))
    (tmp_path / ".deploy-in-progress").write_text("")
    assert hb.deploy_in_progress() is True


def test_deploy_in_progress_stale_sentinel_ignored(tmp_path, monkeypatch):
    monkeypatch.setenv("MIRA_DIR", str(tmp_path))
    sentinel = tmp_path / ".deploy-in-progress"
    sentinel.write_text("")
    old = time.time() - hb.DEPLOY_SENTINEL_TTL_SEC - 60
    os.utime(sentinel, (old, old))
    # A crashed deploy that never cleaned up must not disable monitoring forever.
    assert hb.deploy_in_progress() is False


# ── retryable DB error classification ─────────────────────────────────────────


def test_is_retryable_db_error_true():
    assert hb.is_retryable_db_error(Exception("deadlock detected"))
    assert hb.is_retryable_db_error(Exception("ERROR: could not serialize access"))
    assert hb.is_retryable_db_error(Exception("psycopg2 SQLSTATE 40P01"))
    assert hb.is_retryable_db_error(Exception("serialization failure (40001)"))


def test_is_retryable_db_error_false():
    assert not hb.is_retryable_db_error(Exception('relation "x" does not exist'))
    assert not hb.is_retryable_db_error(Exception("connection refused"))
    assert not hb.is_retryable_db_error(Exception("permission denied"))


# ── escalation dedup (crash-loop breaker) ─────────────────────────────────────


def _action(gave_up: bool, prior: int = 0, succeeded: bool = False) -> sh.HealAction:
    return sh.HealAction(
        service="mira-mcp-saas",
        hint="container_missing",
        action="x",
        succeeded=succeeded,
        details="x",
        escalated=gave_up,
        gave_up=gave_up,
        prior_gaveups=prior,
    )


def test_notify_on_first_giveup():
    # First give-up (no prior give-up logged) → alert once.
    assert sh._should_notify([_action(gave_up=True, prior=0)]) is True


def test_suppress_repeat_giveup():
    # Already alerted a give-up for this service → stay quiet.
    assert sh._should_notify([_action(gave_up=True, prior=3)]) is False


def test_notify_when_any_active_action():
    # A normal heal (success or pre-cap failure) alongside a repeat give-up
    # still carries new info → notify.
    acts = [_action(gave_up=True, prior=9), _action(gave_up=False, succeeded=True)]
    assert sh._should_notify(acts) is True


def test_giveup_cap_constant_sane():
    # Guard against a fat-finger that would disable the crash-loop breaker.
    assert 1 <= sh.MAX_HEAL_ATTEMPTS <= 20
    assert sh.HEAL_HISTORY_WINDOW_MIN >= 15


# ── heartbeat DOWN-alert throttle (sustained-outage backoff) ───────────────────


def test_down_alert_first_time_alerts():
    # No prior alert → page immediately.
    assert hb._should_send_down_alert(None, 60) is True


def test_down_alert_throttled_within_window():
    # Still down, alerted 25m ago, window 60m → stay quiet.
    assert hb._should_send_down_alert(25.0, 60) is False


def test_down_alert_renotify_after_window():
    # Still down past the window → page again (and at the exact boundary).
    assert hb._should_send_down_alert(65.0, 60) is True
    assert hb._should_send_down_alert(60.0, 60) is True


def test_down_renotify_constant_sane():
    assert hb.DOWN_RENOTIFY_MIN >= 15
