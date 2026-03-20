#!/usr/bin/env python3
"""MIRA Demo Data Seeder — populates equipment_status and faults tables for demo.

Usage:
    python demo/seed_demo_data.py
    python demo/seed_demo_data.py --db /path/to/mira.db

Idempotent: drops and recreates demo rows on each run. Safe to re-run.
Standard library only (sqlite3, pathlib, datetime, argparse).
"""

import argparse
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
DEFAULT_DB = REPO_ROOT / "mira-bridge" / "data" / "mira.db"


# ---------------------------------------------------------------------------
# Schema helpers
# ---------------------------------------------------------------------------

EQUIPMENT_STATUS_DDL = """
CREATE TABLE IF NOT EXISTS equipment_status (
    equipment_id   TEXT PRIMARY KEY,
    name           TEXT,
    type           TEXT,
    status         TEXT,
    speed_rpm      REAL,
    temperature_c  REAL,
    current_amps   REAL,
    pressure_psi   REAL,
    last_updated   DATETIME
)
"""

FAULTS_DDL = """
CREATE TABLE IF NOT EXISTS faults (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id TEXT,
    fault_code   TEXT,
    description  TEXT,
    severity     TEXT,
    timestamp    DATETIME,
    resolved     INTEGER NOT NULL DEFAULT 0,
    alerted      INTEGER NOT NULL DEFAULT 0,
    resolution   TEXT
)
"""


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

EQUIPMENT = [
    {
        "equipment_id": "CONV-001",
        "name": "Main Conveyor Line A",
        "type": "conveyor",
        "status": "faulted",
        "speed_rpm": 0.0,
        "temperature_c": 42.1,
        "current_amps": 18.7,
        "pressure_psi": None,
        "last_updated": datetime.utcnow().isoformat(sep=" ", timespec="seconds"),
    },
    {
        "equipment_id": "VFD-GS10-003",
        "name": "GS10 Variable Frequency Drive",
        "type": "vfd",
        "status": "running",
        "speed_rpm": 1742.0,
        "temperature_c": 38.4,
        "current_amps": 14.2,
        "pressure_psi": None,
        "last_updated": datetime.utcnow().isoformat(sep=" ", timespec="seconds"),
    },
    {
        "equipment_id": "MTR-STRT-007",
        "name": "Motor Starter Panel 7",
        "type": "motor_starter",
        "status": "running",
        "speed_rpm": None,
        "temperature_c": 31.0,
        "current_amps": 9.8,
        "pressure_psi": None,
        "last_updated": datetime.utcnow().isoformat(sep=" ", timespec="seconds"),
    },
]

# Active faults (resolved=0)
_NOW = datetime.utcnow()

ACTIVE_FAULTS = [
    {
        "equipment_id": "CONV-001",
        "fault_code": "OC1",
        "description": "Overcurrent fault on drive — motor drawing 125% FLA",
        "severity": "critical",
        "timestamp": (_NOW - timedelta(minutes=8)).isoformat(sep=" ", timespec="seconds"),
        "resolved": 0,
        "alerted": 0,
        "resolution": None,
    },
    {
        "equipment_id": "CONV-001",
        "fault_code": "THERM-OL",
        "description": "Thermal overload relay tripped — ambient temp 42°C",
        "severity": "warning",
        "timestamp": (_NOW - timedelta(minutes=6)).isoformat(sep=" ", timespec="seconds"),
        "resolved": 0,
        "alerted": 0,
        "resolution": None,
    },
    {
        "equipment_id": "VFD-GS10-003",
        "fault_code": "PH-IMB",
        "description": "Phase imbalance detected — L2 voltage 3% low",
        "severity": "warning",
        "timestamp": (_NOW - timedelta(hours=1, minutes=14)).isoformat(sep=" ", timespec="seconds"),
        "resolved": 0,
        "alerted": 0,
        "resolution": None,
    },
    {
        "equipment_id": "MTR-STRT-007",
        "fault_code": "COMM-LOSS",
        "description": "Communication timeout — Modbus RTU no response 5 consecutive polls",
        "severity": "warning",
        "timestamp": (_NOW - timedelta(hours=2, minutes=33)).isoformat(sep=" ", timespec="seconds"),
        "resolved": 0,
        "alerted": 0,
        "resolution": None,
    },
    {
        "equipment_id": "CONV-001",
        "fault_code": "ENC-DFT",
        "description": "Encoder drift — speed feedback 2.3% below setpoint",
        "severity": "info",
        "timestamp": (_NOW - timedelta(minutes=22)).isoformat(sep=" ", timespec="seconds"),
        "resolved": 0,
        "alerted": 0,
        "resolution": None,
    },
]

# Historical resolved faults spread over the past 30 days
_HISTORICAL = [
    # (equipment_id, fault_code, description, severity, days_ago, resolution)
    ("CONV-001", "OC1",
     "Overcurrent fault — load jam cleared after belt tensioner adjustment",
     "critical", 2,
     "Adjusted belt tensioner to factory spec; reset drive. Motor amps returned to 11.2A FLA."),
    ("VFD-GS10-003", "OVERVOLT",
     "DC bus overvoltage — regen energy spike during decel",
     "warning", 5,
     "Increased deceleration ramp time from 2s to 5s. No recurrence after adjustment."),
    ("CONV-001", "THERM-OL",
     "Thermal overload trip — cooling fan blocked by debris",
     "warning", 7,
     "Cleared debris from motor cooling fan intake. Thermal reading normalized to 34°C."),
    ("MTR-STRT-007", "COMM-LOSS",
     "Modbus RTU communication loss — loose RS-485 terminal screw",
     "warning", 9,
     "Re-torqued RS-485 B- terminal at TB3 position 6. Communication restored, all polls responding."),
    ("VFD-GS10-003", "PH-IMB",
     "Phase imbalance — utility supply issue during peak demand",
     "warning", 12,
     "Utility grid event confirmed with power company. Phase balance restored without intervention."),
    ("CONV-001", "ENC-DFT",
     "Encoder drift — encoder cable shielding degraded",
     "info", 14,
     "Replaced encoder cable with shielded Belden 9841. Speed feedback within 0.1% of setpoint."),
    ("MTR-STRT-007", "OL-TRIP",
     "Overload trip on Motor Starter 7 — belt conveyor jam",
     "critical", 17,
     "Cleared jammed product from head pulley. Checked belt tracking — adjusted idler. Reset starter."),
    ("VFD-GS10-003", "UNDER-VOLT",
     "Undervoltage fault — input contactor dropped during panel maintenance",
     "warning", 20,
     "Input contactor re-energized following scheduled maintenance completion. Drive auto-reset."),
    ("CONV-001", "GND-FLT",
     "Ground fault detected — degraded motor winding insulation",
     "critical", 24,
     "Motor winding insulation resistance 2.1 MΩ (min 5 MΩ). Motor rewound by certified shop."),
    ("MTR-STRT-007", "PHASE-LOSS",
     "Phase loss on Motor Starter 7 — blown control fuse",
     "critical", 28,
     "Replaced 5A control fuse F7 (blown due to contactor coil short). Verified phase balance L1/L2/L3."),
]


def _build_historical_faults(historical: list) -> list[dict]:
    rows = []
    for equipment_id, fault_code, description, severity, days_ago, resolution in historical:
        detected = _NOW - timedelta(days=days_ago, hours=3)
        resolved_at = detected + timedelta(hours=4, minutes=17)
        rows.append({
            "equipment_id": equipment_id,
            "fault_code": fault_code,
            "description": description,
            "severity": severity,
            "timestamp": detected.isoformat(sep=" ", timespec="seconds"),
            "resolved": 1,
            "alerted": 1,
            "resolution": resolution,
        })
    return rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def seed(db_path: Path) -> None:
    print(f"Seeding demo data into: {db_path}")

    if not db_path.parent.exists():
        db_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"  Created directory: {db_path.parent}")

    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")

    # Create tables if they don't exist
    conn.execute(EQUIPMENT_STATUS_DDL)
    conn.execute(FAULTS_DDL)
    conn.commit()
    print("  Tables verified (created if missing).")

    # --- Equipment ---
    conn.execute(
        "DELETE FROM equipment_status WHERE equipment_id IN (?, ?, ?)",
        ("CONV-001", "VFD-GS10-003", "MTR-STRT-007"),
    )
    for eq in EQUIPMENT:
        conn.execute(
            """
            INSERT INTO equipment_status
                (equipment_id, name, type, status, speed_rpm, temperature_c,
                 current_amps, pressure_psi, last_updated)
            VALUES (:equipment_id, :name, :type, :status, :speed_rpm, :temperature_c,
                    :current_amps, :pressure_psi, :last_updated)
            """,
            eq,
        )
    conn.commit()
    print(f"  Seeded {len(EQUIPMENT)} equipment records.")

    # --- Faults (demo equipment only) ---
    conn.execute(
        "DELETE FROM faults WHERE equipment_id IN (?, ?, ?)",
        ("CONV-001", "VFD-GS10-003", "MTR-STRT-007"),
    )
    all_faults = ACTIVE_FAULTS + _build_historical_faults(_HISTORICAL)
    for fault in all_faults:
        conn.execute(
            """
            INSERT INTO faults
                (equipment_id, fault_code, description, severity,
                 timestamp, resolved, alerted, resolution)
            VALUES (:equipment_id, :fault_code, :description, :severity,
                    :timestamp, :resolved, :alerted, :resolution)
            """,
            fault,
        )
    conn.commit()

    active_count = sum(1 for f in all_faults if f["resolved"] == 0)
    resolved_count = sum(1 for f in all_faults if f["resolved"] == 1)
    print(f"  Seeded {active_count} active faults, {resolved_count} resolved faults.")

    conn.close()
    print("Done. Demo data ready.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed MIRA demo equipment and fault data")
    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB),
        help=f"Path to SQLite database (default: {DEFAULT_DB})",
    )
    args = parser.parse_args()
    seed(Path(args.db))


if __name__ == "__main__":
    main()
