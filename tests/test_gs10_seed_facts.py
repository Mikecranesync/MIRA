"""The GS10 KB seeds must agree with the bench-verified GS10 device profile.

#4031: tools/seeds/gs10-vfd-knowledge.sql and demo-conveyor-001.sql shipped a
register map and serial settings from a different drive family (fault code at
0x2200, speed at 0x2000 in 0.01 Hz, 19200 8E1). MIRA cited them live, so a
technician was told to write the speed setpoint to the run/stop register.
device-profiles/gs10.yaml (sourced from plc/GS10_Integration_Guide.md and the
Micro820 program) is the reference; these tests fail if a seed drifts from it.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
PROFILE = yaml.safe_load((ROOT / "device-profiles" / "gs10.yaml").read_text())
SEEDS = [ROOT / "tools/seeds/gs10-vfd-knowledge.sql", ROOT / "tools/seeds/demo-conveyor-001.sql"]


def _reg(name: str) -> str:
    addr = next(r["addr"] for r in PROFILE["registers"] if r["name"] == name)
    return f"0x{addr:04X}"


FAULT_REG = _reg("status_monitor_1")  # low byte = error code
FREQ_REG = _reg("frequency_setpoint")
CMD_REG = _reg("control_command")


def _seed(path: Path) -> str:
    return path.read_text()


def test_profile_is_what_the_seeds_are_checked_against():
    # Preconditions: if the profile moved these, the assertions below are vacuous.
    assert (FAULT_REG, FREQ_REG, CMD_REG) == ("0x2100", "0x2001", "0x2000")
    assert PROFILE["serial_defaults"] == {"baud": 9600, "frame": "8N2", "addr": 1}


def test_metadata_register_anchors_match_the_profile():
    # Only the demo seed carries register_anchors metadata; check across both,
    # and require that some anchors exist so an emptied block cannot pass.
    text = "".join(_seed(p) for p in SEEDS)
    faults = re.findall(r"'fault_code',\s*'(0x[0-9A-Fa-f]+)'", text)
    freqs = re.findall(r"'freq_ref',\s*'(0x[0-9A-Fa-f]+)'", text)
    assert faults and all(f.upper() == FAULT_REG.upper() for f in faults), faults
    assert freqs and all(f.upper() == FREQ_REG.upper() for f in freqs), freqs


def test_serial_settings_match_the_profile():
    for path in SEEDS:
        text = _seed(path)
        bauds = [int(b) for b in re.findall(r"'baud',\s*(\d+)", text)]
        assert all(b == PROFILE["serial_defaults"]["baud"] for b in bauds), (path.name, bauds)
        assert "8-E-1" not in text and "'parity', 'Even'" not in text, path.name
        assert not re.search(r"P09\.01\s*=\s*2\b", text), path.name
        assert not re.search(r"P09\.04\s*=\s*4\b", text), path.name


def test_no_contradicted_register_facts_in_seed_text():
    for path in SEEDS:
        text = _seed(path)
        assert "0x2200" not in text, f"{path.name}: 0x2200 is not the GS10 fault register"
        assert not re.search(r"0\.01 Hz", text), f"{path.name}: GS10 frequency is Hz x 10"
        assert not re.search(r"P00\.2[01]\s*=\s*5\b", text), path.name
