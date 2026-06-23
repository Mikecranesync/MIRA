"""The narrow MQTT/UNS path preserves the answer card (transport changes nothing)."""
from __future__ import annotations

import sys
from pathlib import Path

DEMO = Path(__file__).resolve().parents[1]
for _p in (str(DEMO), str(DEMO.parent / "mqtt_uns")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import conv_simple_demo as demo  # noqa: E402
import mqtt_demo  # noqa: E402

MANIFEST = demo.load_manifest()


def test_event_topic_is_uns_shaped():
    t = mqtt_demo.event_topic(f"{demo.UNS_ROOT}.conveyor")
    assert t == "enterprise/proveit/bench/conv_simple/conveyor/events"


def test_round_trip_delivers_and_preserves_the_card():
    rt = mqtt_demo.run_round_trip(demo.FLAGSHIP, MANIFEST)
    assert rt["delivered"] == 1
    assert rt["match"] is True, "MQTT answer card must equal the offline card byte-for-byte"
    assert "Most likely cause" in rt["mqtt_card"]
    assert "photoeye" in rt["mqtt_card"].lower()


def test_round_trip_is_deterministic():
    a = mqtt_demo.run_round_trip(demo.FLAGSHIP, MANIFEST)["mqtt_card"]
    b = mqtt_demo.run_round_trip(demo.FLAGSHIP, MANIFEST)["mqtt_card"]
    assert a == b
