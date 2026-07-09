"""Pure dataclasses over one `wiring_connections` row / one asset's wiring.

Doctrine enforced here (see `docs/specs` + migration 026):
- Only `approval_state == 'verified'` is TRUSTED. `proposed`/`needs_review`/
  `rejected` are readable but never trusted — `MachineWiringProfile.trusted()`
  is the ONLY set callers should build an answer from.
- Never invent. Optional fields (`wire_number`, `cable_id`, `gauge_awg`,
  `color`, `function_class`, `drawing_reference`, `proposed_by`) stay `None`
  when the source data doesn't have them; `function_class='unknown'` stays
  `'unknown'` (a valid CHECK value) rather than being coerced to `None` or
  upgraded to a guess.
- No I/O here — this module is pure data + pure lookups.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

_TRUSTED_STATE = "verified"


def normalize(token: str) -> str:
    """Strip + upper-case a wire/terminal token for consistent matching."""
    return (token or "").strip().upper()


@dataclass(frozen=True)
class WiringConnection:
    """One `wiring_connections` row. Frozen — a connection is a fact as read,
    never mutated in place."""

    source_entity_id: str
    source_terminal: str
    dest_entity_id: str
    dest_terminal: str
    wire_number: Optional[str]
    cable_id: Optional[str]
    gauge_awg: Optional[int]
    color: Optional[str]
    function_class: Optional[str]  # may be None or 'unknown' — NEVER fabricated
    drawing_reference: Optional[str]
    approval_state: str
    proposed_by: Optional[str]
    evidence_summary: dict[str, Any] = field(default_factory=dict)

    def is_trusted(self) -> bool:
        """The approval gate — the ONLY thing that makes a row trustworthy."""
        return self.approval_state == _TRUSTED_STATE

    def is_sourced(self) -> bool:
        """Has provenance: a drawing reference AND some evidence."""
        return bool(self.drawing_reference) and bool(self.evidence_summary)

    def source_label(self) -> str:
        """Human-readable source endpoint — prefers the evidence's own label."""
        return str(
            self.evidence_summary.get("from") or f"{self.source_entity_id}:{self.source_terminal}"
        )

    def dest_label(self) -> str:
        """Human-readable dest endpoint — prefers the evidence's own label."""
        return str(self.evidence_summary.get("to") or f"{self.dest_entity_id}:{self.dest_terminal}")

    def has_readable_endpoints(self) -> bool:
        """Both terminals present AND some human-readable evidence backs them
        (an evidence label or a stamped wire number) — not just opaque ids."""
        return (
            bool(self.source_terminal)
            and bool(self.dest_terminal)
            and (
                "from" in self.evidence_summary
                or "to" in self.evidence_summary
                or bool(self.wire_number)
            )
        )

    def is_field_verify_unconfirmed(self) -> bool:
        """Evidence says the model still needs a field check before trust."""
        return self.evidence_summary.get("model_status") == "field_verify"


@dataclass(frozen=True)
class MachineWiringProfile:
    """All known `wiring_connections` rows for one asset, split by approval
    state. `trusted()` (== `approved`) is the only set safe to answer from."""

    asset: str
    tenant_id: Optional[str]
    connections: tuple[WiringConnection, ...]

    @property
    def approved(self) -> tuple[WiringConnection, ...]:
        return tuple(c for c in self.connections if c.is_trusted())

    @property
    def proposed(self) -> tuple[WiringConnection, ...]:
        return tuple(c for c in self.connections if c.approval_state == "proposed")

    @property
    def needs_review(self) -> tuple[WiringConnection, ...]:
        return tuple(c for c in self.connections if c.approval_state == "needs_review")

    @property
    def rejected(self) -> tuple[WiringConnection, ...]:
        return tuple(c for c in self.connections if c.approval_state == "rejected")

    def trusted(self) -> tuple[WiringConnection, ...]:
        """Alias for `approved` — the ONLY trusted set. Prefer this name at
        call sites that are about to answer a question."""
        return self.approved

    def find_by_wire(self, wire_number: str) -> tuple[WiringConnection, ...]:
        """All rows (ANY approval state) whose `wire_number` normalized-
        exact-matches `wire_number`. Caller decides trust via `is_trusted()`.

        Exact match only, after `normalize()` — "200" and "W200" are
        DIFFERENT wires (false-positive guard); no substring/fuzzy matching.
        """
        target = normalize(wire_number)
        if not target:
            return ()
        return tuple(
            c for c in self.connections if c.wire_number and normalize(c.wire_number) == target
        )

    def find_by_terminal(self, terminal: str) -> tuple[WiringConnection, ...]:
        """All rows (ANY approval state) where the normalized source or dest
        terminal equals `terminal`, or the evidence 'from'/'to' label's
        terminal segment (the part after the last '.') equals it."""
        target = normalize(terminal)
        if not target:
            return ()
        hits = []
        for c in self.connections:
            if normalize(c.source_terminal) == target or normalize(c.dest_terminal) == target:
                hits.append(c)
                continue
            for key in ("from", "to"):
                label = c.evidence_summary.get(key)
                if isinstance(label, str) and normalize(_terminal_segment(label)) == target:
                    hits.append(c)
                    break
        return tuple(hits)


def _terminal_segment(label: str) -> str:
    """`"PLC1.I-00"` -> `"I-00"`; a bare label -> itself."""
    return label.rsplit(".", 1)[-1] if "." in label else label
