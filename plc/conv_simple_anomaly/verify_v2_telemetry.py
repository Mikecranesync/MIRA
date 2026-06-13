#!/usr/bin/env python3
"""Verify the Conv_Simple_2.0 / Prog_VFD V2.0 acceptance criteria against the
live trend historian — the step-6 telemetry check, one command.

Run this AFTER: V2.0 flashed (8 vars + .ccwmod imported + Clean->Build->Download),
e-stop validated under LOTO, and the motor running at 30 Hz.

Acceptance (INSTALL_ConvSimple_v2.0.md):
  1. torque / rpm / power read NON-ZERO at quality=good (V1.8 never read these).
  2. freq command vs output frequency track ~1:1 (10x off => historian divisor).

Read-only: it only GETs /trends/summary. It never touches the PLC or the drive.
Dependency-free on purpose (stdlib urllib) so it runs on the bench laptop without
installing anything — matches the trend-viewer/historian zero-dep ethos. (The repo
httpx standard governs the MIRA services; this is a standalone bench one-shot.)

Usage (PLC laptop, historian up on :8766):
    python plc/conv_simple_anomaly/verify_v2_telemetry.py
    python plc/conv_simple_anomaly/verify_v2_telemetry.py --url http://127.0.0.1:8766 --window 30
Exit 0 = all criteria pass; 1 = a criterion failed or no data yet.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request

# Historian tag names (verified live 2026-06-13 via /trends/summary) — NOTE the
# _pct / _kw / _hz suffixes; the bare names (vfd_torque, vfd_power, vfd_frequency)
# do NOT exist in the historian.
T_TORQUE = "vfd_torque_pct"
T_RPM = "vfd_motor_rpm"
T_POWER = "vfd_power_kw"
T_FREQ_CMD = "vfd_freq_cmd"
T_FREQ_OUT = "vfd_frequency_hz"


def fetch_summaries(base: str, window: float) -> dict:
    url = f"{base.rstrip('/')}/trends/summary?window={window}"
    with urllib.request.urlopen(url, timeout=8) as r:  # noqa: S310 (trusted localhost bench)
        return json.loads(r.read().decode("utf-8"))


def field(summaries: dict, tag: str, key: str):
    s = summaries.get(tag)
    return None if s is None else s.get(key)


def evaluate(data: dict) -> bool:
    """Print the acceptance report for one /trends/summary payload; return all-pass."""
    conn = data.get("connection")
    summaries = data.get("summaries", {})
    print(f"historian connection: {conn} | tags: {len(summaries)}\n")

    ok = True

    # --- criterion 1: torque / rpm / power non-zero at good quality ---
    print("[1] torque / rpm / power NON-ZERO + quality=good")
    for label, tag in (("torque", T_TORQUE), ("rpm", T_RPM), ("power", T_POWER)):
        cur = field(summaries, tag, "current")
        q = field(summaries, tag, "quality")
        unit = field(summaries, tag, "unit") or ""
        if cur is None or q is None:
            print(f"    FAIL {label:6} ({tag}): no data yet (current={cur}, quality={q})")
            ok = False
        elif q != "good":
            print(f"    FAIL {label:6} ({tag}): quality={q} (need 'good'), current={cur} {unit}")
            ok = False
        elif cur == 0:
            print(f"    FAIL {label:6} ({tag}): reads 0 (V1.8 symptom — was V2.0 actually flashed?)")
            ok = False
        else:
            print(f"    PASS {label:6} ({tag}): current={cur} {unit}, quality={q}")

    # --- criterion 2: freq command vs output track ~1:1 ---
    print("\n[2] freq command vs output frequency track ~1:1")
    cmd = field(summaries, T_FREQ_CMD, "current")
    out = field(summaries, T_FREQ_OUT, "current")
    if cmd is None or out is None or not out:
        print(f"    FAIL: missing/zero data (cmd={cmd}, out={out})")
        ok = False
    else:
        ratio = cmd / out
        if 0.9 <= ratio <= 1.1:
            print(f"    PASS: cmd={cmd} out={out} (ratio {ratio:.3f} ~ 1:1)")
        elif 9.0 <= ratio <= 11.0 or 0.09 <= ratio <= 0.11:
            print(f"    WARN: cmd={cmd} out={out} (ratio {ratio:.3f} ~ 10x) -> historian DIVISOR, "
                  f"not a PLC bug. Fix the scale, re-check.")
            ok = False
        else:
            print(f"    FAIL: cmd={cmd} out={out} (ratio {ratio:.3f}) — not tracking 1:1")
            ok = False

    print("\n" + ("ALL ACCEPTANCE CRITERIA PASS" if ok
                  else "NOT YET - see FAIL/WARN lines above"))
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description="Verify Conv_Simple_2.0 telemetry acceptance.")
    ap.add_argument("--url", default="http://127.0.0.1:8766", help="historian base URL")
    ap.add_argument("--window", type=float, default=30.0, help="summary window seconds")
    ap.add_argument("--watch", action="store_true",
                    help="poll until all criteria pass (hands-free after you hit Run at 30 Hz)")
    ap.add_argument("--interval", type=float, default=3.0, help="--watch poll seconds")
    ap.add_argument("--timeout", type=float, default=600.0, help="--watch give-up seconds")
    args = ap.parse_args()

    def poll_once() -> "bool | None":
        try:
            return evaluate(fetch_summaries(args.url, args.window))
        except Exception as e:
            print(f"FAIL: could not reach historian at {args.url} ({e}).")
            print("  Is the trend historian running? (serves /viewer/ + /trends/summary on :8766)")
            return None

    if not args.watch:
        return 0 if poll_once() else 1

    deadline = time.time() + args.timeout
    attempt = 0
    while time.time() < deadline:
        attempt += 1
        print(f"\n===== watch poll #{attempt} (Ctrl-C to stop) =====")
        if poll_once() is True:
            print("\n>>> V2.0 ACCEPTANCE CONFIRMED - torque/rpm/power live + freq 1:1.")
            return 0
        time.sleep(args.interval)
    print(f"\n[timeout] --watch gave up after {args.timeout:.0f}s without a clean pass.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
