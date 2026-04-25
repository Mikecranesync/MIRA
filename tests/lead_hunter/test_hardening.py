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
