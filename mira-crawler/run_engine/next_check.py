"""Vendored NEXT_CHECK map — per-rule "what to check next" strings.

Source of truth: the ``NEXT_CHECK`` dict in
``plc/conv_simple_anomaly/anomaly_log.py`` (the Ask MIRA presentation layer the
Ignition panel renders). Vendored here so the machine-memory worker can attach
the same next-check guidance to persisted anomaly ``run_diff`` rows without the
worker importing from ``plc/`` (which is not shipped with mira-crawler).

Drift guard: ``tests/test_anomaly_rules_parity.py`` parses the source dict out
of anomaly_log.py (AST, no import) and asserts equality with this copy. Edit
the source without re-syncing this map and that test fails. NO rule/text
changes here — this is a copy, not a fork.
"""

from __future__ import annotations

NEXT_CHECK: dict[str, str] = {
    "A0_OFFLINE": "Check the PLC bridge / Modbus link and that the gateway is polling the device.",
    "A1_COMM_STALE": "Reseat the RS-485 wiring PLC<->GS10; confirm baud/parity; power-cycle the drive.",
    "A2_VFD_FAULT": "Read the GS10 keypad fault, clear the cause, then reset the drive (STOP+RESET).",
    "A3_ESTOP_WIRING": "Inspect the dual-channel e-stop loop for a broken/shorted wire (DI_02 vs DI_03).",
    "A4_DIRECTION_FAULT": "Check the FWD/REV selector wiring -- both directions are commanded at once.",
    "A5_ILLEGAL_RUN": "Verify the safety interlock chain; the belt should not run while not permitted.",
    "A6_DRIVE_NOT_RESPONDING": "Confirm the GS10 is in remote/RUN-enabled mode and not faulted/locked.",
    "A7_FREQ_NOT_TRACKING": "Check for mechanical drag, a current-limit, or load -- drive can't hold speed.",
    "A8_OVERCURRENT": "Inspect the belt/rollers for a jam or binding; compare current to motor FLA.",
    "A9_DC_BUS": "Check incoming supply voltage and the GS10 DC-bus (low->Lvd, high->ovd).",
    "A10_FREQ_STUCK_ZERO": "Drive commanded RUN but 0 Hz out -- check enable, fault latch, output wiring.",
    "A12_PHOTOEYE_JAM": "Clear the object blocking the infeed photo-eye (DI_05), then re-arm with Start.",
}
