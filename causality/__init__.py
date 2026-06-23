"""causality — the deterministic maintenance-causality engine (Phase 2).

NOT a factory simulator. Its only job is to make Ask MIRA look intelligent: given a symptom, explain
the likely hidden cause, the chain of effects, the supporting tags, the related manual pages, and the
technician checks.

    FactoryLM discovers the factory (Phase 1)  ->  this engine simulates CAUSES, not machines  ->
    MIRA explains the behavior (the product).

The simulator part is a machine that creates realistic symptoms (`inject`); the product is the
explanation (`explain`). Built ON the Phase 1 context model -- it never invents a factory. Deterministic,
stdlib-only. No simulator runtime, no MQTT, no broker, no PLC, no protocol.
"""
