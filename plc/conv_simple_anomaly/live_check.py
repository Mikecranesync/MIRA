"""
Live check — read the REAL PLC over Modbus TCP and run the machine-card anomaly rules,
no broker / no Docker required. Verifies the rules against actual hardware and prints the
current machine snapshot.

  python plc/conv_simple_anomaly/live_check.py [--host 192.168.1.100] [--secs 4]

Uses the SAME register map as plc/live-plc-bridge (kept in sync here so this tool has no
aiomqtt dependency). Read-only: never writes to the PLC.
"""
from __future__ import annotations
import argparse, sys, time
from pymodbus.client import ModbusTcpClient

try:  # Windows consoles default to cp1252; rule messages are UTF-8
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import rules

# --- bridge map (0-based pymodbus offsets) -- mirror of live-plc-bridge ---
COIL_TOPICS = {
    0: "motor/m101/running", 3: "vfd/vfd101/comm_ok", 5: "safety/estop", 9: "safety/wiring",
    11: "plc/di/di00_fwd", 12: "plc/di/di01_rev", 13: "plc/di/di02_estop_nc",
    14: "plc/di/di03_estop_no", 15: "plc/di/di04_pbrun", 16: "plc/do/do00_green",
    17: "plc/do/do01_red", 18: "safety/contactor_q1", 19: "plc/do/do03_pbrun_led",
    22: "plc/di/di05_photoeye",  # slave-map v2: PE-101 on DI 5, coil 000023 (offset 22)
}
HR_SPECS = {106: ("vfd/vfd101/freq", 100.0), 107: ("vfd/vfd101/current_a", 100.0),
            108: ("vfd/vfd101/voltage_v", 10.0), 109: ("vfd/vfd101/dc_bus_v", 10.0),
            114: ("vfd/vfd101/cmd_word", 1.0)}
COIL_READS = [(0, 1), (3, 1), (5, 1), (9, 1), (11, 9), (22, 1)]
HR_READS = [(106, 4), (114, 1)]
UNIT = 1


def _read(fn, addr, count):
    for kw in ({"count": count, "slave": UNIT}, {"count": count, "device_id": UNIT}):
        try:
            return fn(addr, **kw)
        except TypeError:
            continue
    return fn(addr, count)


def poll(client) -> dict:
    snap: dict = {}
    for off, cnt in COIL_READS:
        rr = _read(client.read_coils, off, cnt)
        if rr.isError():
            raise RuntimeError(f"coil read @{off} failed: {rr}")
        for i in range(cnt):
            if off + i in COIL_TOPICS:
                snap[COIL_TOPICS[off + i]] = bool(rr.bits[i])
    for off, cnt in HR_READS:
        rr = _read(client.read_holding_registers, off, cnt)
        if rr.isError():
            raise RuntimeError(f"HR read @{off} failed: {rr}")
        for i in range(cnt):
            if off + i in HR_SPECS:
                topic, div = HR_SPECS[off + i]
                snap[topic] = rr.registers[i] / div if div != 1.0 else rr.registers[i]
    return snap


def watch(client, secs):
    """Continuous monitor: poll + evaluate every 0.5s, print when anomalies fire/clear,
    with a periodic heartbeat. For tripping faults at the bench and watching live."""
    freq_val, freq_ts, cmd_run_since, last_any = None, 0.0, 0.0, 0.0
    prev: dict = {}
    t_end = time.time() + secs
    next_hb = 0.0
    print(f"WATCHING {secs:.0f}s — trip a fault and watch (Ctrl-C to stop)\n")
    while time.time() < t_end:
        now = time.time()
        try:
            snap = poll(client); last_any = now
        except Exception as e:
            print(f"  {time.strftime('%H:%M:%S')}  poll error: {e}"); time.sleep(0.5); continue
        if snap.get(rules.T_FREQ) != freq_val:
            freq_val, freq_ts = snap.get(rules.T_FREQ), now
        cmd_run = snap.get(rules.T_CMD) in rules.DEFAULT_CFG["run_cmd_values"]
        cmd_run_since = (cmd_run_since or now) if cmd_run else 0.0
        derived = {"now": now, "max_stale_s": now - last_any,
                   "freq_frozen_s": (now - freq_ts) if freq_ts else 0.0,
                   "cmd_run_for_s": (now - cmd_run_since) if cmd_run_since else 0.0}
        cur = {a.rule_id: a for a in rules.evaluate(snap, derived)}
        ts = time.strftime("%H:%M:%S")
        for rid in cur.keys() - prev.keys():
            a = cur[rid]; print(f"  {ts}  >>> FIRED  [{a.severity}] {rid}: {a.message}")
        for rid in prev.keys() - cur.keys():
            print(f"  {ts}  --- cleared {rid}")
        if now >= next_hb:
            print(f"  {ts}  · run={snap.get(rules.T_RUN)} cmd={snap.get(rules.T_CMD)} "
                  f"comm={snap.get(rules.T_COMM)} estop={snap.get(rules.T_ESTOP)} "
                  f"freq={snap.get(rules.T_FREQ)} cur={snap.get(rules.T_CUR)} "
                  f"dcbus={snap.get(rules.T_DCBUS)} active={sorted(cur) or '[]'}")
            next_hb = now + 5
        prev = cur
        time.sleep(0.5)
    print("\nwatch done.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="192.168.1.100")
    ap.add_argument("--port", type=int, default=502)
    ap.add_argument("--secs", type=float, default=4.0)
    ap.add_argument("--watch", action="store_true", help="continuous live monitor")
    args = ap.parse_args()
    if args.watch and args.secs < 30:
        args.secs = 240.0

    client = ModbusTcpClient(args.host, port=args.port, timeout=2)
    if not client.connect():
        print(f"FAIL: cannot connect to PLC {args.host}:{args.port}")
        return 2

    if args.watch:
        try:
            watch(client, args.secs)
        finally:
            client.close()
        return 0

    last_any = 0.0
    freq_val, freq_ts = None, 0.0
    cmd_run_since = 0.0
    t_end = time.time() + args.secs
    snap: dict = {}
    try:
        while time.time() < t_end:
            now = time.time()
            try:
                snap = poll(client)
                last_any = now
            except Exception as e:
                print("poll error:", e)
                time.sleep(0.5)
                continue
            if snap.get(rules.T_FREQ) != freq_val:
                freq_val, freq_ts = snap.get(rules.T_FREQ), now
            cmd_run = snap.get(rules.T_CMD) in rules.DEFAULT_CFG["run_cmd_values"]
            cmd_run_since = (cmd_run_since or now) if cmd_run else 0.0
            time.sleep(0.5)
    finally:
        client.close()

    now = time.time()
    derived = {"now": now, "max_stale_s": (now - last_any) if last_any else 1e9,
               "freq_frozen_s": (now - freq_ts) if freq_ts else 0.0,
               "cmd_run_for_s": (now - cmd_run_since) if cmd_run_since else 0.0}

    print("\n=== LIVE PLC SNAPSHOT ===")
    for k in sorted(snap):
        print(f"  {k:32} = {snap[k]}")
    print(f"  (derived: stale {derived['max_stale_s']:.1f}s, freq_frozen {derived['freq_frozen_s']:.1f}s, "
          f"cmd_run_for {derived['cmd_run_for_s']:.1f}s)")

    anomalies = rules.evaluate(snap, derived)
    print("\n=== ANOMALIES ===")
    if not anomalies:
        print("  none — machine state is within all machine-card invariants.")
    else:
        for a in anomalies:
            print(f"  [{a.severity}] {a.rule_id}: {a.message}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
