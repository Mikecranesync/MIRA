"""UNS draft path generation.

Reuses the in-repo `mira_plc_parser.uns.slug` (never reinvents a path builder, per
`.claude/rules/uns-compliance.md`). Produces *proposed* lowercase UNS paths for entities and live
signals; a signal's category segment is derived from its archetype so the draft is legible.

These are DRAFTS -- proposals for human approval, not asserted facts. The build layer attaches a
confidence + evidence + status to every path it emits.
"""
from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_PARSER = _HERE.parent / "mira-plc-parser"
if str(_PARSER) not in sys.path:
    sys.path.insert(0, str(_PARSER))

from mira_plc_parser.uns import slug  # noqa: E402

# archetype -> UNS category segment for the signal leaf. static_metadata is excluded from the draft
# (it is scaffolding, not a live signal); unknown is parked under "unclassified" for review.
_CATEGORY = {
    "live_bool": "status",       # Running / Blocked / Starved
    "live_counter": "production",  # Counts.*
    "live_state": "status",      # State.*
    "live_analog": "process",    # level / flow / temp / pressure
    "live_fault": "faults",      # Fault / Alarm / Trip bits
    "live_setpoint": "setpoints",  # SP / Cmd / Target
    "unknown": "unclassified",
}

LIVE_ARCHETYPES = ("live_bool", "live_counter", "live_state", "live_analog", "live_fault", "live_setpoint")


def entity_uns_path(path_segments: list[str]) -> str:
    """Slug each raw segment and join with '.' -> an ltree-style UNS path."""
    return ".".join(slug(s) for s in path_segments if s)


def signal_category(archetype: str) -> str | None:
    """The UNS category segment for a signal archetype, or None if it has no draft path."""
    return _CATEGORY.get(archetype)


def signal_uns_path(asset_path_segments: list[str], dotted_signal: str, archetype: str) -> str | None:
    """`<enterprise.site.area.line.asset>.<category>.<signal_slug>`, or None for excluded archetypes."""
    cat = signal_category(archetype)
    if cat is None:
        return None
    base = entity_uns_path(asset_path_segments)
    return f"{base}.{cat}.{slug(dotted_signal)}"
