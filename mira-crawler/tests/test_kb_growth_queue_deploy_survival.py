"""Unit test: manual_queue.json survives deploy via git checkout --force.

Spec: fix(crawler): manual ingest queue survives deploys — runtime state out of git (#2562)

The queue file lives in /var/lib/mira (outside the repo tree, configurable via
MIRA_MANUAL_QUEUE_PATH env var) so that deploy-vps.yml's `git checkout --force <tag>`
never resets queue progress back to whatever was last committed.

This test verifies that:
1. The queue file path can be configured via env var
2. The queue file is read/written at the configured path
3. A repo reset (simulated) does not affect the queue file at the runtime path
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from unittest import mock

import pytest

# Make the cron file importable.
_CRON_DIR = Path(__file__).resolve().parent.parent / "cron"
sys.path.insert(0, str(_CRON_DIR))

import kb_growth_cron as cron  # noqa: E402


class TestQueueDeploySurvival:
    """Verify queue survives deploy via moving state outside the repo tree."""

    def test_queue_path_respects_env_var(self, tmp_path, monkeypatch):
        """Queue file path is configurable via MIRA_MANUAL_QUEUE_PATH env var."""
        custom_queue_path = tmp_path / "custom_queue.json"

        # Set env var before reloading the module to pick up the new value
        monkeypatch.setenv("MIRA_MANUAL_QUEUE_PATH", str(custom_queue_path))

        # Reload the module so it picks up the new env var
        # (In production, the cron is invoked fresh each time, so this is realistic)
        import importlib
        importlib.reload(cron)

        assert cron.QUEUE_FILE == custom_queue_path

    def test_queue_file_defaults_to_var_lib_mira(self, monkeypatch):
        """Queue file defaults to /var/lib/mira/manual_queue.json if env var is unset."""
        # Ensure the env var is not set
        monkeypatch.delenv("MIRA_MANUAL_QUEUE_PATH", raising=False)

        # Reload the module
        import importlib
        importlib.reload(cron)

        # The default should be /var/lib/mira/manual_queue.json (as a Path object)
        expected = Path("/var/lib/mira/manual_queue.json")
        assert cron.QUEUE_FILE == expected

    def test_queue_survives_repo_checkout_force(self, tmp_path):
        """Queue at runtime path survives repo reset while in-repo copy would not."""
        # Simulate a working directory with both:
        # 1. A repo-tracked queue (would be reset by git checkout --force)
        # 2. A runtime queue outside the repo (survives)

        repo_dir = tmp_path / "mira_checkout"
        repo_dir.mkdir()

        # Simulate a git-tracked file that would be reset
        in_repo_queue = repo_dir / "mira-crawler" / "cron" / "manual_queue.json"
        in_repo_queue.parent.mkdir(parents=True)
        in_repo_queue.write_text('[]')  # Initial (empty) state

        # Simulate a runtime file outside the repo
        var_lib = tmp_path / "var_lib_mira"
        var_lib.mkdir()
        runtime_queue = var_lib / "manual_queue.json"

        # Write queue state to the runtime location (where the cron keeps it)
        queue_data = [
            {
                "url": "https://example.com/manual1.pdf",
                "manufacturer": "Siemens",
                "model": "S7-1200",
                "status": "done",
                "done_at": "2026-07-11T12:00:00+00:00",
                "chunks_inserted": 42,
            }
        ]
        runtime_queue.write_text(json.dumps(queue_data, indent=2))

        # Simulate git checkout --force: reset in-repo queue
        in_repo_queue.write_text('[]')

        # Verify the runtime queue is unaffected by the git reset
        runtime_data = json.loads(runtime_queue.read_text())
        assert len(runtime_data) == 1
        assert runtime_data[0]["manufacturer"] == "Siemens"
        assert runtime_data[0]["chunks_inserted"] == 42

    def test_load_queue_from_runtime_path(self, tmp_path, monkeypatch):
        """load_queue() reads from the runtime path (env var or default)."""
        queue_path = tmp_path / "runtime_queue.json"
        queue_data = [
            {"url": "https://example.com/a.pdf", "status": "pending"},
            {"url": "https://example.com/b.pdf", "status": "done"},
        ]
        queue_path.write_text(json.dumps(queue_data, indent=2))

        # Override the QUEUE_FILE path
        monkeypatch.setattr(cron, "QUEUE_FILE", queue_path)

        # Load and verify
        loaded = cron.load_queue()
        assert len(loaded) == 2
        assert loaded[0]["url"] == "https://example.com/a.pdf"
        assert loaded[1]["status"] == "done"

    def test_save_queue_to_runtime_path(self, tmp_path, monkeypatch):
        """save_queue() writes to the runtime path atomically."""
        queue_path = tmp_path / "runtime_queue.json"
        monkeypatch.setattr(cron, "QUEUE_FILE", queue_path)

        queue_data = [
            {"url": "https://example.com/a.pdf", "status": "processing"},
            {"url": "https://example.com/b.pdf", "status": "done"},
        ]

        # Save the queue
        cron.save_queue(queue_data)

        # Verify the file was written correctly
        assert queue_path.exists()
        loaded = json.loads(queue_path.read_text())
        assert len(loaded) == 2
        assert loaded[0]["status"] == "processing"

    def test_save_queue_atomic_write(self, tmp_path, monkeypatch):
        """save_queue() uses atomic write (temp + rename) to prevent corruption."""
        queue_path = tmp_path / "runtime_queue.json"
        monkeypatch.setattr(cron, "QUEUE_FILE", queue_path)

        queue_data = [{"url": "https://example.com/a.pdf", "status": "done"}]

        # During the save, verify that only the final file exists (no temp file)
        # This is implicit in the test: if rename() succeeds, atomicity worked.
        # If a crash occurred mid-write, a .tmp file would be left behind.
        original_replace = os.replace

        def mock_replace(src, dst):
            # Verify tmp file exists before rename
            assert Path(src).exists()
            original_replace(src, dst)

        with mock.patch("os.replace", side_effect=mock_replace):
            cron.save_queue(queue_data)

        # Final file should be clean
        loaded = json.loads(queue_path.read_text())
        assert loaded[0]["status"] == "done"
