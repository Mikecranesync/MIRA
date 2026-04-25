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
