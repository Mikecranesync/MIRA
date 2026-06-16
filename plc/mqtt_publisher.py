#!/usr/bin/env python3
r"""
mqtt_publisher.py -- MIRA PLC edge publisher (MQTT route)

Polls the Conv_Simple Modbus TCP slave (Micro 820 + GS10) and publishes a
decoded JSON snapshot to an MQTT broker. This is the "edge node" half of the
MQTT/Sparkplug-style pipeline: it runs on something that can reach the PLC's
isolated control network (the laptop today; a dedicated edge gateway later) and
pushes OUTBOUND to the broker -- nothing ever reaches into the OT network.

Pipeline:  PLC :502  ->  this publisher  ->  MQTT broker  ->  web dashboard

Usage:
    pip install pymodbus paho-mqtt
    python plc/mqtt_publisher.py --broker 100.68.120.99
    python plc/mqtt_publisher.py --broker 100.68.120.99 --interval 1.0 --plc-host 192.168.1.100

The payload is published RETAINED so a browser that connects later immediately
gets the last known state.
"""

import argparse
import json
import time

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:  # pymodbus < 3.0 fallback
    from pymodbus.client.sync import ModbusTcpClient

import paho.mqtt.client as mqtt

# -- Deployed Conv_Simple_1.5 slave map (pymodbus 0-based addresses) ----------
# Only these sub-blocks are mapped on the slave; reading across an unmapped
# address raises a Modbus exception, so we read each block separately.
COIL_SEGMENTS = [(0, 1), (3, 1), (5, 1), (9, 1), (11, 5), (16, 4)]
HR_SEGMENTS = [(106, 4), (114, 1)]
CMD_NAMES = {1: "STOP", 18: "FWD+RUN", 20: "REV+RUN", 7: "RESET"}


def read_plc(client):
    """Return a decoded snapshot dict, or None if the slave can't be read."""
    coils = {}
    regs = {}
    for base, count in COIL_SEGMENTS:
        r = client.read_coils(address=base, count=count)
        if r.isError():
            return None
        for i in range(count):
            coils[base + i] = bool(r.bits[i])
    for base, count in HR_SEGMENTS:
        r = client.read_holding_registers(address=base, count=count)
        if r.isError():
            return None
        for i in range(count):
            regs[base + i] = r.registers[i]

    cmd = regs.get(114, 0)
    return {
        "online": True,
        "motor_running": coils.get(0, False),
        "vfd_comm_ok": coils.get(3, False),      # trust gate: if false, HRs stale
        "e_stop_active": coils.get(5, False),
        "estop_wiring_fault": coils.get(9, False),
        "di": {                                   # raw digital inputs
            "selector_fwd": coils.get(11, False),
            "selector_rev": coils.get(12, False),
            "estop_nc": coils.get(13, False),
            "estop_no": coils.get(14, False),
            "pb_run": coils.get(15, False),
        },
        "do": {                                   # raw digital outputs
            "light_green": coils.get(16, False),
            "light_red": coils.get(17, False),
            "contactor": coils.get(18, False),
            "pb_run_led": coils.get(19, False),
        },
        "vfd": {
            "freq_hz": regs.get(106, 0) / 100.0,
            "current_a": regs.get(107, 0) / 100.0,
            "voltage_v": regs.get(108, 0) / 10.0,
            "dc_bus_v": regs.get(109, 0) / 10.0,
            "cmd_word": cmd,
            "cmd_name": CMD_NAMES.get(cmd, str(cmd)),
        },
    }


def main():
    p = argparse.ArgumentParser(description="MIRA PLC MQTT edge publisher")
    p.add_argument("--plc-host", default="192.168.1.100")
    p.add_argument("--plc-port", type=int, default=502)
    p.add_argument("--broker", required=True, help="MQTT broker host (e.g. VPS Tailscale IP)")
    p.add_argument("--broker-port", type=int, default=1883)
    p.add_argument("--topic", default="mira/plc/conv_simple")
    p.add_argument("--interval", type=float, default=1.0)
    args = p.parse_args()

    try:  # paho-mqtt 2.x requires an explicit callback API version
        mc = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id="mira-plc-edge")
    except (AttributeError, TypeError):  # paho-mqtt 1.x
        mc = mqtt.Client(client_id="mira-plc-edge")
    mc.will_set(args.topic, json.dumps({"online": False}), qos=1, retain=True)
    mc.connect(args.broker, args.broker_port, keepalive=30)
    mc.loop_start()
    print(f"[edge] PLC {args.plc_host}:{args.plc_port} -> broker {args.broker}:{args.broker_port} topic '{args.topic}'")

    client = ModbusTcpClient(args.plc_host, port=args.plc_port, timeout=2)
    last_log = 0
    while True:
        try:
            if not client.connected:
                client.connect()
            snap = read_plc(client)
            if snap is None:
                payload = {"online": False, "ts": time.time()}
            else:
                snap["ts"] = time.time()
                payload = snap
            mc.publish(args.topic, json.dumps(payload), qos=0, retain=True)
            if time.time() - last_log > 10:
                dc = payload.get("vfd", {}).get("dc_bus_v", "-")
                print(f"[edge] online={payload.get('online')} dc_bus={dc}V cmd={payload.get('vfd',{}).get('cmd_name','-')}")
                last_log = time.time()
        except Exception as e:
            mc.publish(args.topic, json.dumps({"online": False, "err": str(e)[:80], "ts": time.time()}), qos=0, retain=True)
            print(f"[edge] error: {e}")
            try:
                client.close()
            except Exception:
                pass
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
