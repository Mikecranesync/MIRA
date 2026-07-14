"""Canonical extraction record — the shared shape every route emits.

One record = one fault or one parameter, source-preserved. String ``id``
always (never an invented integer for a mnemonic code — a hard rule from the
G+ Mini / int-keyed-loader lesson). Every record carries its own page + bbox +
verbatim excerpt so ``evidence_validator`` can prove it against the PDF and
nothing ships uncited.
"""
from __future__ import annotations

from typing import Any


def make_record(
    *,
    record_type: str,       # "fault" | "parameter"
    ident: str,             # source-preserved id string (casing/punct intact)
    id_kind: str,           # "numeric" | "alnum" | "dotted" | "mnemonic"
    name: str,
    fields: dict[str, str],
    page: int,
    bbox: tuple[float, float, float, float] | None,
    excerpt: str,
    route: str,
    confidence: float,
    field_evidence: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "record_type": record_type,
        "id": ident,
        "id_kind": id_kind,
        "name": name.strip(),
        "fields": {k: v.strip() for k, v in fields.items() if v and v.strip()},
        "page": page,
        "bbox": list(bbox) if bbox else None,
        "excerpt": excerpt.strip(),
        "route": route,
        "confidence": round(float(confidence), 3),
        "field_evidence": field_evidence or {},
        "validated": False,     # set True by evidence_validator
    }
