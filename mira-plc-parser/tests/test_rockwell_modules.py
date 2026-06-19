"""Tests for module-only L5X export parsing (issue #2087)."""
from __future__ import annotations

import os

from mira_plc_parser.analyze import analyze
from mira_plc_parser.parsers.rockwell_l5x import parse

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "modules_only.L5X")


def _proj():
    with open(FIXTURE) as f:
        return parse(f.read(), "modules_only.L5X")


def test_modules_only_parses_without_error():
    proj = _proj()
    assert proj is not None
    assert not any("no <Controller>" in w for w in proj.warnings)


def test_modules_only_returns_three_modules():
    proj = _proj()
    assert len(proj.modules) == 3


def test_modules_only_local_module_fields():
    proj = _proj()
    local = next(m for m in proj.modules if m.name == "Local")
    assert local.catalog_number == "1769-L18ER/A"
    assert local.vendor_id == 1
    assert local.parent_module == ""
    assert local.major_revision == 32


def test_modules_only_no_controllers_or_aois():
    proj = _proj()
    assert len(proj.controllers) == 0
    assert len(proj.aoi_definitions) == 0


def test_modules_only_analyze_counts_modules():
    proj = _proj()
    rep = analyze(proj)
    assert rep.counts["modules"] == 3
