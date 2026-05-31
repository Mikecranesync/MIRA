# tests/yt_pipeline/test_main.py
from datetime import datetime, timedelta, timezone


def test_should_run_first_time_when_never_run():
    """_should_run() returns True when last_run_utc is None or missing."""
    from tools.yt_pipeline.main import _should_run
    assert _should_run({}) is True
    assert _should_run({"last_run_utc": None}) is True


def test_should_run_skips_when_recent():
    """_should_run() returns False when <47h have passed since last run."""
    recent = (datetime.now(timezone.utc) - timedelta(hours=10)).isoformat()
    from tools.yt_pipeline.main import _should_run
    assert _should_run({"last_run_utc": recent}) is False


def test_should_run_fires_when_old_enough():
    """_should_run() returns True when >=47h have passed since last run."""
    old = (datetime.now(timezone.utc) - timedelta(hours=50)).isoformat()
    from tools.yt_pipeline.main import _should_run
    assert _should_run({"last_run_utc": old}) is True
