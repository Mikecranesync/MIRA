"""Characterization tests for tools/lead-hunter/hardening.py.

The module already ships in production; these tests pin its current behavior
so subsequent refactors are safe.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest


# ---------------- singleton_lock ----------------

def test_singleton_lock_first_acquires(tmp_path):
    from hardening import singleton_lock
    with singleton_lock("test-lh-1", lock_dir=tmp_path):
        assert (tmp_path / ".test-lh-1.lock").exists()
    # Lock file removed on exit
    assert not (tmp_path / ".test-lh-1.lock").exists()


def test_singleton_lock_second_invocation_exits_zero(tmp_path):
    """A second process holding the same lock must exit cleanly with code 0."""
    from hardening import singleton_lock

    # Compute the actual path to lead-hunter module in the repo
    lh_dir = Path(__file__).resolve().parents[2] / "tools" / "lead-hunter"

    # Hold the lock in this process; spawn a child that tries to acquire it.
    with singleton_lock("test-lh-2", lock_dir=tmp_path):
        helper = tmp_path / "child.py"
        helper.write_text(
            "import sys\n"
            f"sys.path.insert(0, {str(lh_dir)!r})\n"
            "from hardening import singleton_lock\n"
            f"with singleton_lock('test-lh-2', lock_dir={str(tmp_path)!r}):\n"
            "    pass\n"
        )
        result = subprocess.run([sys.executable, str(helper)], capture_output=True, timeout=10)
        assert result.returncode == 0, result.stderr.decode()


def test_singleton_lock_releases_on_exception(tmp_path):
    from hardening import singleton_lock
    with pytest.raises(RuntimeError):
        with singleton_lock("test-lh-3", lock_dir=tmp_path):
            raise RuntimeError("boom")
    # Lock file gone even after exception
    assert not (tmp_path / ".test-lh-3.lock").exists()


# ---------------- with_retries ----------------

def test_with_retries_returns_value_on_first_success():
    from hardening import with_retries
    calls = []
    def fn():
        calls.append(1)
        return "ok"
    assert with_retries(fn, name="t", retries=3) == "ok"
    assert calls == [1]


def test_with_retries_retries_then_succeeds(monkeypatch):
    from hardening import with_retries
    monkeypatch.setattr("hardening.time.sleep", lambda s: None)
    monkeypatch.setattr("hardening.random.uniform", lambda a, b: 1.0)
    calls = {"n": 0}
    def fn():
        calls["n"] += 1
        if calls["n"] < 3:
            raise ConnectionError("transient")
        return "ok"
    assert with_retries(fn, name="t", retries=3, retry_on=(ConnectionError,)) == "ok"
    assert calls["n"] == 3


def test_with_retries_exhausts_and_raises_last(monkeypatch):
    from hardening import with_retries
    monkeypatch.setattr("hardening.time.sleep", lambda s: None)
    monkeypatch.setattr("hardening.random.uniform", lambda a, b: 1.0)
    def fn():
        raise ConnectionError("always fails")
    with pytest.raises(ConnectionError, match="always fails"):
        with_retries(fn, name="t", retries=2, retry_on=(ConnectionError,))


def test_with_retries_does_not_retry_give_up_class(monkeypatch):
    from hardening import with_retries
    monkeypatch.setattr("hardening.time.sleep", lambda s: None)
    calls = {"n": 0}
    def fn():
        calls["n"] += 1
        raise KeyboardInterrupt()
    with pytest.raises(KeyboardInterrupt):
        with_retries(fn, name="t", retries=5)
    assert calls["n"] == 1  # No retry on KeyboardInterrupt


def test_with_retries_does_not_retry_unlisted_exception(monkeypatch):
    from hardening import with_retries
    calls = {"n": 0}
    def fn():
        calls["n"] += 1
        raise ValueError("not in retry_on")
    with pytest.raises(ValueError):
        with_retries(fn, name="t", retries=3, retry_on=(ConnectionError,))
    assert calls["n"] == 1


import signal as _signal

# ---------------- hard_timeout ----------------

@pytest.mark.skipif(not hasattr(_signal, "SIGALRM"), reason="SIGALRM unavailable on this platform")
def test_hard_timeout_raises_after_expiry():
    from hardening import hard_timeout
    with pytest.raises(TimeoutError):
        with hard_timeout(1):
            time.sleep(2)


def test_hard_timeout_clears_on_normal_exit():
    from hardening import hard_timeout
    with hard_timeout(5):
        pass
    # Subsequent sleep must not get interrupted
    time.sleep(0.05)


# ---------------- preflight_secrets ----------------

def test_preflight_secrets_returns_map(monkeypatch):
    from hardening import preflight_secrets
    monkeypatch.setenv("PRESENT_REQ", "value")
    monkeypatch.setenv("PRESENT_OPT", "value")
    monkeypatch.delenv("MISSING_OPT", raising=False)
    m = preflight_secrets(["PRESENT_REQ"], ["PRESENT_OPT", "MISSING_OPT"])
    assert m == {"PRESENT_REQ": True, "PRESENT_OPT": True, "MISSING_OPT": False}


def test_preflight_secrets_exits_2_on_missing_required(monkeypatch):
    from hardening import preflight_secrets
    monkeypatch.delenv("REQUIRED_X", raising=False)
    with pytest.raises(SystemExit) as exc_info:
        preflight_secrets(["REQUIRED_X"])
    assert exc_info.value.code == 2


def test_preflight_secrets_treats_blank_as_missing(monkeypatch):
    from hardening import preflight_secrets
    monkeypatch.setenv("BLANK_REQ", "   ")
    with pytest.raises(SystemExit) as exc_info:
        preflight_secrets(["BLANK_REQ"])
    assert exc_info.value.code == 2


# ---------------- RunReport ----------------

def test_runreport_step_ok_path():
    from hardening import RunReport
    r = RunReport(routine="t")
    with r.step("a") as step:
        step.detail["x"] = 1
    r.finalize()
    assert r.steps[0].status == "ok"
    assert r.steps[0].detail == {"x": 1}
    assert r.overall == "ok"
    assert r.is_healthy()


def test_runreport_step_fail_swallows_exception_and_marks_overall():
    from hardening import RunReport
    r = RunReport(routine="t")
    with r.step("a"):
        raise ValueError("kaboom")
    r.finalize()
    assert r.steps[0].status == "fail"
    assert "ValueError: kaboom" in r.steps[0].error
    assert r.overall == "fail"
    assert not r.is_healthy()


def test_runreport_skip_marks_degraded():
    from hardening import RunReport
    r = RunReport(routine="t")
    with r.step("a") as step:
        step.status = "skip"
        step.detail["reason"] = "no data"
    r.finalize()
    assert r.overall == "degraded"


def test_runreport_alert_marks_degraded():
    from hardening import RunReport
    r = RunReport(routine="t")
    with r.step("a"):
        pass
    r.add_alert("something is sus")
    r.finalize()
    assert r.overall == "degraded"
    assert r.alerts == ["something is sus"]


def test_runreport_to_json_is_valid():
    from hardening import RunReport
    r = RunReport(routine="t")
    with r.step("a"):
        pass
    r.finalize()
    parsed = json.loads(r.to_json())
    assert parsed["routine"] == "t"
    assert parsed["overall"] == "ok"
    assert len(parsed["steps"]) == 1


# ---------------- alert() ----------------

def test_alert_noop_on_healthy(tmp_path, monkeypatch):
    from hardening import RunReport, alert
    monkeypatch.delenv("DISCORD_ALERT_WEBHOOK", raising=False)
    r = RunReport(routine="t")
    with r.step("a"):
        pass
    r.finalize()
    log_path = tmp_path / "alerts.jsonl"
    alert(r, alert_log=log_path)
    assert not log_path.exists()


def test_alert_appends_jsonl_on_failure(tmp_path, monkeypatch):
    from hardening import RunReport, alert
    monkeypatch.delenv("DISCORD_ALERT_WEBHOOK", raising=False)
    r = RunReport(routine="t")
    with r.step("a"):
        raise RuntimeError("nope")
    r.finalize()
    log_path = tmp_path / "alerts.jsonl"
    alert(r, alert_log=log_path)
    line = log_path.read_text().strip()
    parsed = json.loads(line)
    assert parsed["routine"] == "t"
    assert parsed["overall"] == "fail"


def test_alert_appends_jsonl_on_degraded(tmp_path, monkeypatch):
    from hardening import RunReport, alert
    monkeypatch.delenv("DISCORD_ALERT_WEBHOOK", raising=False)
    r = RunReport(routine="t")
    with r.step("a"):
        pass
    r.add_alert("partial failure")
    r.finalize()
    log_path = tmp_path / "alerts.jsonl"
    alert(r, alert_log=log_path)
    assert log_path.exists()
    parsed = json.loads(log_path.read_text().strip())
    assert parsed["overall"] == "degraded"
    assert parsed["alerts"] == ["partial failure"]
