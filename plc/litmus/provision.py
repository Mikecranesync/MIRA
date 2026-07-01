"""
Provision the Micro820 conveyor into Litmus Edge DeviceHub -- in one command.
=================================================================
BENCH-ONLY developer tool. Read-only toward the PLC (creates a READ device +
READ registers only; never writes a PLC register). Re-run after each 2-hour
Developer Edition reset instead of re-clicking tags in the UI.

The DeviceHub write API is undocumented + the loopedge-dh binary is compressed;
the schema below was reverse-engineered live -- see DEVICEHUB_API.md in this dir.

Auth: DeviceHub writes need an Authorization: Bearer <JWT>. Two ways to get one:
  1. Mint it directly (no UI):  export LITMUS_PASSWORD=... (default 'Factory2026!')
     -- the script logs in to loopedge-auth and mints a token itself.
  2. Or paste a token from the logged-in UI (F12 -> Network -> any /devicehub/*
     request -> copy the 'Bearer <token>' value):   export LITMUS_TOKEN=<token>

    python plc/litmus/provision.py               # mints its own token from LITMUS_PASSWORD
    LITMUS_TOKEN=... python plc/litmus/provision.py

Status: device creation is VERIFIED end-to-end. Register (tag) creation is
scaffolded but the register `name` must be a value from the Modbus driver's
register-name catalog -- the exact accepted format is the one OPEN item
(confirm from the DeviceHub UI Add-Tag form, then set NAME_FN below). Until then
the script fully provisions the DEVICE and reports each register attempt.
"""
import argparse, json, os, ssl, urllib.request

BASE = os.getenv("LITMUS_BASE", "https://localhost:8443")
# loopedge-auth login via the nginx-fronted path; if minting fails, pass LITMUS_TOKEN.
AUTH_LOGIN = os.getenv("LITMUS_AUTH_LOGIN", BASE.rstrip("/") + "/auth/v2/login")
MODBUS_TCP_DRIVER = "2AF1FA08-D638-11E9-BB65-2A2AE2DBCCE4"  # GET /devicehub/drivers
_CTX = ssl.create_default_context(); _CTX.check_hostname = False; _CTX.verify_mode = ssl.CERT_NONE

# Proven Modbus map (0-based; mirror of mira_on_litmus.py read path). address is an INT.
#   ("area", offset)  where area is "hr" (holding reg, FC3) or "coil" (FC1).
REGISTERS = [
    ("vfd_dc_bus",         "hr",   109), ("vfd_frequency",   "hr",   106),
    ("vfd_current",        "hr",   107), ("vfd_voltage",     "hr",   108),
    ("vfd_cmd_word",       "hr",   114), ("vfd_status_word", "hr",   117),
    ("vfd_fault_code",     "hr",   118), ("motor_running",   "coil", 0),
    ("vfd_comm_ok",        "coil", 3),   ("e_stop_active",   "coil", 5),
    ("estop_wiring_fault", "coil", 9),
]

# OPEN ITEM: the accepted register `name` (driver catalog value). Confirm from the
# UI Add-Tag form, then implement. Best current guess left for quick iteration.
def NAME_FN(area, offset):
    # e.g. Modbus 4xxxx/0xxxx reference -- TBD against the driver catalog.
    return ("4%04d" % (offset + 1)) if area == "hr" else ("0%04d" % (offset + 1))


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


def mint_token():
    pw = os.getenv("LITMUS_PASSWORD", "Factory2026!")
    body = json.dumps({"username": os.getenv("LITMUS_USER", "admin"), "password": pw}).encode()
    req = urllib.request.Request(AUTH_LOGIN, data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, context=_CTX, timeout=15) as r:
        return json.load(r)["jwtAccess"]


def device_body(name, host, port, unit):
    # every properties value MUST be a string (map[string]string).
    return {"name": name, "driverId": MODBUS_TCP_DRIVER,
            "properties": {"networkAddress": host, "networkPort": str(port),
                           "stationId": str(unit), "Zero-Based Addressing": "1"}}


def register_body(device_id, tag, area, offset):
    return {"deviceId": device_id, "name": NAME_FN(area, offset),
            "TagName": tag, "address": int(offset)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="conv-101")
    ap.add_argument("--host", default=os.getenv("PLC_HOST", "192.168.1.100"))
    ap.add_argument("--port", type=int, default=502)
    ap.add_argument("--unit", type=int, default=1)
    ap.add_argument("--skip-registers", action="store_true",
                    help="provision the device only (registers need NAME_FN confirmed)")
    args = ap.parse_args()

    token = os.getenv("LITMUS_TOKEN")
    if not token:
        try:
            token = mint_token()
            print("Minted a token from LITMUS_PASSWORD.")
        except Exception as e:  # noqa: BLE001
            print("ERROR: no LITMUS_TOKEN and mint failed (%s). Paste a UI Bearer token." % e)
            return 2

    print("Provisioning '%s' (Modbus TCP %s:%d unit %d) on %s ..."
          % (args.name, args.host, args.port, args.unit, BASE))
    st, resp = _call("POST", "/devicehub/devices", token, device_body(args.name, args.host, args.port, args.unit))
    print("  POST /devicehub/devices -> HTTP %s" % st)
    if st not in (200, 201):
        print("  response: %s" % resp)
        return 1
    device_id = resp.get("id") or args.name
    print("  device id: %s  (ip=%s)" % (device_id, resp.get("properties", {}).get("networkAddress")))

    if args.skip_registers:
        print("Device provisioned; --skip-registers set. Confirm NAME_FN then re-run for tags.")
        return 0

    ok = 0
    for tag, area, offset in REGISTERS:
        st, resp = _call("POST", "/devicehub/registers", token, register_body(device_id, tag, area, offset))
        print("  register %-20s (%s %d) -> HTTP %s" % (tag, area, offset, st))
        if st in (200, 201):
            ok += 1
        elif resp:
            print("       response: %s" % resp)
    print("\nDone: %d/%d registers. (If 0, NAME_FN needs the real driver register-name format --"
          " see /var/log/loopedge-dh/current + DEVICEHUB_API.md.)" % (ok, len(REGISTERS)))
    print("Then read through Litmus:\n"
          "  LITMUS_API_KEY=... python plc/litmus/mira_on_litmus.py --source litmus --device-id %s" % device_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
