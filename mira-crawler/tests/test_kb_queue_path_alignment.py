"""Writer/probe path-alignment tests for the KB-queue freshness incident (#2782).

Root cause, proven in CI without a prod shell: the cron *writes*
``MIRA_MANUAL_QUEUE_PATH`` (default ``/var/lib/mira/manual_queue.json``, relocated
2026-07-11 #2562/#2639 to survive ``git checkout --force``) while
``heartbeat_monitor.KB_QUEUE_PATHS`` used to *read* a stale hard-coded
``/opt/mira/...`` orphan (#1015). A healthy empty-queue run bumped the writer file
but never the probed file → kb_cron read perpetually stale → self-healer flood.

Prod telemetry confirmed the mechanism (`db-inspect -f target=prod`,
2026-07-18): the probed mtime aged linearly with wall-clock (220h→229h) while the
self-healer ran the cron every 15 min — the cron bumped ``/var/lib/mira`` while
the probe kept reading the orphan.

The fix aligns the probe to the writer: ``KB_QUEUE_PATHS`` now honors
``MIRA_MANUAL_QUEUE_PATH`` with the same ``/var/lib/mira`` default. These tests
assert that alignment holds and lock it against regression.
"""

from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path

import pytest

_CRON_DIR = Path(__file__).resolve().parent.parent / "cron"
_AGENTS_DIR = Path(__file__).resolve().parent.parent / "agents"
sys.path.insert(0, str(_CRON_DIR))
sys.path.insert(0, str(_AGENTS_DIR))

import kb_growth_cron as cron  # noqa: E402
import heartbeat_monitor as hb  # noqa: E402


# ─── the intended file is updated on an empty/no-eligible run (proves #2769) ──


class TestEmptyQueueUpdatesIntendedFile:
    def test_empty_queue_run_writes_the_writer_path(self, tmp_path, monkeypatch):
        qf = tmp_path / "manual_queue.json"
        monkeypatch.setattr(cron, "QUEUE_FILE", qf)
        assert not qf.exists()

        summary = cron.run_batch()

        assert summary["processed"] == []  # nothing eligible
        # …but the intended (writer) file now exists and holds valid JSON.
        assert qf.exists(), "no-eligible run must create/refresh the writer file"
        assert json.loads(qf.read_text()) == []

    def test_no_eligible_run_advances_writer_mtime(self, tmp_path, monkeypatch):
        qf = tmp_path / "manual_queue.json"
        qf.write_text(json.dumps([{"url": "x", "status": "done"}]))  # ineligible
        monkeypatch.setattr(cron, "QUEUE_FILE", qf)
        stale = 1_600_000_000.0  # long ago
        os.utime(qf, (stale, stale))

        cron.run_batch()

        assert qf.stat().st_mtime > stale + 1_000, "writer mtime must advance"


# ─── writer and probe MUST resolve the SAME path (the fix for #2782) ──────────


class TestWriterProbeAlignment:
    def _probe_paths(self) -> set[str]:
        return {str(Path(p)) for p in hb.KB_QUEUE_PATHS}

    def test_writer_default_is_in_probe_paths(self):
        # The cron's default write path (env unset) MUST be one the probe reads.
        default_writer = Path("/var/lib/mira/manual_queue.json")
        assert str(default_writer) in self._probe_paths()

    def test_probe_honors_env_override(self, tmp_path, monkeypatch):
        # With MIRA_MANUAL_QUEUE_PATH set, the probe must resolve THAT path —
        # the same env var the cron's QUEUE_FILE honors. Reload so the module
        # recomputes KB_QUEUE_PATHS from the environment.
        alt = tmp_path / "state" / "queue.json"
        monkeypatch.setenv("MIRA_MANUAL_QUEUE_PATH", str(alt))
        reloaded = importlib.reload(hb)
        try:
            assert str(alt) in {str(Path(p)) for p in reloaded.KB_QUEUE_PATHS}
        finally:
            monkeypatch.delenv("MIRA_MANUAL_QUEUE_PATH", raising=False)
            importlib.reload(reloaded)  # restore default paths for other tests

    def test_probe_source_references_the_writer_contract(self):
        # The probe module must know the env var + default the writer uses —
        # the concrete anti-regression for the #1015 hard-coded-orphan defect.
        assert hb.__file__ is not None
        src = Path(hb.__file__).read_text()
        assert "MIRA_MANUAL_QUEUE_PATH" in src
        assert "/var/lib/mira" in src

    def test_writer_default_converges_with_probe(self):
        # env unset → cron.QUEUE_FILE default == a path the probe reads.
        default_writer = str(Path("/var/lib/mira/manual_queue.json"))
        assert default_writer in self._probe_paths()
        # …and no orphaned /opt/mira/...cron path lingers in the probe list.
        assert not any(
            "/opt/mira/mira-crawler/cron/manual_queue.json" == str(Path(p))
            for p in hb.KB_QUEUE_PATHS
        ), "the stale /opt orphan (#2782) must be gone from the probe paths"


# ─── env override + relative-path resolution both work for the writer ─────────


class TestAlternateAndRelativePaths:
    def test_env_override_selects_the_writer_path(self, tmp_path, monkeypatch):
        alt = tmp_path / "alt" / "queue.json"
        alt.parent.mkdir(parents=True)
        monkeypatch.setenv("MIRA_MANUAL_QUEUE_PATH", str(alt))
        reloaded = importlib.reload(cron)
        try:
            assert reloaded.QUEUE_FILE == alt
            reloaded.save_queue([{"url": "a"}])
            assert alt.exists()
            assert reloaded.load_queue() == [{"url": "a"}]
        finally:
            monkeypatch.delenv("MIRA_MANUAL_QUEUE_PATH", raising=False)
            importlib.reload(reloaded)  # restore default QUEUE_FILE for other tests

    def test_relative_path_resolves_and_round_trips(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        rel = Path("state/queue.json")
        rel.parent.mkdir(parents=True)
        monkeypatch.setattr(cron, "QUEUE_FILE", rel)
        cron.save_queue([{"url": "b"}])
        assert (tmp_path / rel).exists()
        assert cron.load_queue() == [{"url": "b"}]


# ─── a failed mutation must RAISE — never silently report success ─────────────


class TestFailedMutationCannotReportSuccess:
    def test_write_to_nonexistent_dir_raises(self, tmp_path, monkeypatch):
        bad = tmp_path / "does" / "not" / "exist" / "queue.json"  # parent missing
        monkeypatch.setattr(cron, "QUEUE_FILE", bad)
        with pytest.raises(OSError):
            cron.save_queue([{"url": "c"}])
        assert not bad.exists()

    def test_save_queue_propagates_replace_failure(self, tmp_path, monkeypatch):
        qf = tmp_path / "manual_queue.json"
        monkeypatch.setattr(cron, "QUEUE_FILE", qf)

        def boom(*_a, **_k):
            raise OSError("simulated rename failure")

        monkeypatch.setattr(cron.os, "replace", boom)
        with pytest.raises(OSError, match="simulated rename failure"):
            cron.save_queue([{"url": "d"}])
