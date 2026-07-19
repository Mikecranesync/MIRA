"""Parity + drift guards for the machine-memory worker's vendored anomaly brain.

The A0-A12 rules have ONE source of truth, ``plc/conv_simple_anomaly/rules_core.py``
(pure, dual Py2.7/3.12). The machine-memory worker vendors it verbatim as
``run_engine/anomaly_rules.py`` (mira-crawler must not import from plc/), same
discipline as the Ignition gateway copy guarded by
``tests/regime7_ignition/test_diagnose_parity.py``.

Likewise the per-rule NEXT_CHECK map is vendored from
``plc/conv_simple_anomaly/anomaly_log.py`` into ``run_engine/next_check.py``;
the source dict is extracted by AST (no import — anomaly_log.py inserts sys.path
entries at import time) and compared for exact equality.

Re-sync commands are in each assertion message. NO rule changes in the copies.
"""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RULES_CORE = REPO / "plc" / "conv_simple_anomaly" / "rules_core.py"
ANOMALY_LOG = REPO / "plc" / "conv_simple_anomaly" / "anomaly_log.py"
VENDORED_RULES = REPO / "mira-crawler" / "run_engine" / "anomaly_rules.py"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _source_next_check() -> dict:
    """Extract the NEXT_CHECK dict from anomaly_log.py WITHOUT importing it."""
    tree = ast.parse(ANOMALY_LOG.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "NEXT_CHECK":
                    return ast.literal_eval(node.value)
    raise AssertionError("NEXT_CHECK dict not found in %s" % ANOMALY_LOG)


# ─── rules_core vendored copy ───────────────────────────────────────────────


def test_vendored_rules_byte_identical():
    assert VENDORED_RULES.exists(), "missing vendored copy: %s" % VENDORED_RULES
    assert _sha256(RULES_CORE) == _sha256(VENDORED_RULES), (
        "run_engine/anomaly_rules.py has drifted from rules_core.py -- re-sync with:\n"
        "  cp plc/conv_simple_anomaly/rules_core.py "
        "mira-crawler/run_engine/anomaly_rules.py"
    )


def test_vendored_rules_import_and_match_source():
    source = _load(RULES_CORE, "rules_core_src_under_test")
    vendored = _load(VENDORED_RULES, "anomaly_rules_under_test")
    assert len(vendored.RULES) == 12
    # A representative snapshot per rule must fire identically in both copies.
    goldens = [
        ({}, {"max_stale_s": 35.0}),
        ({"vfd/vfd101/comm_ok": False}, {}),
        ({"vfd/vfd101/comm_ok": True, "vfd/vfd101/fault_code": 58}, {}),
        ({"plc/di/di02_estop_nc": True, "plc/di/di03_estop_no": True}, {}),
        ({"plc/di/di00_fwd": True, "plc/di/di01_rev": True}, {}),
        ({"motor/m101/running": True, "safety/estop": True}, {}),
        (
            {"vfd/vfd101/comm_ok": True, "vfd/vfd101/cmd_word": 18,
             "motor/m101/running": False},
            {"cmd_run_for_s": 4.0},
        ),
        ({"vfd/vfd101/comm_ok": True, "vfd/vfd101/current_a": 6.0}, {}),
        ({"vfd/vfd101/comm_ok": True, "vfd/vfd101/dc_bus_v": 200.0}, {}),
        ({"safety/pe_latched": True}, {}),
    ]
    for snap, derived in goldens:
        a = [(x.rule_id, x.severity) for x in source.evaluate(snap, derived)]
        b = [(x.rule_id, x.severity) for x in vendored.evaluate(snap, derived)]
        assert a == b and a, "divergence on snap=%s: %s vs %s" % (snap, a, b)


# ─── NEXT_CHECK vendored map ────────────────────────────────────────────────


def test_next_check_map_matches_source():
    from run_engine.next_check import NEXT_CHECK

    source = _source_next_check()
    assert NEXT_CHECK == source, (
        "run_engine/next_check.py NEXT_CHECK has drifted from the source dict in "
        "plc/conv_simple_anomaly/anomaly_log.py -- re-sync the map (copy the dict "
        "verbatim)."
    )


def test_next_check_covers_every_rule():
    from run_engine.anomaly_rules import RULES, evaluate  # noqa: F401
    from run_engine.next_check import NEXT_CHECK

    # Every rule id the brain can emit has a next-check string.
    rule_ids = {
        "A0_OFFLINE", "A1_COMM_STALE", "A2_VFD_FAULT", "A3_ESTOP_WIRING",
        "A4_DIRECTION_FAULT", "A5_ILLEGAL_RUN", "A6_DRIVE_NOT_RESPONDING",
        "A7_FREQ_NOT_TRACKING", "A8_OVERCURRENT", "A9_DC_BUS",
        "A10_FREQ_STUCK_ZERO", "A12_PHOTOEYE_JAM",
    }
    assert set(NEXT_CHECK) == rule_ids
    assert len(RULES) == 12
