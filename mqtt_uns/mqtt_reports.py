"""Render the Phase 4 MQTT round-trip report (named mqtt_reports to avoid colliding with
evidence_graph/reports.py on the shared path)."""
from __future__ import annotations

import json


def round_trip_dict(event, topic, published_payload, received_payload, match: bool) -> dict:
    return {
        "event_type": event.event_type,
        "asset_uns": event.asset_uns,
        "topic": topic,
        "published_payload": published_payload,
        "received_payload": received_payload,
        "payload_identical": published_payload == received_payload,
        "answer_card_matches_offline": match,
    }


def render_round_trip(event, topic, published_payload, received_payload, offline_card, mqtt_card) -> str:
    match = offline_card == mqtt_card
    L = []
    L.append("# Phase 4 — MQTT nervous-system round trip")
    L.append("")
    L.append("MQTT is only the transport. The answer card below was produced AFTER the event crossed MQTT;")
    L.append("it must match the offline card byte-for-byte.")
    L.append("")
    L.append("## The event")
    L.append("- type: `%s`  ·  asset: `%s`" % (event.event_type, event.asset_uns))
    L.append("- UNS topic: `%s`" % topic)
    L.append("")
    L.append("## Transport")
    L.append("- published payload == received payload: **%s**" % (published_payload == received_payload))
    L.append("- answer card (via MQTT) == answer card (offline): **%s**" % match)
    L.append("")
    L.append("```json")
    L.append(json.dumps(json.loads(published_payload), indent=2, ensure_ascii=False))
    L.append("```")
    L.append("")
    L.append("## Answer card (produced through MQTT)")
    L.append("```")
    L.append(mqtt_card)
    L.append("```")
    return "\n".join(L)
