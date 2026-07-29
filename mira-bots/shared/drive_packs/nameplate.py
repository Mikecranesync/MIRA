"""Nameplate-photo → drive-pack resolution (ADR-0025 §1a, Task 4).

The signature mobile moment: a technician photographs a drive nameplate, the
structured-vision path (``mira-core/mira-ingest``) extracts a shape like
``{"component": "GS20 VFD", "symptom": "F004 fault", "condition": "faulted",
"description": "..."}``, and this module maps that dict to a
:class:`~shared.drive_packs.schema.DrivePack` by reusing Task 1's
``resolve_pack(text)`` two-pass family-first matcher.

Hard boundary (ADR-0025 + ``.claude/rules/fieldbus-readonly.md``): pure glue,
no vision/LLM call, no network, no DB. The caller runs vision first and hands
the already-produced dict here.
"""

from __future__ import annotations

from typing import Any

from .loader import resolve_pack
from .schema import DrivePack

# Identifying fields, in preference order. "symptom"/"condition" describe the
# fault, not the drive family, so they are deliberately excluded — including
# them risks a false match (e.g. a fault message that happens to contain
# another family's alias).
_IDENTIFYING_FIELDS = ("component", "manufacturer", "model", "description")


def _text_field(vision_output: dict[str, Any], key: str) -> str:
    """Best-effort string coercion of a vision-dict field.

    Missing keys, ``None`` values, and non-string values (numbers, etc.) all
    degrade to ``""`` rather than raising — a malformed vision dict must never
    crash resolution.
    """
    value = vision_output.get(key)
    if not value:
        return ""
    return str(value)


def resolve_pack_from_vision(vision_output: dict[str, Any] | None) -> DrivePack | None:
    """Map a structured-vision output dict to its matching :class:`DrivePack`.

    Extracts the identifying text (``component``, ``manufacturer``, ``model``,
    ``description`` — never ``symptom``/``condition``, which describe the
    fault rather than the drive) and runs it through the existing
    ``resolve_pack(text)``. Family-first precedence is entirely
    ``resolve_pack``'s — this function does not reimplement any matching.

    Returns ``None`` (never raises) for a missing/``None``/non-dict input, an
    empty dict, or a component this repo has no pack for (e.g. "GS20 VFD" —
    GS20 is a real sibling model of GS10, but not GS10, and there is no GS20
    pack yet; returning ``None`` here is the honest answer, not a guess).
    """
    if not isinstance(vision_output, dict):
        return None

    parts = [_text_field(vision_output, field) for field in _IDENTIFYING_FIELDS]
    combined = " ".join(part for part in parts if part)
    if not combined:
        return None

    return resolve_pack(combined)
