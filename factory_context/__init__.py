"""factory_context — FactoryLM's deterministic contextualizer (Phase 1).

Turns a parsed evidence export (Phase 0's interrogated Ignition tag export) into an
*approval-ready* contextual factory model + a UNS draft:

    evidence export -> contextual factory model -> UNS draft -> approval-ready suggestions

Every entity/signal/relationship is a SUGGESTION carrying source evidence, a confidence band, the
reason it exists, the human approval it needs, and an approval status (suggested / approved /
rejected / needs_review). Nothing inferred is presented as fact.

Synthesizer-free: this package builds context only. It never simulates, opens a broker, or talks to
a PLC. Deterministic + stdlib-only (+ the in-repo mira_plc_parser). Read-only.
"""
