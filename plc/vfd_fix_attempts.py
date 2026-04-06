#!/usr/bin/env python3
"""
vfd_fix_attempts.py -- Systematic VFD comm troubleshooter
Tries 5 different fixes via Modbus TCP, logs all results.

Usage: python plc/vfd_fix_attempts.py
"""

import sys
import time
from datetime import datetime

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    from pymodbus.client.sync import ModbusTcpClient

HOST = "169.254.32.93"
PORT = 502
LOG_FILE = "plc/logs/vfd_fix_log.txt"

# Modbus addresses
COIL_BASE = 0
COIL_COUNT = 22
HR_BASE = 100
HR_COUNT = 17

# Coil indices
C_FAULT_ALARM = 2
C_VFD_COMM_OK = 3
C_VFD_POLL_ACTIVE = 20
C_VFD_FAULT_RESET = 21

# HR indices (offset from HR_BASE)
H_ERROR_CODE = 5
H_VFD_FREQ = 6
H_VFD_CURRENT = 7
H_VFD_VOLTAGE = 8
H_VFD_DC_BUS = 9
H_UPTIME = 11
H_CONV_STATE = 13
H_VFD_CMD_WORD = 14
H_VFD_FREQ_SP = 15
H_VFD_POLL_STEP = 16

# Write addresses (zero-indexed)
W_VFD_CMD = 114       # vfd_cmd_word
W_SPEED_CMD = 112     # conveyor_speed_cmd


def log(msg, f=None):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    line = f"[{ts}] {msg}"
    print(line)
    if f:
        f.write(line + "\n")
        f.flush()


def read_state(client):
    """Read all coils + holding registers, return dict."""
    state = {}
    rc = client.read_coils(address=COIL_BASE, count=COIL_COUNT)
    if rc.isError():
        return None
    bits = list(rc.bits[:COIL_COUNT])
    state["fault_alarm"] = bits[C_FAULT_ALARM]
    state["vfd_comm_ok"] = bits[C_VFD_COMM_OK]
    state["vfd_poll_active"] = bits[C_VFD_POLL_ACTIVE]
    state["vfd_fault_reset_pending"] = bits[C_VFD_FAULT_RESET]

    rr = client.read_holding_registers(address=HR_BASE, count=HR_COUNT)
    if rr.isError():
        return None
    regs = list(rr.registers[:HR_COUNT])
    state["error_code"] = regs[H_ERROR_CODE]
    state["vfd_frequency"] = regs[H_VFD_FREQ] / 10.0
    state["vfd_current"] = regs[H_VFD_CURRENT] / 10.0
    state["vfd_voltage"] = regs[H_VFD_VOLTAGE] / 10.0
    state["vfd_dc_bus"] = regs[H_VFD_DC_BUS] / 10.0
    state["uptime"] = regs[H_UPTIME]
    state["conv_state"] = regs[H_CONV_STATE]
    state["vfd_cmd_word"] = regs[H_VFD_CMD_WORD]
    state["vfd_freq_sp"] = regs[H_VFD_FREQ_SP] / 10.0
    state["vfd_poll_step"] = regs[H_VFD_POLL_STEP]
    return state


def state_summary(s):
    if s is None:
        return "READ FAILED"
    comm = "OK" if s["vfd_comm_ok"] else "FAIL"
    return (f"comm={comm} step={s['vfd_poll_step']} state={s['conv_state']} "
            f"err={s['error_code']} fault={s['fault_alarm']} "
            f"dcbus={s['vfd_dc_bus']}V freq={s['vfd_frequency']}Hz "
            f"cmd={s['vfd_cmd_word']} uptime={s['uptime']}s")


def main():
    print(f"=" * 70)
    print(f"  VFD FIX ATTEMPTS — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Target: {HOST}:{PORT}")
    print(f"  Log: {LOG_FILE}")
    print(f"=" * 70)

    client = ModbusTcpClient(HOST, port=PORT, timeout=3)
    if not client.connect():
        print(f"FAILED to connect to {HOST}:{PORT}")
        sys.exit(1)

    with open(LOG_FILE, "a") as f:
        log(f"{'=' * 60}", f)
        log(f"VFD FIX ATTEMPTS SESSION START", f)
        log(f"Target: {HOST}:{PORT}", f)
        log(f"{'=' * 60}", f)

        # --- Baseline reading ---
        log("", f)
        log("BASELINE: Reading current state...", f)
        s = read_state(client)
        log(f"  {state_summary(s)}", f)

        # ============================================================
        # FIX 1: Monitor poll_step cycling (10 reads over 5 seconds)
        #   Goal: See if poll_step advances, proving MSG blocks fire
        # ============================================================
        log("", f)
        log("FIX 1: Monitor poll_step cycling (10 reads, 0.5s apart)", f)
        log("  Goal: Verify MSG_MODBUS blocks are executing on Channel 0", f)
        steps_seen = []
        for i in range(10):
            s = read_state(client)
            if s:
                steps_seen.append(s["vfd_poll_step"])
                log(f"  Read {i+1}/10: poll_step={s['vfd_poll_step']} "
                    f"poll_active={s['vfd_poll_active']} "
                    f"comm_ok={s['vfd_comm_ok']} "
                    f"dc_bus={s['vfd_dc_bus']}V", f)
            time.sleep(0.5)
        unique_steps = set(steps_seen)
        if len(unique_steps) > 1:
            log(f"  RESULT: poll_step IS cycling: {steps_seen}", f)
            log(f"  -> MSG blocks are firing. Channel 0 appears active.", f)
        else:
            log(f"  RESULT: poll_step STUCK at {steps_seen[0] if steps_seen else '?'}", f)
            log(f"  -> MSG blocks may not be executing. Was v4.1.9 downloaded?", f)

        # ============================================================
        # FIX 2: Reset fault via coil write + observe recovery
        #   Goal: Clear fault_alarm, see if VFD comm recovers
        # ============================================================
        log("", f)
        log("FIX 2: Reset fault_alarm via Modbus TCP write", f)
        log("  Goal: Clear fault state, observe if vfd_comm_ok goes TRUE", f)
        try:
            # Write fault_alarm = FALSE
            client.write_coil(address=C_FAULT_ALARM, value=False)
            log("  Wrote fault_alarm = FALSE", f)
            # Write error_code = 0
            client.write_register(address=HR_BASE + H_ERROR_CODE, value=0)
            log("  Wrote error_code = 0", f)
            # Monitor for 5 seconds
            comm_ok_seen = False
            for i in range(10):
                time.sleep(0.5)
                s = read_state(client)
                if s:
                    log(f"  +{(i+1)*0.5:.1f}s: comm={s['vfd_comm_ok']} "
                        f"fault={s['fault_alarm']} err={s['error_code']} "
                        f"dc_bus={s['vfd_dc_bus']}V step={s['vfd_poll_step']}", f)
                    if s["vfd_comm_ok"]:
                        comm_ok_seen = True
                        log(f"  *** VFD_COMM_OK = TRUE! VFD responded! ***", f)
                        break
            if comm_ok_seen:
                log(f"  RESULT: VFD communication established!", f)
            else:
                log(f"  RESULT: fault_alarm re-latched. VFD still not responding.", f)
        except Exception as e:
            log(f"  ERROR: {e}", f)

        # ============================================================
        # FIX 3: Trigger VFD fault reset (write vfd_fault_reset_pending)
        #   Goal: Send reset command to VFD in case it has latched F30
        # ============================================================
        log("", f)
        log("FIX 3: Trigger VFD fault reset via vfd_fault_reset_pending", f)
        log("  Goal: Clear latched VFD fault (F30 comm error)", f)
        try:
            client.write_coil(address=C_VFD_FAULT_RESET, value=True)
            log("  Wrote vfd_fault_reset_pending = TRUE", f)
            time.sleep(3)
            s = read_state(client)
            if s:
                log(f"  After 3s: comm={s['vfd_comm_ok']} "
                    f"reset_pending={s['vfd_fault_reset_pending']} "
                    f"dc_bus={s['vfd_dc_bus']}V step={s['vfd_poll_step']}", f)
                if s["vfd_fault_reset_pending"]:
                    log(f"  Note: reset_pending still TRUE -- MSG step 4 may not have fired yet", f)
                else:
                    log(f"  reset_pending cleared -- fault reset MSG was sent to VFD", f)
            if s and s["vfd_comm_ok"]:
                log(f"  RESULT: VFD comm recovered after fault reset!", f)
            else:
                log(f"  RESULT: VFD still not responding after fault reset.", f)
        except Exception as e:
            log(f"  ERROR: {e}", f)

        # ============================================================
        # FIX 4: Write cmd_word=0 to stop writes, test READ-only
        #   Goal: Maybe VFD rejects write commands and that blocks reads
        # ============================================================
        log("", f)
        log("FIX 4: Set vfd_cmd_word=0 (no command), test read-only", f)
        log("  Goal: See if VFD responds to FC03 READ when not being written to", f)
        try:
            client.write_register(address=W_VFD_CMD, value=0)
            log("  Wrote vfd_cmd_word = 0", f)
            # Also reset fault
            client.write_coil(address=C_FAULT_ALARM, value=False)
            client.write_register(address=HR_BASE + H_ERROR_CODE, value=0)
            log("  Cleared fault_alarm + error_code", f)
            for i in range(8):
                time.sleep(1)
                s = read_state(client)
                if s:
                    log(f"  +{i+1}s: comm={s['vfd_comm_ok']} cmd={s['vfd_cmd_word']} "
                        f"dc_bus={s['vfd_dc_bus']}V step={s['vfd_poll_step']}", f)
                    if s["vfd_comm_ok"]:
                        log(f"  *** VFD RESPONDED to read! ***", f)
                        break
            # Restore cmd_word to STOP
            client.write_register(address=W_VFD_CMD, value=1)
            log("  Restored vfd_cmd_word = 1 (STOP)", f)
            s = read_state(client)
            if s and s["vfd_comm_ok"]:
                log(f"  RESULT: VFD comm works with read-only! Write cmds may be issue.", f)
            elif s:
                log(f"  RESULT: VFD still not responding even with no writes.", f)
        except Exception as e:
            log(f"  ERROR: {e}", f)

        # ============================================================
        # FIX 5: Extended rapid monitoring (20s) — catch any transient
        #   Goal: Watch for ANY non-zero VFD telemetry over longer window
        # ============================================================
        log("", f)
        log("FIX 5: Extended rapid monitoring (20s, 4Hz)", f)
        log("  Goal: Catch any transient VFD response over longer window", f)
        # Reset fault one more time
        try:
            client.write_coil(address=C_FAULT_ALARM, value=False)
            client.write_register(address=HR_BASE + H_ERROR_CODE, value=0)
        except Exception:
            pass
        any_response = False
        max_dc_bus = 0.0
        max_freq = 0.0
        step_history = []
        for i in range(80):
            s = read_state(client)
            if s:
                step_history.append(s["vfd_poll_step"])
                if s["vfd_dc_bus"] > 0 or s["vfd_frequency"] > 0 or s["vfd_comm_ok"]:
                    any_response = True
                    log(f"  *** RESPONSE at +{i*0.25:.1f}s: dc_bus={s['vfd_dc_bus']}V "
                        f"freq={s['vfd_frequency']}Hz comm={s['vfd_comm_ok']}", f)
                max_dc_bus = max(max_dc_bus, s["vfd_dc_bus"])
                max_freq = max(max_freq, s["vfd_frequency"])
                # Print every 5 seconds
                if i % 20 == 0:
                    log(f"  +{i*0.25:.1f}s: step={s['vfd_poll_step']} "
                        f"comm={s['vfd_comm_ok']} fault={s['fault_alarm']}", f)
            time.sleep(0.25)

        unique_steps = sorted(set(step_history))
        log(f"  Steps observed: {unique_steps} (from {len(step_history)} samples)", f)
        log(f"  Max DC bus: {max_dc_bus}V  Max freq: {max_freq}Hz", f)
        if any_response:
            log(f"  RESULT: VFD DID respond at some point!", f)
        else:
            log(f"  RESULT: Zero VFD response over 20 seconds.", f)

        # ============================================================
        # FINAL SUMMARY
        # ============================================================
        log("", f)
        log("=" * 60, f)
        log("SUMMARY OF FIX ATTEMPTS", f)
        log("=" * 60, f)

        s = read_state(client)
        log(f"Final state: {state_summary(s)}", f)
        log("", f)

        # Analyze what we learned
        step_cycling = len(set(step_history)) > 1 if step_history else False

        if step_cycling:
            log("FINDING: poll_step IS cycling -- MSG blocks are executing.", f)
            log("  This means Channel 0 IS driving the serial port.", f)
            log("  The VFD is not responding to the frames.", f)
            log("", f)
            log("LIKELY CAUSES (in order):", f)
            log("  1. RS-485 D+/D- wires swapped -- TRY SWAPPING WIRES", f)
            log("  2. Stop bits mismatch -- PLC may send 8N1, VFD expects 8N2 (P09.04=13)", f)
            log("     Try changing VFD to 8N1: set P09.04=12 on keypad", f)
            log("  3. VFD has latched fault -- press STOP/RESET on VFD keypad", f)
            log("  4. VFD slave addr wrong -- verify P09.00=1 on keypad", f)
            log("  5. Baud rate mismatch -- verify P09.01=9.6 (9600) on keypad", f)
        else:
            log("FINDING: poll_step NOT cycling -- MSG blocks may not be executing.", f)
            log("  v4.1.9 with Channel=0 may NOT be downloaded to the PLC.", f)
            log("", f)
            log("CRITICAL ACTION:", f)
            log("  1. In CCW: close and reopen Prog2 tab", f)
            log("  2. Verify header says v4.1.9 and Channel := 0", f)
            log("  3. Check Controller -> Ethernet IP matches 169.254.32.93", f)
            log("  4. Build (Ctrl+Shift+B)", f)
            log("  5. Connect -> Program mode -> Download -> Run mode", f)
            log("  6. Run this script again", f)

        log("", f)
        log(f"Full log saved to: {LOG_FILE}", f)
        log("=" * 60, f)

    client.close()


if __name__ == "__main__":
    main()
