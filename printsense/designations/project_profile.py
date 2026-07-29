"""Project-legend ingestion (D16).

A legend rule may EXTEND interpretation only when package-scoped, explicit,
and provenance-carrying; a conflict with registry candidates produces an
AMBIGUITY, never a silent override. Generated rules are proposals — nothing
here persists anything."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class LegendRule:
    source_page: str | None
    source_region: str | None
    raw_text: str
    mapping: dict
    human_confirmation_status: str = "proposed"
    confidence: float = 0.5
    scope: str = "package"
    provenance: dict = field(default_factory=dict)


def assert_pending_never_frozen(record: dict) -> None:
    """Production invariant (Safety law 11 / D12): a record whose
    human_confirmation_status is 'pending' can never carry a frozen truth.
    Raised, not warned — freezing requires the human step."""
    if record.get("human_confirmation_status") == "pending" and \
            record.get("truth_status") == "frozen_human_confirmed":
        raise AssertionError(
            "pending human confirmation cannot coexist with a frozen truth")


def legend_conflicts(legends: list[LegendRule] | None, class_code: str,
                     candidate_meanings: list[str]) -> list[dict]:
    """Return ambiguity entries for legend/registry disagreement on a class
    code. The legend NEVER silently wins (D16); selection stays None until a
    human confirms."""
    out: list[dict] = []
    for rule in legends or []:
        if rule.mapping.get("class_code", "").upper() != class_code.upper():
            continue
        meaning = rule.mapping.get("meaning")
        if meaning and meaning not in candidate_meanings:
            out.append({
                "kind": "legend_conflict",
                "class_code": class_code,
                "legend_meaning": meaning,
                "registry_candidates": candidate_meanings,
                "legend_status": rule.human_confirmation_status,
                "legend_confidence": rule.confidence,
                "resolution": "requires_human_confirmation",
            })
    return out
