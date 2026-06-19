"""Tests for AOI-only and in-controller AOI L5X parsing (issue #2086)."""
from __future__ import annotations

import os

import pytest

from mira_plc_parser.analyze import analyze
from mira_plc_parser.parsers.rockwell_l5x import parse

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "vfd_aoi.L5X")


@pytest.fixture
def vfd_aoi_proj():
    with open(FIXTURE) as f:
        return parse(f.read(), "vfd_aoi.L5X")


def test_aoi_only_export_parsed(vfd_aoi_proj):
    assert len(vfd_aoi_proj.aoi_definitions) == 1
    aoi = vfd_aoi_proj.aoi_definitions[0]
    assert aoi.name == "VFD_Control"
    assert aoi.revision == "1.2"
    assert len(aoi.parameters) == 5
    assert len(aoi.local_tags) == 2
    assert len(aoi.routines) == 1


def test_aoi_parameters_in_all_tags(vfd_aoi_proj):
    tags = vfd_aoi_proj.all_tags()
    names = {t.name for t in tags}
    assert "RunCmd" in names
    assert "FaultCode" in names
    assert "FreqCmd" in names
    assert "Ramp_Timer" in names


def test_aoi_parameter_scope(vfd_aoi_proj):
    params = {t.name: t for t in vfd_aoi_proj.aoi_definitions[0].parameters}
    assert params["RunCmd"].scope == "aoi_parameter"
    assert params["RunCmd"].external_access == "Input"
    assert params["FaultCode"].external_access == "Output"
    assert params["FreqCmd"].external_access == "InOut"


def test_aoi_local_tag_scope(vfd_aoi_proj):
    ltags = {t.name: t for t in vfd_aoi_proj.aoi_definitions[0].local_tags}
    assert "Ramp_Timer" in ltags
    assert ltags["Ramp_Timer"].scope == "aoi_local"


def test_aoi_fault_candidate_detected(vfd_aoi_proj):
    rep = analyze(vfd_aoi_proj)
    fault_names = {f.name for f in rep.fault_candidates}
    assert "FaultCode" in fault_names


def test_aoi_vfd_signal_candidate_detected(vfd_aoi_proj):
    rep = analyze(vfd_aoi_proj)
    vfd_names = {f.name for f in rep.vfd_signal_candidates}
    assert "FreqCmd" in vfd_names


def test_existing_conveyor_unaffected():
    conv_path = os.path.join(os.path.dirname(__file__), "fixtures", "conveyor.L5X")
    with open(conv_path) as f:
        proj = parse(f.read(), "conveyor.L5X")
    assert len(proj.controllers) == 1
    assert len(proj.all_tags()) > 0
    assert len(proj.aoi_definitions) == 0
