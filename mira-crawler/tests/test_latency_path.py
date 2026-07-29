"""Regression: the ingest-latency default log path must be cwd-independent.

Mirrors tests/test_heartbeat.py::test_default_log_path_is_absolute_and_not_cwd_doubled.
The daemon runs with cwd = mira-crawler/ (run.sh does `cd $SCRIPT_DIR`) and does
NOT export MIRA_INGEST_LATENCY_LOG. A cwd-relative default like
"mira-crawler/data/ingest_latency.jsonl" resolves to
mira-crawler/mira-crawler/data/ingest_latency.jsonl (doubled) under that cwd —
so ingest writes latency rows to a phantom directory nobody reads. The default
MUST be absolute, resolved from the module location.
"""

from __future__ import annotations

from pathlib import Path

from metrics import latency


def test_default_log_path_is_absolute_and_not_cwd_doubled(monkeypatch, tmp_path):
    monkeypatch.delenv("MIRA_INGEST_LATENCY_LOG", raising=False)
    monkeypatch.chdir(tmp_path)
    p = latency._default_log_path()
    assert p.is_absolute()
    assert "mira-crawler/mira-crawler" not in str(p)
    assert str(tmp_path) not in str(p)
    assert (
        p
        == Path(latency.__file__).resolve().parent.parent
        / "data"
        / "ingest_latency.jsonl"
    )


def test_env_override_still_wins_over_the_absolute_default(monkeypatch, tmp_path):
    override = tmp_path / "custom" / "latency.jsonl"
    monkeypatch.setenv("MIRA_INGEST_LATENCY_LOG", str(override))
    assert latency._default_log_path() == override
