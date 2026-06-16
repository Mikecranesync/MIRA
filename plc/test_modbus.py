#!/usr/bin/env python3
"""
MIRA PLC Modbus TCP verification script.

Reads all coils and holding registers from the Micro820,
prints human-readable results, and verifies heartbeat toggling.

Usage:
    python plc/test_modbus.py [PLC_IP]

Default PLC_IP: 169.254.32.93
"""

import sys
import time
from pymodbus.client import ModbusTcpClient

PLC_IP = sys.argv[1] if len(sys.argv) > 1 else "169.254.32.93"
PLC_PORT = 502

# Coil labels (address 0-19 = Modbus coils 1-20)
COIL_LABELS = [
    "C1  motor_running",
    "C2  conveyor_running",
    "C3  fault_alarm",
    "C4  vfd_comm_ok",
    "C5  system_ready",
    "C6  e_stop_active",
    "C7  dir_fwd",
    "C8  dir_rev",
    "C9  heartbeat",
    "C10 estop_wiring_fault",
    "C11 dir_fault",
    "C12 DI_00 (SelectorFWD)",
    "C13 DI_01 (SelectorREV)",
    "C14 DI_02 (EStopNC)",
    "C15 DI_03 (EStopNO)",
    "C16 DI_04 (PBRun)",
    "C17 DO_00 (LightGreen)",
    "C18 DO_01 (LightRed)",
    "C19 DO_02 (ContactorQ1)",
    "C20 DO_03 (PBRunLED)",
]

# Register labels (address 100-115 = Modbus HR 400101-400116)
REG_LABELS = [
    ("HR400101 motor_speed", None),
    ("HR400102 motor_current", None),
    ("HR400103 temperature", None),
    ("HR400104 pressure", None),
    ("HR400105 conveyor_speed", None),
    ("HR400106 error_code", None),
    ("HR400107 vfd_frequency", "/10 Hz"),
    ("HR400108 vfd_current", "/10 A"),
    ("HR400109 vfd_voltage", "/10 V"),
    ("HR400110 vfd_dc_bus", "/10 V"),
    ("HR400111 item_count", None),
    ("HR400112 uptime_seconds", "sec"),
    ("HR400113 conveyor_speed_cmd", None),
    ("HR400114 conv_state", "0=idle 1=starting 2=run 3=stop 4=fault"),
    ("HR400115 vfd_cmd_word", "1=fwd 2=rev 5=stop"),
    ("HR400116 vfd_freq_setpoint", "/10 Hz"),
]

STATE_NAMES = {0: "IDLE", 1: "STARTING", 2: "RUNNING", 3: "STOPPING", 4: "FAULT"}
ERROR_NAMES = {0: "none", 6: "e-stop", 7: "wiring fault", 8: "dir fault", 9: "vfd comm"}


def read_all(client):
    """Read all coils and registers, return (coils, registers) or raise."""
    coils_result = client.read_coils(address=0, count=20)
    if coils_result.isError():
        raise RuntimeError(f"Coil read failed: {coils_result}")

    regs_result = client.read_holding_registers(address=100, count=16)
    if regs_result.isError():
        raise RuntimeError(f"Register read failed: {regs_result}")

    return coils_result.bits[:20], regs_result.registers


def print_results(coils, regs, label=""):
    """Pretty-print coil and register values."""
    if label:
        print(f"\n{'=' * 55}")
        print(f"  {label}")
        print(f"{'=' * 55}")

    print("\n  COILS (booleans):")
    print(f"  {'-' * 45}")
    for i, lbl in enumerate(COIL_LABELS):
        val = coils[i]
        marker = "[ON]" if val else "[  ]"
        print(f"  {marker} {lbl:35s} = {val}")

    print(f"\n  HOLDING REGISTERS (integers):")
    print(f"  {'-' * 45}")
    for i, (lbl, scale) in enumerate(REG_LABELS):
        val = regs[i]
        extra = ""
        if "conv_state" in lbl and val in STATE_NAMES:
            extra = f"  ({STATE_NAMES[val]})"
        elif "error_code" in lbl and val in ERROR_NAMES:
            extra = f"  ({ERROR_NAMES[val]})"
        elif scale and scale.startswith("/10"):
            unit = scale.split()[-1] if len(scale.split()) > 1 else ""
            extra = f"  ({val / 10:.1f} {unit})"
        print(f"  {lbl:42s} = {val:5d}{extra}")


def main():
    print(f"Connecting to Micro820 at {PLC_IP}:{PLC_PORT}...")
    client = ModbusTcpClient(PLC_IP, port=PLC_PORT, timeout=5)

    if not client.connect():
        print(f"FAILED to connect to {PLC_IP}:{PLC_PORT}")
        print("Is the PLC powered on and Modbus TCP server configured?")
        sys.exit(1)

    print("Connected!")

    try:
        # First read
        coils1, regs1 = read_all(client)
        print_results(coils1, regs1, "READ 1")

        # Wait 1.5 seconds for heartbeat to toggle
        print("\n  Waiting 1.5s for heartbeat toggle...")
        time.sleep(1.5)

        # Second read
        coils2, regs2 = read_all(client)
        print_results(coils2, regs2, "READ 2")

        # Heartbeat check (coil index 8 = C9)
        hb1 = coils1[8]
        hb2 = coils2[8]
        print(f"\n{'=' * 55}")
        if hb1 != hb2:
            print(f"  HEARTBEAT: TOGGLED ({hb1} -> {hb2}) — PLC scan is RUNNING")
        else:
            print(f"  HEARTBEAT: DID NOT TOGGLE ({hb1} -> {hb2}) — PLC may be STOPPED")
        print(f"{'=' * 55}")

    except Exception as e:
        print(f"\nERROR: {e}")
        sys.exit(1)
    finally:
        client.close()
        print("\nConnection closed.")


if __name__ == "__main__":
    main()
