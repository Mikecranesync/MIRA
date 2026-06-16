#!/usr/bin/env python3
"""
Clear initial values from MIRA_PLC CCW Controller Variables.

Micro820 does not support initial values on global variables.
Any non-null InitialValue in the Symbols table causes:
  "The initial value of X is marked as invalid and may not fit its data type"

This script sets InitialValue = NULL for all user variables.

IMPORTANT: Close CCW before running this script.

Usage:
    python plc/clear_initial_values.py
"""

import pyodbc
from pathlib import Path

MIRA_DB = Path(r"C:\Users\hharp\Documents\CCW\MIRA_PLC\Controller\Controller\PrjLibrary.accdb")


def main():
    if not MIRA_DB.exists():
        print(f"ERROR: Database not found at {MIRA_DB}")
        return

    conn_str = (
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
        f"DBQ={MIRA_DB};"
    )
    conn = pyodbc.connect(conn_str)
    cursor = conn.cursor()

    # Find all user variables with non-null initial values
    cursor.execute(
        "SELECT Name, InitialValue FROM Symbols "
        "WHERE InitialValue IS NOT NULL "
        "AND Name NOT LIKE '__SYSVA%' "
        "AND Name NOT LIKE '__PHY%' "
        "AND Name NOT LIKE '_REG_%' "
        "AND Name NOT LIKE '__FBL%' "
        "AND Name NOT LIKE '__STRING%' "
        "AND Name NOT LIKE 'TRUE' "
        "AND Name NOT LIKE 'FALSE' "
        "ORDER BY Name"
    )
    rows = cursor.fetchall()

    if not rows:
        print("No user variables with initial values found. Already clean.")
        conn.close()
        return

    print(f"Found {len(rows)} variables with initial values:")
    for name, val in rows:
        print(f"  {name:30s} InitialValue = {val!r}")

    # Clear all initial values
    cursor.execute(
        "UPDATE Symbols SET InitialValue = NULL "
        "WHERE InitialValue IS NOT NULL "
        "AND Name NOT LIKE '__SYSVA%' "
        "AND Name NOT LIKE '__PHY%' "
        "AND Name NOT LIKE '_REG_%' "
        "AND Name NOT LIKE '__FBL%' "
        "AND Name NOT LIKE '__STRING%' "
        "AND Name NOT LIKE 'TRUE' "
        "AND Name NOT LIKE 'FALSE' "
    )
    affected = cursor.rowcount
    conn.commit()

    # Verify
    cursor.execute(
        "SELECT COUNT(*) FROM Symbols "
        "WHERE InitialValue IS NOT NULL "
        "AND Name NOT LIKE '__SYSVA%' "
        "AND Name NOT LIKE '__PHY%' "
        "AND Name NOT LIKE '_REG_%' "
        "AND Name NOT LIKE '__FBL%' "
        "AND Name NOT LIKE '__STRING%' "
        "AND Name NOT LIKE 'TRUE' "
        "AND Name NOT LIKE 'FALSE' "
    )
    remaining = cursor.fetchone()[0]

    conn.close()

    print(f"\nCleared InitialValue on {affected} variables.")
    print(f"Remaining user variables with initial values: {remaining}")
    print()
    print("Now open CCW -> MIRA_PLC -> Ctrl+Shift+B")
    print("Expect: 0 errors, 0 warnings")


if __name__ == "__main__":
    main()
