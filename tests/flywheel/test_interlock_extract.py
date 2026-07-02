"""Deterministic, offline tests for the PLC permissive extractor.

Proves flywheel step 1+2 (ingest source -> extract interlock context) against
the REAL bench PLC program — no DB, no LLM. See
`docs/north-star/interlock-flywheel-audit.md`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "mira-crawler"))

from ingest.plc_permissive_extract import (  # noqa: E402
    blockers_for,
    extract_permissive_edges,
)

_ST_FILE = _REPO / "plc" / "Prog_init_ConvSimple_v2.1.st"

# A self-contained ST snippet mirroring the real run-permissive chain so the
# test is hermetic even if the bench file is renamed in a future PLC rev.
_SNIPPET = """\
vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched;
motor_running := vfd_run_permit AND (dir_fwd OR dir_rev);
vfd_freq_sp := 3000;
"""


def test_extracts_permissive_chain_from_snippet():
    edges = extract_permissive_edges(_SNIPPET, "snippet.st")
    pairs = {(e.source, e.target) for e in edges}
    # run-permissive operands
    assert ("e_stop_ok", "vfd_run_permit") in pairs
    assert ("pe_latched", "vfd_run_permit") in pairs
    assert ("_IO_EM_DO_02", "vfd_run_permit") in pairs
    # downstream: permissive used in motor_running logic
    assert ("vfd_run_permit", "motor_running") in pairs
    # the pure-literal assignment carries no boolean logic -> no edges
    assert all(e.target != "vfd_freq_sp" for e in edges)


def test_negated_permissive_operand_is_a_blocker():
    edges = extract_permissive_edges(_SNIPPET, "snippet.st")
    blk = blockers_for(edges, "vfd_run_permit")
    names = {e.source for e in blk}
    # pe_latched appears under NOT in a permissive -> blocker (TRUE inhibits run)
    assert "pe_latched" in names
    # e_stop_ok is NOT negated -> not a blocker (it's a positive permit)
    assert "e_stop_ok" not in names
    pe = next(e for e in blk if e.source == "pe_latched")
    assert pe.negated is True
    # blocker-ness is encoded in the relation type so it survives the Hub route
    assert pe.relation == "causes"
    assert pe.rung_text.startswith("vfd_run_permit :=")


@pytest.mark.skipif(not _ST_FILE.exists(), reason="bench PLC program not present")
def test_extracts_from_real_bench_program():
    edges = extract_permissive_edges(_ST_FILE.read_text(), str(_ST_FILE))
    pairs = {(e.source, e.target) for e in edges}
    assert ("pe_latched", "vfd_run_permit") in pairs
    assert ("vfd_run_permit", "motor_running") in pairs
    # the blocker must carry a real rung citation pointing at the .st file
    pe = next(e for e in edges if e.source == "pe_latched" and e.target == "vfd_run_permit")
    assert pe.blocker is True
    assert pe.source_file.endswith("Prog_init_ConvSimple_v2.1.st")
    assert pe.rung_line > 0
