"""ProveIt Conv_Simple demo — the narrow MQTT/UNS nervous-system path.

deterministic event -> MQTT UNS topic -> explanation request -> evidence-backed answer card.

Reuses the existing `mqtt_uns.broker.InMemoryBroker` (real +/# topic semantics, deterministic, no
external broker). NO Ignition, NO OPC-UA, NO OpenPLC, NO Modbus expansion — one clean path only. The
card produced through MQTT must equal the offline card byte-for-byte (transport preserves the answer).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
for _p in (str(HERE), str(ROOT / "mqtt_uns")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import broker as bk  # noqa: E402  (mqtt_uns.broker)
import conv_simple_demo as demo  # noqa: E402


def event_topic(uns: str) -> str:
    """UNS path -> UNS-shaped MQTT topic (dots -> slashes), terminating in /events."""
    return uns.replace(".", "/") + "/events"


def make_event(scenario: demo.Scenario) -> str:
    """Deterministic JSON event carrying only the observation (no clock, no answer)."""
    return json.dumps(
        {
            "scenario_id": scenario.id,
            "symptom": scenario.symptom,
            "asset_uns": f"{demo.UNS_ROOT}.conveyor",
            "abnormal": scenario.abnormal,
            "healthy": scenario.healthy,
        },
        sort_keys=True,
    )


def run_round_trip(scenario: demo.Scenario, manifest: dict) -> dict:
    """Publish the event to its UNS topic, receive it, and reconstruct the answer card on the far side."""
    offline_card = demo.render_card(demo.build_answer_card(scenario, manifest))

    transport = bk.InMemoryBroker()
    received: list = []
    transport.subscribe("#", lambda topic, payload: received.append((topic, payload)))

    topic = event_topic(f"{demo.UNS_ROOT}.conveyor")
    delivered = transport.publish(topic, make_event(scenario))

    # Subscriber side: deserialize the event -> explanation request -> rebuild the card.
    _, payload = received[0]
    ev = json.loads(payload)
    sc = demo.SCENARIOS[ev["scenario_id"]]
    mqtt_card = demo.render_card(demo.build_answer_card(sc, manifest))

    return {
        "topic": topic,
        "delivered": delivered,
        "payload": payload,
        "offline_card": offline_card,
        "mqtt_card": mqtt_card,
        "match": offline_card == mqtt_card,
    }
