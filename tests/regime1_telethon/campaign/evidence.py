"""Structured turn evidence — the flight-recorder shape.

The current ledger (`ledger.py`) records what the WIRE could see: technician
text, MIRA text, a grade. Its own docstring is explicit that "server-side facts
the wire cannot see (routes, gates, tool calls) are NOT recorded here". That is
why the interesting bugs are invisible to it: MIRA resolves the wrong asset,
retrieval therefore searches the wrong corpus, the answer cites a real parameter
from that wrong corpus, and every single-layer detector reports green.

This module defines the object those cross-layer invariants need. It is
deliberately NOT a new ledger format yet — it is the in-memory evidence a
producer (replay today, direct/Telethon execution later) hands to detectors.

Backwards compatibility is a hard requirement: every field except the turn index
is optional, so evidence reconstructed from a 2026-08 ledger (text only) is a
valid object that simply carries fewer observations. Detectors MUST treat
`None` as "not observed", never as "absent" — the same fail-safe direction
`fabrication.CorpusIndex` uses for an unresolved token.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class TurnEvidence:
    """One technician turn and everything observed about MIRA's handling of it.

    Field groups mirror the layers a cross-boundary bug crosses:
      identity   — scenario/seed/strategy, so a finding is reproducible
      wire       — what was said, the only thing old ledgers have
      routing    — how the turn was dispatched
      state      — FSM before/after, the carryover and escalation counters
      uns        — which machine MIRA thinks it is talking about
      retrieval  — what evidence backed the answer (ids/metadata, never content)
      guards     — deterministic decisions taken on the way out
      runtime    — provider/latency, for cost and flake analysis
    """

    index: int

    # -- wire -------------------------------------------------------------
    technician_message: str = ""
    mira_reply: str = ""

    # -- identity ---------------------------------------------------------
    scenario_id: str | None = None
    seed: int | None = None
    technician_strategy: str | None = None
    trace_id: str | None = None

    # -- routing ----------------------------------------------------------
    router_intent: str | None = None
    router_confidence: float | None = None
    dispatch_kind: str | None = None

    # -- state ------------------------------------------------------------
    fsm_before: str | None = None
    fsm_after: str | None = None
    asset_identified: str | None = None
    pending_question: bool | None = None
    state_counters: dict[str, Any] = field(default_factory=dict)

    # -- uns --------------------------------------------------------------
    uns_manufacturer: str | None = None
    uns_model: str | None = None
    uns_fault_code: str | None = None
    uns_confidence: float | None = None

    # -- retrieval (identifiers + metadata ONLY, never corpus content) -----
    retrieved_ids: list[str] = field(default_factory=list)
    retrieved_meta: list[dict] = field(default_factory=list)
    citations: list[str] = field(default_factory=list)
    # The query retrieval was actually asked, and whether a vector embedding
    # backed it. `retrieval_embedded=False` means the Ollama sidecar was
    # unreachable, so recall_knowledge ran lexical streams only — a WEAKER
    # retrieval than production. A detector comparing runs must not mix the
    # two; see retrieval_probe.py's docstring.
    retrieval_query: str | None = None
    retrieval_embedded: bool | None = None
    # Per parameter-shaped token in the reply: was it present in what was
    # retrieved for this turn? The #3165 measurement — sharper than
    # fabrication.CorpusIndex, which can only ask whether a token exists
    # anywhere in the corpus.
    param_support: list[dict] = field(default_factory=list)

    # -- guards -----------------------------------------------------------
    engine_markers: list[str] = field(default_factory=list)

    # -- runtime ----------------------------------------------------------
    inference_backend: str | None = None
    latency_ms: float | None = None

    def observed(self, name: str) -> bool:
        """True when `name` was actually recorded.

        The distinction detectors must respect: a historical ledger yields
        evidence where `router_intent is None` because nobody logged it, NOT
        because routing did not happen.
        """
        value = getattr(self, name, None)
        if isinstance(value, (list, dict)):
            return bool(value)
        return value is not None


@dataclass
class ConversationEvidence:
    """A whole conversation plus how it was produced."""

    conv_id: str
    turns: list[TurnEvidence] = field(default_factory=list)
    backend: str = "unknown"  # replay | direct | telethon
    source_campaign: str | None = None
    mira_sha: str | None = None
    notes: dict[str, Any] = field(default_factory=dict)

    def transcript(self) -> list[dict]:
        """The shape `gates.check_conversation` already consumes.

        Lets every existing detector run unchanged against replayed output,
        which is the whole point of unifying on this object.
        """
        out: list[dict] = []
        for t in self.turns:
            if t.technician_message:
                out.append({"role": "tech", "text": t.technician_message})
            if t.mira_reply:
                out.append({"role": "mira", "text": t.mira_reply})
        return out

    def markers(self) -> set[str]:
        """Every engine marker seen anywhere in the conversation."""
        seen: set[str] = set()
        for t in self.turns:
            seen.update(t.engine_markers)
        return seen
