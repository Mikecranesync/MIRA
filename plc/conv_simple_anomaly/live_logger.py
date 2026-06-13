"""
Live logger — capture EVERY Micro820 tag to a timestamped, labeled file while you
inject faults at the bench. The ground-truth recorder for "run it through its paces":
each fault you replicate (flaky sensor, loose wire, e-stop, jam, RS-485 pull) becomes
a labeled dataset the anomaly rules + Ask MIRA can be tuned and tested against.

  python plc/conv_simple_anomaly/live_logger.py --label flaky_photoeye
  python plc/conv_simple_anomaly/live_logger.py --label baseline_run --hz 4 --secs 60
  python plc/conv_simple_anomaly/live_logger.py --label estop_wiring --host 192.168.1.100

One run = one labeled session. Writes BOTH:
  logs/<UTCstamp>_<label>.jsonl   (one JSON object per poll — full fidelity)
  logs/<UTCstamp>_<label>.csv     (same data, flat — open in Excel)

Read-only: only Modbus read FCs (read_coils / read_holding_registers). NEVER writes to
the PLC or the GS10. Modbus TCP over Ethernet is side-effect-free per
.claude/rules/fieldbus-readonly.md. Ctrl-C to stop a continuous run.

While running, type a note + Enter to stamp an event marker into the log
(e.g. "broke beam now") — makes the dataset self-labeling without stopping.

NOTE: the PLC has ONE Modbus connection slot. Do NOT run this concurrently with
trend_historian.py (the bench trend service) — they compete for the bus. The historian
is the sole poller when it's up; stop it before running a labeled capture here.
"""
from __future__ import annotations
import argparse, csv, json, os, sys, threading, time
from datetime import datetime, timezone
from pymodbus.client import ModbusTcpClient

try:  # Windows consoles default to cp1252; notes may be UTF-8
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# --- Slave map (0-based pymodbus offsets) — mirror of MbSrvConf_v4.xml / live-plc-bridge ---
# coil offset -> friendly signal name
COIL_NAMES = {
    0: "motor_running", 1: "conveyor_running", 2: "fault_alarm", 3: "vfd_comm_ok",
    4: "system_ready", 5: "e_stop_active", 6: "dir_fwd", 7: "dir_rev", 8: "heartbeat",
    9: "estop_wiring_fault", 10: "dir_fault",
    11: "di00_fwd_sw", 12: "di01_rev_sw", 13: "di02_estop_nc", 14: "di03_estop_no",
    15: "di04_pb_run", 16: "do00_green", 17: "do01_red", 18: "do02_contactor_q1",
    19: "do03_pb_run_led", 20: "vfd_poll_active", 21: "vfd_fault_reset_pending",
    22: "di05_photoeye",  # slave-map v2: PE-101 on DI_05, coil 000023 (errors until reflash)
    23: "last_fault_clear",  # v5.1.0 trends V2: operator clear for vfd_last_fault latch
}
# HR offset -> (friendly name, scale divisor). divisor 1 = raw int.
HR_SPECS = {
    100: ("motor_speed", 1.0), 101: ("motor_current", 1.0), 102: ("temperature", 1.0),
    103: ("pressure", 1.0), 104: ("conveyor_speed", 1.0), 105: ("error_code", 1.0),
    106: ("vfd_frequency_hz", 100.0), 107: ("vfd_current_a", 100.0),
    108: ("vfd_voltage_v", 10.0), 109: ("vfd_dc_bus_v", 10.0), 110: ("item_count", 1.0),
    111: ("uptime_seconds", 1.0), 112: ("conveyor_speed_cmd", 1.0), 113: ("conv_state", 1.0),
    114: ("vfd_cmd_word", 1.0), 115: ("vfd_freq_setpoint", 100.0), 116: ("vfd_poll_step", 1.0),
    # Trends V2 — full GS10 monitoring (ladder mirrors of the 0x2100 status group; absent
    # until the slave-map-v2 reflash; per-offset reads skip them silently meanwhile).
    # Scales follow the drive's native register formats (GS10 UM p4-195/p5-5): 0x2102 freq
    # cmd XXX.XX Hz, 0x210B torque XXX.X %, 0x210C rpm raw, 0x210F power X.XXX kW.
    # error/warn are the split bytes of 0x2100; last_fault is the PLC-latched copy of the
    # last nonzero error code (survives a drive fault reset).
    117: ("vfd_status_word", 1.0), 118: ("vfd_error_code", 1.0), 119: ("vfd_warn_code", 1.0),
    120: ("vfd_freq_cmd", 100.0), 121: ("vfd_torque_pct", 10.0), 122: ("vfd_motor_rpm", 1.0),
    123: ("vfd_power_kw", 1000.0), 124: ("vfd_last_fault", 1.0),
}
UNIT = 1

ALL_COLS = [COIL_NAMES[i] for i in sorted(COIL_NAMES)] + [HR_SPECS[i][0] for i in sorted(HR_SPECS)]


# pymodbus dropped slave= in favor of device_id= around 3.7; probe once and cache the
# working keyword so we don't spew TypeErrors every poll.
_DEV_KW = {"device_id": UNIT}


def _read(fn, addr, count):
    """Single tolerant read. Returns the response, or None on error/exception."""
    try:
        r = fn(addr, count=count, **_DEV_KW)
        return None if r.isError() else r
    except TypeError:
        # very old pymodbus — fall back to slave= and remember it
        try:
            r = fn(addr, count=count, slave=UNIT)
            globals()["_DEV_KW"] = {"slave": UNIT}
            return None if r.isError() else r
        except Exception:
            return None
    except Exception:  # noqa: BLE001 — surface as a soft poll miss
        return None


def poll_once(c) -> dict:
    """Read every mapped coil + HR ONE AT A TIME. The running program may expose only a
    sparse subset (a freshly-downloaded ladder maps fewer registers, and the Micro820
    rejects a read that spans an unmapped address) — per-offset reads capture whatever IS
    mapped and silently skip the rest. Returns {name: value}; unmapped signals omitted."""
    row: dict[str, object] = {}
    for off, name in COIL_NAMES.items():
        r = _read(c.read_coils, off, 1)
        bits = getattr(r, "bits", None)
        if bits:
            row[name] = int(bool(bits[0]))
    for off, (name, div) in HR_SPECS.items():
        r = _read(c.read_holding_registers, off, 1)
        regs = getattr(r, "registers", None)
        if regs:
            raw = regs[0]
            row[name] = round(raw / div, 3) if div != 1.0 else raw
    return row


def _marker_thread(box: dict):
    """Background stdin reader: a typed line becomes the next row's event marker."""
    try:
        for line in sys.stdin:
            note = line.strip()
            if note:
                box["note"] = note
                print(f"  ★ marker queued: {note!r}", flush=True)
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser(description="Read-only live logger for the Conv_Simple Micro820.")
    ap.add_argument("--host", default="192.168.1.100")
    ap.add_argument("--port", type=int, default=502)
    ap.add_argument("--label", required=True, help="what you are injecting this session (e.g. flaky_photoeye)")
    ap.add_argument("--hz", type=float, default=4.0, help="polls per second (default 4)")
    ap.add_argument("--secs", type=float, default=0.0, help="duration; 0 = until Ctrl-C")
    ap.add_argument("--outdir", default=os.path.join(os.path.dirname(__file__), "logs"))
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in args.label)
    base = os.path.join(args.outdir, f"{stamp}_{safe}")
    jsonl_path, csv_path = base + ".jsonl", base + ".csv"

    c = ModbusTcpClient(args.host, port=args.port, timeout=2)
    if not c.connect():
        print(f"ERROR: cannot connect to PLC at {args.host}:{args.port} "
              f"(is CCW connected / holding the Modbus server? disconnect it first)", file=sys.stderr)
        sys.exit(2)

    box: dict = {}
    threading.Thread(target=_marker_thread, args=(box,), daemon=True).start()

    period = 1.0 / max(args.hz, 0.1)
    t_end = time.time() + args.secs if args.secs > 0 else None
    n = 0
    print(f"logging '{args.label}' → {jsonl_path}\n  (type a note + Enter to mark an event; Ctrl-C to stop)")
    try:
        with open(jsonl_path, "w", encoding="utf-8") as jf, open(csv_path, "w", newline="", encoding="utf-8") as cf:
            writer = csv.writer(cf)
            writer.writerow(["ts_utc", "label", "event"] + ALL_COLS)
            while t_end is None or time.time() < t_end:
                t0 = time.time()
                row = poll_once(c)
                note = box.pop("note", "")
                ts = datetime.now(timezone.utc).isoformat()
                rec = {"ts_utc": ts, "label": args.label, "event": note, **row}
                jf.write(json.dumps(rec) + "\n")
                jf.flush()
                writer.writerow([ts, args.label, note] + [row.get(col, "") for col in ALL_COLS])
                cf.flush()
                n += 1
                if row:
                    run = row.get("motor_running", "?")
                    cw = row.get("vfd_cmd_word", "?")
                    comm = row.get("vfd_comm_ok", "?")
                    pe = row.get("di05_photoeye", "—")
                    cur = row.get("vfd_current_a", "?")
                    hz = row.get("vfd_frequency_hz", "?")
                    line = (f"\r#{n:>5} run={run} cmd={cw} comm={comm} pe={pe} "
                            f"{hz}Hz {cur}A   ")
                    sys.stdout.write(line + (f"<{note}>" if note else "")); sys.stdout.flush()
                else:
                    sys.stdout.write(f"\r#{n:>5} (no data — PLC not answering)   "); sys.stdout.flush()
                dt = period - (time.time() - t0)
                if dt > 0:
                    time.sleep(dt)
    except KeyboardInterrupt:
        pass
    finally:
        c.close()
        print(f"\n\nstopped. {n} samples → {jsonl_path}\n             {csv_path}")


if __name__ == "__main__":
    main()
