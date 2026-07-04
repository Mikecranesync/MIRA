"""
MIRA on top of Litmus Edge -- the value-add proof.
=================================================================
BENCH-ONLY developer tool. Not a customer-shipped surface, not the mira-relay
ingest path (does NOT touch ingest_contract / ingest_batch / tag_events).
Read-only toward the PLC and toward Litmus.

Thesis: Litmus Edge is *an* industrial data platform (it collects + normalizes
the conveyor's tags). MIRA sits ON TOP of it and adds the intelligence Litmus
does not: it turns the raw tag wall into equipment state + likely cause + the
next check to make, grounded in the Conv_Simple machine card (the A0-A12 rules).

Two read sources, same MIRA brain (plc/conv_simple_anomaly rules):
  --source litmus   read tag values THROUGH Litmus' external API
                    (GET /api/tags/by-device/{id}, header x-api-key).  <-- the thesis
  --source plc      read the PLC directly over Modbus TCP (no Litmus).  <-- control/baseline

    python plc/litmus/mira_on_litmus.py --source plc
    LITMUS_API_KEY=... python plc/litmus/mira_on_litmus.py --source litmus --device-id conv-101

Zero third-party deps (stdlib socket + urllib) so it runs under any python3.
"""
import argparse
import json
import os
import socket
import ssl
import struct
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "conv_simple_anomaly"))
import rules  # noqa: E402  -- the A0-A12 machine-card brain (evaluate, T_*, DEFAULT_CFG)

PLC_HOST = os.getenv("PLC_HOST", "192.168.1.100")
PLC_PORT = int(os.getenv("PLC_PORT", "502"))
UNIT = 1

# ---- Litmus provisioned tag name -> (rules topic, scale divisor) -------------
# Names are the VERIFIED live global vars (CIP read-by-name, 2026-06-30); scales
# mirror plc/conv_simple_anomaly/live_check.py HR_SPECS (raw register -> engineering).
LITMUS_TAG_MAP = {
    "motor_running":      (rules.T_RUN,    None),   # bool
    "vfd_comm_ok":        (rules.T_COMM,   None),   # bool
    "e_stop_active":      (rules.T_ESTOP,  None),   # bool
    "estop_wiring_fault": (rules.T_WIRING, None),   # bool
    "vfd_dc_bus":         (rules.T_DCBUS,  10.0),   # UINT -> V
    "vfd_frequency":      (rules.T_FREQ,   100.0),  # UINT -> Hz
    "vfd_current":        (rules.T_CUR,    100.0),  # UINT -> A
    "vfd_voltage":        ("vfd/vfd101/voltage_v", 10.0),
    "vfd_cmd_word":       (rules.T_CMD,    1.0),
    "vfd_fault_code":     (rules.T_FAULT,  1.0),
    "vfd_status_word":    ("vfd/vfd101/status_word", 1.0),
}

# ---- Modbus offsets (mirror of live_check.py) for the --source plc baseline --
_COILS = {0: rules.T_RUN, 3: rules.T_COMM, 5: rules.T_ESTOP, 9: rules.T_WIRING}
_HR = {106: (rules.T_FREQ, 100.0), 107: (rules.T_CUR, 100.0),
       108: ("vfd/vfd101/voltage_v", 10.0), 109: (rules.T_DCBUS, 10.0),
       114: (rules.T_CMD, 1.0), 118: (rules.T_FAULT, 1.0)}


def _modbus(sock, fc, start, qty):
    pdu = struct.pack(">BHH", fc, start, qty)
    sock.sendall(struct.pack(">HHH", 1, 0, len(pdu) + 1) + bytes([UNIT]) + pdu)
    r = sock.recv(512)
    if r[7] & 0x80:
        return None  # Modbus exception (addr not in live map) -> degrade to None
    return r[9:9 + r[8]]


def read_plc():
    """Direct Modbus TCP snapshot (no Litmus). Raw sockets, no pymodbus dep."""
    snap = {}
    s = socket.socket()
    s.settimeout(3)
    s.connect((PLC_HOST, PLC_PORT))
    try:
        for off, topic in _COILS.items():
            d = _modbus(s, 1, off, 1)
            if d is not None:
                snap[topic] = bool(d[0] & 1)
        for off, (topic, div) in _HR.items():
            d = _modbus(s, 3, off, 1)
            if d is not None:
                v = struct.unpack(">H", d)[0]
                snap[topic] = v / div if div != 1.0 else v
    finally:
        s.close()
    return snap


def read_litmus(base, api_key, device_id):
    """Snapshot read THROUGH Litmus' external integration API (x-api-key)."""
    url = base.rstrip("/") + "/api/tags/by-device/" + urllib.request.quote(device_id)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"x-api-key": api_key, "Accept": "application/json"})
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        payload = json.load(r)
    # Tolerant parse: accept {tags:[...]}, [...], or {name:value}. Each tag row is
    # expected to expose a name + a current value under common key spellings.
    rows = payload.get("tags", payload) if isinstance(payload, dict) else payload
    litmus_vals = {}
    if isinstance(rows, dict):
        litmus_vals = rows
    else:
        for row in rows:
            name = row.get("name") or row.get("tagName") or row.get("tag")
            val = row.get("value", row.get("lastValue", row.get("v")))
            if name is not None:
                litmus_vals[name] = val
    snap = {}
    for tag, (topic, div) in LITMUS_TAG_MAP.items():
        if tag not in litmus_vals or litmus_vals[tag] is None:
            continue
        raw = litmus_vals[tag]
        if div is None:
            snap[topic] = bool(raw) if not isinstance(raw, bool) else raw
        else:
            snap[topic] = float(raw) / div if div != 1.0 else raw
    return snap, litmus_vals


def diagnose(snap):
    now = time.time()
    cmd_run = snap.get(rules.T_CMD) in rules.DEFAULT_CFG["run_cmd_values"]
    derived = {"now": now, "max_stale_s": 0.0, "freq_frozen_s": 0.0,
               "cmd_run_for_s": (rules.DEFAULT_CFG["cmd_run_grace_s"] + 1) if cmd_run else 0.0}
    return rules.evaluate(snap, derived)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["litmus", "plc"], default="plc")
    ap.add_argument("--device-id", default=os.getenv("LITMUS_DEVICE_ID", "conv-101"))
    ap.add_argument("--base", default=os.getenv("LITMUS_BASE", "https://localhost:8443"))
    ap.add_argument("--raw-json", action="store_true", help="dump the raw Litmus payload")
    args = ap.parse_args()

    litmus_vals = None
    if args.source == "litmus":
        key = os.getenv("LITMUS_API_KEY")
        if not key:
            print("ERROR: set LITMUS_API_KEY (Litmus UI -> Settings -> API Keys).")
            return 2
        snap, litmus_vals = read_litmus(args.base, key, args.device_id)
        origin = "Litmus Edge external API (/api/tags/by-device, x-api-key)"
    else:
        snap = read_plc()
        origin = "PLC direct (Modbus TCP %s:%d) -- no Litmus in the path" % (PLC_HOST, PLC_PORT)

    print("=" * 68)
    print("MIRA on top of Litmus Edge -- contextualized diagnosis")
    print("  read source : %s" % origin)
    print("=" * 68)

    if args.raw_json and litmus_vals is not None:
        print("\n-- RAW Litmus tag values --\n" + json.dumps(litmus_vals, indent=2))

    print("\n--- WHAT THE PLATFORM SHOWS (raw tags) ---")
    for topic in sorted(snap):
        print("  %-28s = %s" % (topic, snap[topic]))
    if not snap:
        print("  (no tags -- check the device id / provisioning)")
        return 1

    anomalies = diagnose(snap)
    print("\n--- WHAT MIRA ADDS (state + likely cause + next check) ---")
    if not anomalies:
        dcb = snap.get(rules.T_DCBUS)
        comm = snap.get(rules.T_COMM)
        run = snap.get(rules.T_RUN)
        print("  STATE: conveyor %s, GS10 comms %s, DC bus %s V -- within all"
              % ("RUNNING" if run else "idle",
                 "healthy" if comm else "DOWN",
                 ("%.1f" % dcb) if dcb is not None else "?"))
        print("  MIRA: no anomalies against the Conv_Simple machine card (A0-A12).")
        print("        Litmus shows the numbers; MIRA confirms they are all nominal.")
    else:
        for a in anomalies:
            print("  [%s] %s -- %s" % (a.severity, a.title, a.rule_id))
            print("      %s" % a.message)
            if a.evidence:
                ev = ", ".join("%s=%s" % (e["topic"].split("/")[-1], e["value"]) for e in a.evidence)
                print("      evidence: %s" % ev)
            print("      confidence: %.2f" % a.confidence)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
