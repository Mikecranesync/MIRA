#!/usr/bin/env python3
"""
Populate MIRA_PLC CCW project with all global variables.

Copies the CCW system database (which contains type definitions, function
block definitions, and I/O configuration), then replaces all user variables
with the correct MIRA v3.1 variable set.

This means you open CCW -> compile -> download. No manual variable entry.

Usage:
    python plc/populate_variables.py
"""

import shutil
import uuid
import pyodbc
from pathlib import Path

COSMOS_DB = Path(r"C:\Users\hharp\Documents\CCW\Cosmos_Demo_v1.0\Controller\Controller\PrjLibrary.accdb")
MIRA_DB = Path(r"C:\Users\hharp\Documents\CCW\MIRA_PLC\Controller\Controller\PrjLibrary.accdb")

# === Type IDs (from CCW's Definition type + POUs tables) ===
T_BOOL = 1
T_DINT = 3
T_INT = 8
T_TON = 9                # POUs RefPOUs for TON function block
T_MODBUSLOCADDR = 22     # Array type for Modbus local address buffers
T_MODBUSLOCPARA = 32     # Struct: MSG_MODBUS_LOCAL
T_MODBUSTARPARA = 33     # Struct: MSG_MODBUS_TARGET
T_MSG_MODBUS = 122       # POUs RefPOUs for MSG_MODBUS function block

# VarInstance types
VI_SINGLE = 1            # Simple variable or struct
VI_FB_INSTANCE = 2       # Function block instance (TON, MSG)

# === MIRA v3.1 Variable Definitions ===
# Format: (name, var_instance, def_type, initial_value)
MIRA_VARIABLES = [
    # --- BOOLs ---
    ("motor_running",       VI_SINGLE, T_BOOL, "FALSE"),
    ("motor_stopped",       VI_SINGLE, T_BOOL, "FALSE"),
    ("conveyor_running",    VI_SINGLE, T_BOOL, "FALSE"),
    ("fault_alarm",         VI_SINGLE, T_BOOL, "FALSE"),
    ("sensor_1_active",     VI_SINGLE, T_BOOL, "FALSE"),
    ("sensor_2_active",     VI_SINGLE, T_BOOL, "FALSE"),
    ("e_stop_active",       VI_SINGLE, T_BOOL, "FALSE"),
    ("button_rising",       VI_SINGLE, T_BOOL, "FALSE"),
    ("SensorEnd_Prev",      VI_SINGLE, T_BOOL, "FALSE"),
    ("ALL_LEDS_ON",         VI_SINGLE, T_BOOL, "FALSE"),
    ("vfd_comm_ok",         VI_SINGLE, T_BOOL, "FALSE"),
    ("vfd_comm_err",        VI_SINGLE, T_BOOL, "FALSE"),
    ("vfd_msg_done",        VI_SINGLE, T_BOOL, "FALSE"),
    ("vfd_write_trig",      VI_SINGLE, T_BOOL, "FALSE"),
    ("dir_fwd",             VI_SINGLE, T_BOOL, "FALSE"),
    ("dir_rev",             VI_SINGLE, T_BOOL, "FALSE"),
    ("dir_off",             VI_SINGLE, T_BOOL, "FALSE"),
    ("dir_fault",           VI_SINGLE, T_BOOL, "FALSE"),
    ("estop_wiring_fault",  VI_SINGLE, T_BOOL, "FALSE"),
    ("prev_button",         VI_SINGLE, T_BOOL, "FALSE"),
    ("vfd_poll_active",     VI_SINGLE, T_BOOL, "FALSE"),
    ("system_ready",        VI_SINGLE, T_BOOL, "FALSE"),
    ("heartbeat",           VI_SINGLE, T_BOOL, "FALSE"),

    # --- INTs ---
    ("motor_speed",         VI_SINGLE, T_INT, "0"),
    ("motor_current",       VI_SINGLE, T_INT, "0"),
    ("temperature",         VI_SINGLE, T_INT, "0"),
    ("pressure",            VI_SINGLE, T_INT, "0"),
    ("conveyor_speed",      VI_SINGLE, T_INT, "0"),
    ("error_code",          VI_SINGLE, T_INT, "0"),
    ("vfd_frequency",       VI_SINGLE, T_INT, "0"),
    ("vfd_current",         VI_SINGLE, T_INT, "0"),
    ("vfd_dc_bus",          VI_SINGLE, T_INT, "0"),
    ("vfd_voltage",         VI_SINGLE, T_INT, "0"),
    ("vfd_fault_code",      VI_SINGLE, T_INT, "0"),
    ("conv_state",          VI_SINGLE, T_INT, "0"),
    ("cycle_count",         VI_SINGLE, T_INT, "0"),
    ("uptime_seconds",      VI_SINGLE, T_INT, "0"),
    ("item_count",          VI_SINGLE, T_INT, "0"),
    ("conveyor_speed_cmd",  VI_SINGLE, T_INT, "0"),
    ("vfd_poll_step",       VI_SINGLE, T_INT, "0"),
    ("vfd_freq_setpoint",   VI_SINGLE, T_INT, "0"),
    ("vfd_cmd_word",        VI_SINGLE, T_INT, "5"),

    # --- TON timers (function block instances) ---
    ("start_timer",         VI_FB_INSTANCE, T_TON, None),
    ("stop_timer",          VI_FB_INSTANCE, T_TON, None),
    ("uptime_timer",        VI_FB_INSTANCE, T_TON, None),
    ("vfd_err_timer",       VI_FB_INSTANCE, T_TON, None),
    ("vfd_poll_timer",      VI_FB_INSTANCE, T_TON, None),

    # --- MSG_MODBUS instances (function block instances) ---
    ("mb_read_status",      VI_FB_INSTANCE, T_MSG_MODBUS, None),
    ("mb_write_cmd",        VI_FB_INSTANCE, T_MSG_MODBUS, None),
    ("mb_write_freq",       VI_FB_INSTANCE, T_MSG_MODBUS, None),

    # --- MSG_MODBUS_LOCAL config structs ---
    ("read_local_cfg",      VI_SINGLE, T_MODBUSLOCPARA, None),
    ("write_cmd_local_cfg", VI_SINGLE, T_MODBUSLOCPARA, None),
    ("write_freq_local_cfg",VI_SINGLE, T_MODBUSLOCPARA, None),

    # --- MSG_MODBUS_TARGET config structs ---
    ("read_target_cfg",     VI_SINGLE, T_MODBUSTARPARA, None),
    ("write_cmd_target_cfg",VI_SINGLE, T_MODBUSTARPARA, None),
    ("write_freq_target_cfg",VI_SINGLE, T_MODBUSTARPARA, None),

    # --- Modbus data arrays (MODBUSLOCADDR = INT[1..125]) ---
    ("read_data",           VI_SINGLE, T_MODBUSLOCADDR, None),
    ("write_cmd_data",      VI_SINGLE, T_MODBUSLOCADDR, None),
    ("write_freq_data",     VI_SINGLE, T_MODBUSLOCADDR, None),
]


def main():
    if not COSMOS_DB.exists():
        print(f"ERROR: Cosmos DB not found at {COSMOS_DB}")
        return

    if not MIRA_DB.parent.exists():
        print(f"ERROR: MIRA_PLC project not found. Run create_mira_plc.py first.")
        return

    # Step 1: Copy the database (contains all CCW system tables)
    print(f"Copying CCW system database...")
    shutil.copy2(COSMOS_DB, MIRA_DB)
    print(f"  {COSMOS_DB.name} -> {MIRA_DB}")

    # Step 2: Connect and clean out Cosmos user variables
    conn_str = (
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
        f"DBQ={MIRA_DB};"
    )
    conn = pyodbc.connect(conn_str)
    cursor = conn.cursor()

    # Count existing user variables
    cursor.execute(
        "SELECT COUNT(*) FROM Symbols "
        "WHERE Name NOT LIKE '__SYSVA%' AND Name NOT LIKE '_IO_EM%'"
    )
    old_count = cursor.fetchone()[0]
    print(f"  Removing {old_count} Cosmos user variables...")

    # Delete all user-defined variables (keep I/O and system vars)
    cursor.execute(
        "DELETE FROM Symbols "
        "WHERE Name NOT LIKE '__SYSVA%' AND Name NOT LIKE '_IO_EM%'"
    )
    conn.commit()

    # Step 3: Insert MIRA v3.1 variables
    print(f"  Inserting {len(MIRA_VARIABLES)} MIRA v3.1 variables...")

    insert_sql = """
        INSERT INTO Symbols (
            s_GUID, Name, RefVarInstance, RefResourcePOU, RefScope,
            RefDefType, RefDirection, RefAttribute, RefGroup,
            IsRetain, HasDimension, InitialValue, Attributes, RefResource
        ) VALUES (?, ?, ?, 1, 1, ?, 3, 3, 0, 0, 0, ?, 0, 0)
    """

    for name, var_inst, def_type, init_val in MIRA_VARIABLES:
        guid = str(uuid.uuid4()).upper()
        cursor.execute(insert_sql, (guid, name, var_inst, def_type, init_val))

    conn.commit()

    # Step 4: Update the RmcVariables file (retained variables)
    rmc_path = MIRA_DB.parent / "RmcVariables"
    rmc_vars = [
        "Controller.Micro820.Micro820.conv_state",
        "Controller.Micro820.Micro820.system_ready",
        "Controller.Micro820.Micro820.heartbeat",
        "Controller.Micro820.Micro820.cycle_count",
        "Controller.Micro820.Micro820.uptime_seconds",
        "Controller.Micro820.Micro820.vfd_fault_code",
        "Controller.Micro820.Micro820.start_timer",
        "Controller.Micro820.Micro820.stop_timer",
        "Controller.Micro820.Micro820.uptime_timer",
        "Controller.Micro820.Micro820.vfd_err_timer",
        "Controller.Micro820.Micro820.conveyor_speed_cmd",
        "Controller.Micro820.Micro820.item_count",
        "Controller.Micro820.Micro820.e_stop_active",
        "Controller.Micro820.Micro820.SensorEnd_Prev",
        "Controller.Micro820.Micro820.button_rising",
        "Controller.Micro820.Micro820.dir_fwd",
        "Controller.Micro820.Micro820.dir_rev",
        "Controller.Micro820.Micro820.dir_off",
        "Controller.Micro820.Micro820.vfd_poll_timer",
    ]
    rmc_path.write_text("\n".join(rmc_vars) + "\n", encoding="utf-8")
    print(f"  Updated RmcVariables with {len(rmc_vars)} entries")

    # Verify
    cursor.execute(
        "SELECT COUNT(*) FROM Symbols "
        "WHERE Name NOT LIKE '__SYSVA%' AND Name NOT LIKE '_IO_EM%'"
    )
    new_count = cursor.fetchone()[0]
    print(f"\n  Verification: {new_count} user variables in database")

    cursor.execute(
        "SELECT Name, RefDefType FROM Symbols "
        "WHERE Name NOT LIKE '__SYSVA%' AND Name NOT LIKE '_IO_EM%' "
        "ORDER BY Name"
    )
    type_names = {
        1: "BOOL", 3: "DINT", 8: "INT", 9: "TON", 22: "INT[1..125]",
        32: "MSG_MODBUS_LOCAL", 33: "MSG_MODBUS_TARGET", 122: "MSG_MODBUS",
    }
    for row in cursor.fetchall():
        tname = type_names.get(row[1], f"type_{row[1]}")
        print(f"    {row[0]:30s} {tname}")

    conn.close()

    print()
    print("=" * 55)
    print("Variables populated successfully!")
    print("=" * 55)
    print()
    print("Open CCW -> MIRA_PLC.ccwsln")
    print("All 56 variables are pre-loaded.")
    print("Ctrl+Shift+B to compile -> Go Online -> Download")
    print()


if __name__ == "__main__":
    main()
