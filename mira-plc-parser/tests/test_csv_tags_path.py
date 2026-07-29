"""tag_csv.py resolution for csv_tags parser.

Regression guard for the packaged-deployment bug: the mira-ingest image COPYs only the
`mira_plc_parser` package, so the repo-layout `parents[3]/ignition/.../tag_csv.py` path is
absent and CSV uploads 500'd with FileNotFoundError. The fix lets a deployment bundle
tag_csv.py and point `MIRA_TAG_CSV_PATH` at it.
"""
from __future__ import annotations

import importlib

import pytest

from mira_plc_parser.parsers import csv_tags


@pytest.fixture(autouse=True)
def _reset_cache(monkeypatch):
    # _load_tag_csv memoizes into a module global — clear it around every case.
    monkeypatch.setattr(csv_tags, "_tag_csv", None)
    monkeypatch.delenv("MIRA_TAG_CSV_PATH", raising=False)
    yield
    csv_tags._tag_csv = None


def test_default_repo_path_resolves():
    """With no env override, the repo-layout default points at the real tag_csv.py."""
    assert csv_tags._tag_csv_path() == csv_tags._TAG_CSV_PATH
    assert csv_tags._tag_csv_path().exists()
    mod = csv_tags._load_tag_csv()
    assert hasattr(mod, "parse")


def test_env_override_wins(monkeypatch):
    """MIRA_TAG_CSV_PATH takes precedence — the path a packaged image sets."""
    target = csv_tags._TAG_CSV_PATH  # any real, loadable copy
    monkeypatch.setenv("MIRA_TAG_CSV_PATH", str(target))
    assert csv_tags._tag_csv_path() == target
    mod = csv_tags._load_tag_csv()
    assert hasattr(mod, "parse")


def test_missing_path_raises_actionable_error(monkeypatch):
    monkeypatch.setenv("MIRA_TAG_CSV_PATH", "/nonexistent/tag_csv.py")
    with pytest.raises(FileNotFoundError, match="MIRA_TAG_CSV_PATH"):
        csv_tags._load_tag_csv()


def test_csv_parse_still_works_end_to_end():
    """The parser path the endpoint hits: parse a tiny CSV into tags."""
    proj = csv_tags.parse("Tag,Data Type\nConv_Run,BOOL\nConv_Speed,REAL\n", source_file="probe.csv")
    names = {t.name for c in proj.controllers for t in c.tags}
    assert "Conv_Run" in names and "Conv_Speed" in names


# Belt-and-suspenders: importing the module fresh must not eagerly load tag_csv.
def test_import_is_lazy():
    mod = importlib.reload(csv_tags)
    assert mod._tag_csv is None
