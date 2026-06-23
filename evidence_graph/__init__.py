"""evidence_graph — the evidence-grounding & explainability engine (Phase 3).

Answers the one question maintenance personnel actually ask: "How do you know?"

Every maintenance conclusion is traceable to evidence through a graph:
    Cause -> Asset -> Signal -> UNS Path -> Manual -> Procedure -> Historical Event ->
    Known Failure Mode -> Technician Action

The objective is not better AI; it is AUDITABLE reasoning. Every Ask-MIRA answer exposes its evidence
chain (supporting AND contradicting), with citations. No anonymous facts; no unsupported claims.

Deterministic, stdlib-only, built on Phases 0-2. Strictly brain-side: NO MQTT, Sparkplug, OPC-UA,
Modbus, OpenPLC, Ignition, broker, live pipeline, or PLC simulator.
"""
