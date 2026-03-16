#!/usr/bin/env python3
r"""
vfd_diag.py -- VFD Communication Diagnostic Tool
Reads ALL mapped Modbus TCP coils and holding registers from the Micro820,
displays them with correct labels, and highlights VFD comm status.

Usage:
    python plc/vfd_diag.py                         # default PLC at 169.254.32.93
    python plc/vfd_diag.py --host 192.168.1.100    # static IP after commissioning
    python plc/vfd_diag.py --once                  # single poll, no loop
"""

import argparse
import sys
import time
from datetime import datetime

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    from pymodbus.client.sync import ModbusTcpClient

# -- Modbus map matching MbSrvConf.xml -----------------------------------------

COILS = [
    (0,  "motor_running"),
    (1,  "conveyor_running"),
    (2,  "fault_alarm"),
    (3,  "vfd_comm_ok"),
    (4,  "system_ready"),
    (5,  "e_stop_active"),
    (6,  "dir_fwd"),
    (7,  "dir_rev"),
    (8,  "heartbeat"),
    (9,  "estop_wiring_fault"),
    (10, "dir_fault"),
    (11, "_IO_EM_DI_00  (SelectorFWD)"),
    (12, "_IO_EM_DI_01  (SelectorREV)"),
    (13, "_IO_EM_DI_02  (EStopNC)"),
    (14, "_IO_EM_DI_03  (EStopNO)"),
    (15, "_IO_EM_DI_04  (PBRun)"),
    (16, "_IO_EM_DO_00  (LightGreen)"),
    (17, "_IO_EM_DO_01  (LightRed)"),
    (18, "_IO_EM_DO_02  (ContactorQ1)"),
    (19, "_IO_EM_DO_03  (PBRunLED)"),
    (20, "vfd_poll_active"),
    (21, "vfd_fault_reset_pending"),
]

HOLDING_REGS = [
    (100, "motor_speed",        None),
    (101, "motor_current",      None),
    (102, "temperature",        None),
    (103, "pressure",           None),
    (104, "conveyor_speed",     None),
    (105, "error_code",         None),
    (106, "vfd_frequency",      "/10 Hz"),
    (107, "vfd_current",        "/10 A"),
    (108, "vfd_voltage",        "/10 V"),
    (109, "vfd_dc_bus",         "/10 V"),
    (110, "item_count",         None),
    (111, "uptime_seconds",     None),
    (112, "conveyor_speed_cmd", None),
    (113, "conv_state",         None),
    (114, "vfd_cmd_word",       None),
    (115, "vfd_freq_setpoint",  "/10 Hz"),
    (116, "vfd_poll_step",      None),
]

STATE_NAMES = {0: "IDLE", 1: "STARTING", 2: "RUNNING", 3: "STOPPING", 4: "FAULT"}
ERROR_NAMES = {0: "none", 6: "E-STOP", 7: "WIRING", 8: "DIR FAULT", 9: "VFD COMM"}
CMD_NAMES = {0: "NONE", 1: "STOP", 18: "FWD+RUN", 20: "REV+RUN", 7: "RESET"}

COIL_BASE = 0
COIL_COUNT = 22   # C1-C22
HR_BASE = 100
HR_COUNT = 17     # HR400101-HR400117


def read_all(client):
    """Read all coils and holding registers. Returns (coils_dict, regs_dict) or raises."""
    coils = {}
    result = client.read_coils(address=COIL_BASE, count=COIL_COUNT)
    if result.isError():
        raise RuntimeError(f"Coil read error: {result}")
    bits = list(result.bits[:COIL_COUNT])
    for addr, name in COILS:
        idx = addr - COIL_BASE
        coils[name] = bits[idx] if idx < len(bits) else None

    regs = {}
    result = client.read_holding_registers(address=HR_BASE, count=HR_COUNT)
    if result.isError():
        raise RuntimeError(f"HR read error: {result}")
    vals = list(result.registers[:HR_COUNT])
    for addr, name, scale in HOLDING_REGS:
        idx = addr - HR_BASE
        regs[name] = vals[idx] if idx < len(vals) else None

    return coils, regs


def format_bool(val):
    if val is None:
        return "???"
    return "TRUE" if val else "FALSE"


def print_report(coils, regs, host, poll_num):
    ts = datetime.now().strftime("%H:%M:%S")
    w = 78

    # Header
    print("=" * w)
    print(f"  VFD DIAGNOSTIC REPORT   {host}   Poll #{poll_num}   {ts}")
    print("=" * w)

    # VFD Communication Status (the main thing we care about)
    vfd_ok = coils.get("vfd_comm_ok", False)
    poll_active = coils.get("vfd_poll_active", None)
    poll_step = regs.get("vfd_poll_step", 0)
    fault = coils.get("fault_alarm", False)
    error = regs.get("error_code", 0)
    state = regs.get("conv_state", 0)
    state_name = STATE_NAMES.get(state, f"?{state}")
    error_name = ERROR_NAMES.get(error, f"?{error}")

    status = "OK" if vfd_ok else "** FAIL **"
    print()
    print(f"  >>> VFD COMM STATUS: {status}")
    print(f"      vfd_comm_ok       = {format_bool(vfd_ok)}")
    print(f"      vfd_poll_active   = {format_bool(poll_active)}")
    print(f"      vfd_poll_step     = {poll_step}  (should cycle 1->2->3->4->1)")
    print(f"      conv_state        = {state} ({state_name})")
    print(f"      error_code        = {error} ({error_name})")
    print(f"      fault_alarm       = {format_bool(fault)}")

    # VFD telemetry
    freq = (regs.get("vfd_frequency", 0) or 0) / 10.0
    amps = (regs.get("vfd_current", 0) or 0) / 10.0
    volts = (regs.get("vfd_voltage", 0) or 0) / 10.0
    dcbus = (regs.get("vfd_dc_bus", 0) or 0) / 10.0
    freq_sp = (regs.get("vfd_freq_setpoint", 0) or 0) / 10.0
    cmd = regs.get("vfd_cmd_word", 0)
    cmd_name = CMD_NAMES.get(cmd, f"?{cmd}")

    print()
    print("  --- VFD TELEMETRY ---")
    print(f"      vfd_frequency     = {freq:.1f} Hz")
    print(f"      vfd_current       = {amps:.1f} A")
    print(f"      vfd_voltage       = {volts:.1f} V")
    print(f"      vfd_dc_bus        = {dcbus:.1f} V")
    print(f"      vfd_freq_setpoint = {freq_sp:.1f} Hz")
    print(f"      vfd_cmd_word      = {cmd} ({cmd_name})")
    print(f"      vfd_fault_reset   = {format_bool(coils.get('vfd_fault_reset_pending', None))}")

    # System state
    uptime = regs.get("uptime_seconds", 0)
    hb = coils.get("heartbeat", False)
    print()
    print("  --- SYSTEM ---")
    print(f"      uptime_seconds    = {uptime}  ({uptime // 3600}h {(uptime % 3600) // 60}m {uptime % 60}s)")
    print(f"      heartbeat         = {format_bool(hb)}")
    print(f"      system_ready      = {format_bool(coils.get('system_ready', None))}")
    print(f"      motor_running     = {format_bool(coils.get('motor_running', None))}")
    print(f"      conveyor_running  = {format_bool(coils.get('conveyor_running', None))}")
    print(f"      motor_speed       = {regs.get('motor_speed', 0)}")
    print(f"      conveyor_speed    = {regs.get('conveyor_speed', 0)}")
    print(f"      speed_cmd         = {regs.get('conveyor_speed_cmd', 0)}")
    print(f"      item_count        = {regs.get('item_count', 0)}")

    # Safety
    print()
    print("  --- SAFETY ---")
    print(f"      e_stop_active     = {format_bool(coils.get('e_stop_active', None))}")
    print(f"      estop_wiring_fault= {format_bool(coils.get('estop_wiring_fault', None))}")
    print(f"      dir_fwd           = {format_bool(coils.get('dir_fwd', None))}")
    print(f"      dir_rev           = {format_bool(coils.get('dir_rev', None))}")
    print(f"      dir_fault         = {format_bool(coils.get('dir_fault', None))}")

    # Raw I/O
    print()
    print("  --- RAW I/O ---")
    di_names = ["SelectorFWD", "SelectorREV", "EStopNC", "EStopNO", "PBRun"]
    do_names = ["LightGreen", "LightRed", "ContactorQ1", "PBRunLED"]
    for i, name in enumerate(di_names):
        key = f"_IO_EM_DI_0{i}"
        for cname in coils:
            if cname.startswith(key):
                print(f"      DI{i} ({name:12s}) = {format_bool(coils[cname])}")
                break
    for i, name in enumerate(do_names):
        key = f"_IO_EM_DO_0{i}"
        for cname in coils:
            if cname.startswith(key):
                print(f"      DO{i} ({name:12s}) = {format_bool(coils[cname])}")
                break

    # Diagnosis hints
    print()
    print("  --- DIAGNOSIS ---")
    if not vfd_ok:
        if poll_step == 0:
            print("  !! vfd_poll_step stuck at 0 -- PLC code may not be running VFD section")
            print("     -> Verify program was DOWNLOADED (not just built) in CCW")
            print("     -> Check CCW serial port config was included in download")
        elif poll_step > 0 and not vfd_ok:
            print(f"  !! vfd_poll_step={poll_step} but vfd_comm_ok=FALSE")
            print("     -> MSG blocks are executing but VFD not responding")
            print("     -> Check RS-485 wiring (try swapping D+/D-)")
            print("     -> Verify VFD params: P09.00=1, P09.01=9.6, P09.04=13, P00.21=2")
            print("     -> Clear VFD faults: press STOP/RESET on keypad")
        if poll_active is not None and not poll_active:
            print("  !! vfd_poll_active=FALSE -- VFD polling not enabled in PLC")
        if fault:
            print(f"  !! fault_alarm=TRUE, error_code={error} ({error_name})")
            if error == 9:
                print("     -> VFD COMM error -- comm watchdog expired (5s with no response)")
        if dcbus == 0:
            print("  !! vfd_dc_bus=0 -- either VFD has no power or Modbus read never succeeded")
    else:
        print("  VFD communication OK!")
        if dcbus > 0:
            print(f"  DC Bus = {dcbus:.1f}V -- VFD powered and responding")
        if freq > 0:
            print(f"  Motor running at {freq:.1f} Hz")

    print("=" * w)
    print()


def main():
    parser = argparse.ArgumentParser(description="MIRA VFD Diagnostic Tool")
    parser.add_argument("--host", default="169.254.32.93", help="PLC IP address")
    parser.add_argument("--port", type=int, default=502, help="Modbus TCP port")
    parser.add_argument("--poll", type=float, default=2.0, help="Poll interval (seconds)")
    parser.add_argument("--once", action="store_true", help="Single poll then exit")
    args = parser.parse_args()

    print(f"Connecting to PLC at {args.host}:{args.port}...")
    client = ModbusTcpClient(args.host, port=args.port, timeout=3)
    if not client.connect():
        print(f"FAILED to connect to {args.host}:{args.port}")
        print("Check: Is PLC powered? Is Ethernet cable connected? Is IP correct?")
        sys.exit(1)
    print("Connected.\n")

    poll_num = 0
    try:
        while True:
            poll_num += 1
            try:
                coils, regs = read_all(client)
                print_report(coils, regs, args.host, poll_num)
            except Exception as e:
                print(f"  !! READ ERROR: {e}")
                print("  Reconnecting...")
                client.close()
                time.sleep(1)
                if not client.connect():
                    print(f"  Reconnect failed. Retrying in {args.poll}s...")

            if args.once:
                break
            time.sleep(args.poll)

    except KeyboardInterrupt:
        print("\nDiagnostic stopped.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
