"""Tests for FBD routine parsing (issue #2088)."""

from pathlib import Path

import pytest

from mira_plc_parser.parsers.rockwell_l5x import parse

FIXTURE = Path(__file__).parent / "fixtures" / "fbd_routine.L5X"


@pytest.fixture(scope="module")
def project():
    with open(FIXTURE) as f:
        return parse(f.read(), str(FIXTURE))


def test_fbd_routine_type(project):
    """MainRoutine should be parsed as type FBD."""
    prog = project.controllers[0].programs[0]
    main = next(r for r in prog.routines if r.name == "MainRoutine")
    assert main.type == "FBD"


def test_fbd_blocks_become_rungs(project):
    """Four FBD blocks (3 on sheet 1, 1 on sheet 2) produce 4 synthetic rungs."""
    prog = project.controllers[0].programs[0]
    main = next(r for r in prog.routines if r.name == "MainRoutine")
    assert len(main.rungs) == 4


def test_fbd_rung_numbers(project):
    """Sheet 1 blocks get numbers 1000-1002; sheet 2 block gets 2000."""
    prog = project.controllers[0].programs[0]
    main = next(r for r in prog.routines if r.name == "MainRoutine")
    numbers = sorted(r.number for r in main.rungs)
    assert numbers == [1000, 1001, 1002, 2000]


def test_fbd_block_text_format(project):
    """Each synthetic rung text starts with 'FBD:<name>(Type=<type>)'."""
    prog = project.controllers[0].programs[0]
    main = next(r for r in prog.routines if r.name == "MainRoutine")
    and_rung = next(r for r in main.rungs if "AND1" in r.text)
    assert and_rung.text.startswith("FBD:AND1(Type=AND)")


def test_fbd_input_refs_extracted(project):
    """Connected input pins with simple tag names appear in refs."""
    prog = project.controllers[0].programs[0]
    main = next(r for r in prog.routines if r.name == "MainRoutine")
    and_rung = next(r for r in main.rungs if "AND1" in r.text)
    assert "RunCmd" in and_rung.refs
    assert "StopCmd" in and_rung.refs


def test_fbd_output_extracted(project):
    """Connected output pin expression 'MotorOutput' is in outputs."""
    prog = project.controllers[0].programs[0]
    main = next(r for r in prog.routines if r.name == "MainRoutine")
    and_rung = next(r for r in main.rungs if "AND1" in r.text)
    assert "MotorOutput" in and_rung.outputs


def test_fbd_instruction_mnemonic(project):
    """Block Type becomes the instruction mnemonic."""
    prog = project.controllers[0].programs[0]
    main = next(r for r in prog.routines if r.name == "MainRoutine")
    and_rung = next(r for r in main.rungs if "AND1" in r.text)
    assert "AND" in and_rung.instructions


def test_rll_sibling_routine_unaffected(project):
    """FaultHandler RLL routine still parses its rungs correctly."""
    prog = project.controllers[0].programs[0]
    fault = next(r for r in prog.routines if r.name == "FaultHandler")
    assert fault.type == "RLL"
    assert len(fault.rungs) == 1
    assert "FaultStatus" in fault.rungs[0].refs


def test_fbd_all_tags_accessible(project):
    """Program tags defined alongside FBD routines are in all_tags()."""
    tag_names = {t.name for t in project.all_tags()}
    assert "RunCmd" in tag_names
    assert "MotorOutput" in tag_names


def test_fbd_analyze_counts(project):
    """analyze() reports correct rung count including FBD synthetic rungs."""
    from mira_plc_parser.analyze import analyze

    report = analyze(project)
    # 4 FBD synthetic rungs + 1 RLL rung = 5
    assert report.counts["rungs"] >= 5
