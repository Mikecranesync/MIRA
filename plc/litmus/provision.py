"""
Provision the Micro820 conveyor into Litmus Edge DeviceHub -- in one command.
=================================================================
BENCH-ONLY developer tool. Read-only toward the PLC (creates a READ device +
READ tags only; never writes a PLC register). Re-run after each 2-hour Developer
Edition reset instead of re-clicking 11 tags on a phone.

Auth: Litmus DeviceHub writes go through the browser-session (Keycloak/OIDC)
bearer -- Litmus' external x-api-key API is READ-only. So this script needs a
short-lived bearer token, grabbed once from the logged-in UI:
    F12 -> Network -> any /devicehub/* request -> copy the Authorization
    'Bearer <token>' value, then:  export LITMUS_TOKEN=<token>
(Token lives ~minutes; that's fine -- provisioning is a few POSTs.)

    LITMUS_TOKEN=... python plc/litmus/provision.py            # AB EtherNet/IP (by name)
    LITMUS_TOKEN=... python plc/litmus/provision.py --driver modbus

The device-create JSON shape is Litmus-version-specific; this script POSTs the
best-known shape and PRINTS the server response so a field mismatch is obvious
and quick to correct (it is not yet validated against a live token -- see README).
"""
import argparse
import json
import os
import ssl
import urllib.request

BASE = os.getenv("LITMUS_BASE", "https://localhost:8443")
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE

# Verified live global vars (CIP read-by-name 2026-06-30). For the AB EtherNet/IP
# driver the tag address IS the case-sensitive global-variable name.
TAGS = [
    ("motor_running", "bool"), ("vfd_comm_ok", "bool"), ("e_stop_active", "bool"),
    ("estop_wiring_fault", "bool"), ("vfd_dc_bus", "uint"), ("vfd_frequency", "uint"),
    ("vfd_current", "uint"), ("vfd_voltage", "uint"), ("vfd_cmd_word", "uint"),
    ("vfd_fault_code", "uint"), ("vfd_status_word", "uint"),
]
# Modbus fallback: 0-based holding-register / coil offsets (mirror of live_check.py).
MODBUS_ADDR = {
    "motor_running": ("coil", 0), "vfd_comm_ok": ("coil", 3), "e_stop_active": ("coil", 5),
    "estop_wiring_fault": ("coil", 9), "vfd_frequency": ("hr", 106), "vfd_current": ("hr", 107),
    "vfd_voltage": ("hr", 108), "vfd_dc_bus": ("hr", 109), "vfd_cmd_word": ("hr", 114),
    "vfd_fault_code": ("hr", 118), "vfd_status_word": ("hr", 117),
}


def _call(method, path, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE.rstrip("/") + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + token,
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, context=_CTX, timeout=15) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]


def device_payload(driver, name, host):
    if driver == "modbus":
        return {"name": name, "driverType": "modbus", "driverName": "modbus-tcp",
                "config": {"host": host, "port": 502, "unitId": 1, "pollInterval": 1000}}
    # AB Micro850 (Gen1.3) -- EtherNet/IP, reads global vars by name
    return {"name": name, "driverType": "plc", "driverName": "ab-micro850-gen1.3",
            "config": {"host": host, "port": 44818, "slot": 0, "pollInterval": 1000}}


def tag_payload(driver, device_id, tag, dtype):
    if driver == "modbus":
        kind, off = MODBUS_ADDR[tag]
        return {"deviceId": device_id, "name": tag, "dataType": dtype,
                "address": {"area": kind, "offset": off}}
    return {"deviceId": device_id, "name": tag, "dataType": dtype, "address": tag}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--driver", choices=["ab", "modbus"], default="ab")
    ap.add_argument("--name", default="conv-101")
    ap.add_argument("--host", default=os.getenv("PLC_HOST", "192.168.1.100"))
    args = ap.parse_args()

    token = os.getenv("LITMUS_TOKEN")
    if not token:
        print("ERROR: set LITMUS_TOKEN (see module docstring -- copy the UI's Bearer token).")
        return 2

    print("Provisioning '%s' via %s driver on %s ..." % (args.name, args.driver, BASE))
    st, resp = _call("POST", "/devicehub/devices", token, device_payload(args.driver, args.name, args.host))
    print("  POST /devicehub/devices -> HTTP %s" % st)
    if st not in (200, 201):
        print("  response: %s" % resp)
        print("  (adjust device_payload() to match this Litmus build's schema, then re-run.)")
        return 1
    device_id = resp.get("id") or resp.get("deviceId") or args.name
    print("  device id: %s" % device_id)

    ok = 0
    for tag, dtype in TAGS:
        if args.driver == "modbus" and tag not in MODBUS_ADDR:
            continue
        st, resp = _call("POST", "/devicehub/tags", token, tag_payload(args.driver, device_id, tag, dtype))
        print("  tag %-20s -> HTTP %s" % (tag, st))
        if st in (200, 201):
            ok += 1
        else:
            print("       response: %s" % resp)
    print("\nDone: %d/%d tags provisioned. Now run:" % (ok, len(TAGS)))
    print("  LITMUS_API_KEY=... python plc/litmus/mira_on_litmus.py --source litmus --device-id %s" % device_id)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
