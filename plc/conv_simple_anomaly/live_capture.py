#!/usr/bin/env python3
"""Live data-coverage logger for the Conv_Simple bench — poll the trend historian
while the operator cycles functions (FWD/REV/STOP, freq changes, e-stop) and report
which tags actually came through live.

Answers "did I get ALL my data?" after a flash: every historian tag is sampled over
the capture window; a tag is LIVE if it reported a non-null value at quality=good,
and MOVED if its value changed (proving it tracks the function being exercised).

Read-only: GETs /trends/summary only. Never touches the PLC or drive.
Stdlib-only + ASCII output so it runs on the bench Windows console with no install.

Usage (PLC laptop, historian up on :8766):
    python plc/conv_simple_anomaly/live_capture.py                  # 60s @ 2s
    python plc/conv_simple_anomaly/live_capture.py --seconds 120 --interval 2
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request

# Grouped for a readable report (order only; unknown tags are appended).
GROUPS = {
    "VFD telemetry": ["vfd_frequency_hz", "vfd_freq_cmd", "vfd_current_a", "vfd_voltage_v",
                      "vfd_dc_bus_v", "vfd_torque_pct", "vfd_motor_rpm", "vfd_power_kw"],
    "VFD status":    ["vfd_status_word", "vfd_cmd_word", "vfd_error_code", "vfd_warn_code",
                      "vfd_last_fault", "vfd_comm_ok", "motor_running"],
    "Digital in":    ["di00_fwd_sw", "di01_rev_sw", "di02_estop_nc", "di03_estop_no", "di04_pb_run"],
    "Digital out":   ["do00_green", "do01_red", "do02_contactor_q1", "do03_pb_run_led"],
    "Safety/derived": ["e_stop_active", "estop_wiring_fault", "last_fault_clear"],
}


def fetch(base: str, window: float) -> dict:
    url = f"{base.rstrip('/')}/trends/summary?window={window}"
    with urllib.request.urlopen(url, timeout=8) as r:  # noqa: S310 (trusted localhost bench)
        return json.loads(r.read().decode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser(description="Live data-coverage logger for the Conv_Simple bench.")
    ap.add_argument("--url", default="http://127.0.0.1:8766")
    ap.add_argument("--seconds", type=float, default=60.0, help="capture window")
    ap.add_argument("--interval", type=float, default=2.0, help="poll seconds")
    ap.add_argument("--window", type=float, default=10.0, help="historian summary window")
    args = ap.parse_args()

    # per-tag accumulation
    seen: dict[str, dict] = {}   # tag -> {samples, good, no_data, stale, vals:set, unit, last}
    end = time.time() + args.seconds
    polls = 0
    print(f"capturing {args.seconds:.0f}s @ {args.interval:.0f}s from {args.url} ... "
          f"cycle FWD/REV/STOP, change freq, press the e-stop.\n")
    while time.time() < end:
        polls += 1
        try:
            data = fetch(args.url, args.window)
        except Exception as e:
            print(f"  poll {polls}: historian unreachable ({e})")
            time.sleep(args.interval)
            continue
        conn = data.get("connection")
        for tag, s in data.get("summaries", {}).items():
            d = seen.setdefault(tag, {"samples": 0, "good": 0, "no_data": 0, "stale": 0,
                                      "vals": set(), "unit": s.get("unit", ""), "last": None})
            d["samples"] += 1
            q = s.get("quality")
            d[q if q in ("good", "no_data", "stale") else "no_data"] += 1
            cur = s.get("current")
            d["last"] = cur
            if cur is not None:
                d["vals"].add(round(float(cur), 3))
        # live one-line heartbeat so the operator sees it working
        live_now = sum(1 for s in data.get("summaries", {}).values() if s.get("quality") == "good")
        print(f"  poll {polls:2d}  conn={conn}  good-now={live_now}/{len(data.get('summaries',{}))}")
        time.sleep(args.interval)

    print(f"\n==== coverage over {polls} polls ====")
    ordered, shown = [], set()
    for grp, tags in GROUPS.items():
        ordered.append((grp, [t for t in tags if t in seen]))
        shown.update(tags)
    leftover = [t for t in sorted(seen) if t not in shown]
    if leftover:
        ordered.append(("Other", leftover))

    live_ct = moved_ct = total = 0
    for grp, tags in ordered:
        if not tags:
            continue
        print(f"\n[{grp}]")
        for t in tags:
            d = seen[t]
            total += 1
            is_live = d["good"] > 0 and d["last"] is not None
            moved = len(d["vals"]) > 1
            live_ct += is_live
            moved_ct += moved
            vals = sorted(d["vals"])
            rng = f"{vals[0]}..{vals[-1]}" if vals else "-"
            status = "LIVE " if is_live else ("no_data" if d["no_data"] == d["samples"] else "PARTIAL")
            mv = " MOVED" if moved else ""
            unit = f" {d['unit']}" if d["unit"] else ""
            print(f"   {status:7} {t:20} last={d['last']}{unit}  range[{rng}]"
                  f"  good={d['good']}/{d['samples']}{mv}")

    print(f"\nSUMMARY: {live_ct}/{total} tags LIVE (good quality), {moved_ct} MOVED during capture.")
    if live_ct < total:
        dead = [t for grp, tags in ordered for t in tags
                if not (seen[t]["good"] > 0 and seen[t]["last"] is not None)]
        print(f"  NOT live: {', '.join(dead)}")
        print("  (a tag that never moved may simply not have been exercised — cycle that function.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
