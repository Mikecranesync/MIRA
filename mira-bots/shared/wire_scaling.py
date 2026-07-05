"""The Ignition per-tag scaling contract — the pure trust boundary for analog
assessment on the Ignition wire path.

Background: ``ignition_chat.py`` receives live tags as ``{full_path: value}``
where an analog value like ``vfd_dc_bus = 3200`` is ambiguous — it could be a
raw register (×0.1 → 320 V) or an already-scaled engineering value (3200 V).
``live_snapshot.assess_from_paths`` therefore abstains on analog (ADR-0025 §4 —
"confidently wrong is worse than no answer"). This module removes the guess:
it converts a wire value to engineering units ONLY when the tag carries an
explicit, trusted scaling mode. When the mode is ``unknown`` (or the input is
un-coercible), it returns ``None`` and the caller stays silent.

Pure by construction: no I/O, no DB, no pack import. The pack-register scale
fallback for a ``raw_register`` tag with no explicit ``scale`` lives in
``live_snapshot`` (which already holds the pack), NOT here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

ScalingMode = Literal["raw_register", "engineering_value", "unknown"]

_MODES: frozenset[str] = frozenset({"raw_register", "engineering_value", "unknown"})


@dataclass(frozen=True)
class TagScaling:
    """Explicit scaling for one Ignition analog tag.

    ``mode``:
      - ``raw_register``     — multiply the wire value by ``scale`` to get
        engineering units (``scale`` required; a ``None`` scale abstains).
      - ``engineering_value``— the wire value is already engineering units.
      - ``unknown``          — do not assess (the safe default).

    ``source`` is a short provenance phrase rendered on the diagnostic card so
    the assessment can explain why it is trustworthy.
    """

    mode: ScalingMode
    scale: float | None = None
    unit: str | None = None
    source: str = "approved tag mapping"


def _coerce_float(v: Any) -> float | None:
    """Best-effort float coercion; ``None`` on anything non-numeric (incl. bool,
    which is never a live analog reading)."""
    if isinstance(v, bool) or v is None:
        return None
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def to_engineering(raw: Any, scaling: TagScaling) -> float | None:
    """Convert a raw wire value to engineering units per the scaling contract.

    Returns ``None`` (caller abstains) when the mode is ``unknown``, a
    ``raw_register`` tag has no ``scale``, or ``raw`` is not coercible to a
    number. Never guesses.
    """
    if scaling.mode == "unknown":
        return None
    value = _coerce_float(raw)
    if value is None:
        return None
    if scaling.mode == "engineering_value":
        return value
    if scaling.mode == "raw_register":
        if scaling.scale is None:
            return None
        return value * scaling.scale
    return None


def from_jsonb(scaling_jsonb: Any, *, unit: str | None = None) -> TagScaling:
    """Build a ``TagScaling`` from the ``tag_entities.scaling`` column value.

    The value we write is the contract verbatim — ``{"mode": "raw_register",
    "scale": 0.1}`` (the column is otherwise unpopulated, so we own the shape).
    A ``NULL``/absent value, a non-dict, an unrecognized ``mode``, or a dict
    with no ``mode`` (e.g. migration 025's documented linear-map shape) all map
    to ``unknown`` — we never infer a mode we weren't given. ``unit`` comes from
    the sibling ``tag_entities.units`` column.
    """
    if not isinstance(scaling_jsonb, dict):
        return TagScaling(mode="unknown", unit=unit)
    mode = scaling_jsonb.get("mode")
    if mode not in _MODES:
        return TagScaling(mode="unknown", unit=unit)
    scale = scaling_jsonb.get("scale")
    scale_f = (
        float(scale) if isinstance(scale, (int, float)) and not isinstance(scale, bool) else None
    )
    return TagScaling(mode=mode, scale=scale_f, unit=unit)  # type: ignore[arg-type]
