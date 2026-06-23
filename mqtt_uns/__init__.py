"""mqtt_uns — the narrowest possible nervous-system layer (Phase 4).

MQTT is ONLY the transport. The evidence graph and the explanation engine remain the source of truth.
The one thing this proves:

    deterministic event -> MQTT publish (UNS topic) -> MQTT receive -> explanation request ->
    IDENTICAL evidence-backed Ask-MIRA answer card.

Transport is an in-process broker with real MQTT topic/wildcard semantics so the whole path is
deterministic and testable with no external broker. The same `Transport` seam accepts a real client
(paho/aiomqtt against a local broker) later without changing the brain.

Strictly out of scope: Ignition, OpenPLC, Modbus, OPC-UA, Sparkplug, PLC simulators, historian/CMMS
integrations, dashboards, web UI, live plant, broker clustering.
"""
