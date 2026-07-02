"""
Provision the Micro820 conveyor into Litmus Edge DeviceHub -- in one command.
=================================================================
BENCH-ONLY developer tool. Read-only toward the PLC (creates a READ device +
READ registers only; never writes a PLC register). Re-run after each 2-hour
Developer Edition reset instead of re-clicking tags in the UI.

The DeviceHub write API is undocumented + the loopedge-dh binary is compressed;
the schema below was reverse-engineered + VERIFIED live -- see DEVICEHUB_API.md.

Auth: DeviceHub writes need an Authorization: Bearer <JWT>. Two ways to get one:
  1. Mint it directly (no UI):  export LITMUS_PASSWORD=... (default 'Factory2026!')
     -- the script logs in to loopedge-auth and mints a token itself.
  2. Or paste a UI Bearer token (F12 -> Network -> any /devicehub/*):  export LITMUS_TOKEN=...

    python plc/litmus/provision.py               # mints its own token from LITMUS_PASSWORD

VERIFIED end-to-end (2026-07-01): device + all 11 registers create, and Litmus
polls the PLC with ZERO modbus exceptions (DC bus, freq, current, voltage, cmd,
status, fault via FC3 holding; motor/comm/estop/wiring via FC1 coils).

NOTE: the loopedge-dh poller caches its register set -- after add/deletes it may
keep polling stale registers. Restart the driver to reload:
    docker exec le /command/s6-svc -r /run/service/loopedge-dh
"""
import argparse, json, os, ssl, urllib.request

BASE = os.getenv("LITMUS_BASE", "https://localhost:8443")
AUTH_LOGIN = os.getenv("LITMUS_AUTH_LOGIN", BASE.rstrip("/") + "/auth/v2/login")
MODBUS_TCP_DRIVER = "2AF1FA08-D638-11E9-BB65-2A2AE2DBCCE4"  # GET /devicehub/drivers
_CTX = ssl.create_default_context(); _CTX.check_hostname = False; _CTX.verify_mode = ssl.CERT_NONE

# VERIFIED live map. Litmus register class code -> Modbus function:
#   name="H" -> FC3 Holding registers   (valueType "word" = unsigned 16-bit)
#   name="C" -> FC1 Coils               (valueType "bit")
# addresses are 0-based (device property "Zero-Based Addressing"="1") and are all
# confirmed to EXIST on the sparse Micro820 map (single-read scan, no exception 2).
HOLDING = [  # (TagName, address)  read as name="H", valueType="word"
    ("vfd_dc_bus", 109), ("vfd_frequency", 106), ("vfd_current", 107),
    ("vfd_voltage", 108), ("vfd_cmd_word", 114), ("vfd_status_word", 117),
    ("vfd_fault_code", 118),
]
COILS = [  # (TagName, address)  read as name="C", valueType="bit"
    ("motor_running", 0), ("vfd_comm_ok", 3), ("e_stop_active", 5),
    ("estop_wiring_fault", 9),
]


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
    body = json.dumps({"username": os.getenv("LITMUS_USER", "admin"),
                       "password": os.getenv("LITMUS_PASSWORD", "Factory2026!")}).encode()
    req = urllib.request.Request(AUTH_LOGIN, data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, context=_CTX, timeout=15) as r:
        return json.load(r)["jwtAccess"]


def device_body(name, host, port, unit):
    # every properties value MUST be a string (map[string]string).
    return {"name": name, "driverId": MODBUS_TCP_DRIVER,
            "properties": {"networkAddress": host, "networkPort": str(port),
                           "stationId": str(unit), "Zero-Based Addressing": "1"}}


def register_body(device_id, cls, tag, address, value_type):
    # NOTE: address is an INT here (register bodies are typed; device props are strings).
    return {"deviceId": device_id, "name": cls, "TagName": tag,
            "address": int(address), "valueType": value_type}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="conv-101")
    ap.add_argument("--host", default=os.getenv("PLC_HOST", "192.168.1.100"))
    ap.add_argument("--port", type=int, default=502)
    ap.add_argument("--unit", type=int, default=1)
    args = ap.parse_args()

    token = os.getenv("LITMUS_TOKEN")
    if not token:
        try:
            token = mint_token(); print("Minted a token from LITMUS_PASSWORD.")
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

    ok = 0
    for tag, addr in HOLDING:
        st, resp = _call("POST", "/devicehub/registers", token, register_body(device_id, "H", tag, addr, "word"))
        ok += st in (200, 201); print("  H  %-20s @%-3d -> HTTP %s" % (tag, addr, st))
    for tag, addr in COILS:
        st, resp = _call("POST", "/devicehub/registers", token, register_body(device_id, "C", tag, addr, "bit"))
        ok += st in (200, 201); print("  C  %-20s @%-3d -> HTTP %s" % (tag, addr, st))

    n = len(HOLDING) + len(COILS)
    print("\nDone: %d/%d registers provisioned." % (ok, n))
    print("Reload the poller so it drops any stale registers:\n"
          "  docker exec le /command/s6-svc -r /run/service/loopedge-dh")
    print("Then read through Litmus:\n"
          "  LITMUS_API_KEY=... python plc/litmus/mira_on_litmus.py --source litmus --device-id %s" % device_id)
    return 0 if ok == n else 1


if __name__ == "__main__":
    raise SystemExit(main())
