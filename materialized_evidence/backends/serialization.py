"""(De)serialization for durable registry backends (PR G).

The pure contract serializes via ``EvidenceManifest.to_dict()`` /
``schema._enum_safe`` (enums -> ``.value`` strings, the ``time_range`` tuple ->
a list). A durable backend that persists JSON needs the inverse: rebuild the
frozen dataclasses, coercing the enum fields and ``time_range`` back. Hydration
filters to declared fields so an older backend can read a snapshot that carries
newer, unknown keys.
"""

from __future__ import annotations

import dataclasses
from enum import Enum
from typing import Any

from ..registry import StatusOverlay
from ..schema import (
    ApprovalStatus,
    DatasetType,
    Environment,
    EvidenceManifest,
    StageStatus,
    StaleState,
    TrustStatus,
    _enum_safe,
)

# manifest field name -> the enum class its stored ``.value`` string re-inflates to
_MANIFEST_ENUM_FIELDS = {
    "dataset_type": DatasetType,
    "environment": Environment,
    "stage_status": StageStatus,
    "trust_status": TrustStatus,
    "approval_status": ApprovalStatus,
    "stale_state": StaleState,
}


def manifest_from_dict(d: dict[str, Any]) -> EvidenceManifest:
    """Rebuild an ``EvidenceManifest`` from its ``to_dict()`` form (or a JSON
    snapshot of it). Coerces the enum fields and the ``time_range`` tuple; ignores
    unknown keys so an older backend can hydrate a newer snapshot."""
    fields = {f.name for f in dataclasses.fields(EvidenceManifest)}
    kwargs: dict[str, Any] = {}
    for key, val in d.items():
        if key not in fields:
            continue
        if key == "time_range" and val is not None:
            kwargs[key] = tuple(val)
        elif key in _MANIFEST_ENUM_FIELDS and val is not None and not isinstance(val, Enum):
            kwargs[key] = _MANIFEST_ENUM_FIELDS[key](val)
        else:
            kwargs[key] = val
    return EvidenceManifest(**kwargs)


def overlay_to_dict(o: StatusOverlay) -> dict[str, Any]:
    """Enum-safe dict for a ``StatusOverlay`` (it has no ``to_dict`` of its own)."""
    return _enum_safe(dataclasses.asdict(o))


def overlay_from_dict(d: dict[str, Any]) -> StatusOverlay:
    """Rebuild a ``StatusOverlay``, coercing its ``stale_state`` enum; ignores
    unknown keys."""
    fields = {f.name for f in dataclasses.fields(StatusOverlay)}
    kwargs: dict[str, Any] = {}
    for key, val in d.items():
        if key not in fields:
            continue
        if key == "stale_state" and val is not None and not isinstance(val, Enum):
            val = StaleState(val)
        kwargs[key] = val
    return StatusOverlay(**kwargs)
