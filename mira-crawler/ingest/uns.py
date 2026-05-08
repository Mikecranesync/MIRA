"""UNS path helpers shared by the ingest pipeline, the backfill scripts,
and the Hub UNS browse API.

UNS path format (spec §3.1):
    enterprise.{site}.{area}.{line}.{equipment}.{component}.{datapoint}

- Lowercase only.
- Labels are `[a-z0-9_]+`.
- `.` is the path separator.
- Default unassigned form for a freshly-discovered piece of equipment:
    enterprise.unassigned.{manufacturer_slug}.{model_slug}
"""

from __future__ import annotations

import re

_LABEL_RE = re.compile(r"^[a-z0-9_]+$")
_PATH_RE = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)*$")
_NON_LABEL_CHARS = re.compile(r"[^a-z0-9]+")


def slug(value: str) -> str:
    """Normalize a free-form string into a single ltree label.

    Lowercase, collapse runs of non-alphanumeric to `_`, strip leading/
    trailing `_`. Returns empty string if nothing usable remains — the
    caller MUST treat that as a signal not to produce a path segment.
    """
    if not value:
        return ""
    lowered = value.strip().lower()
    cleaned = _NON_LABEL_CHARS.sub("_", lowered).strip("_")
    return cleaned


def is_valid_path(path: str) -> bool:
    """True iff `path` matches the spec's path grammar."""
    return bool(_PATH_RE.match(path))


def is_valid_label(label: str) -> bool:
    return bool(_LABEL_RE.match(label))


def equipment_unassigned_path(manufacturer: str | None, model: str | None) -> str:
    """Build the default `enterprise.unassigned.{mfr}.{model}` path.

    Falls back to `enterprise.unassigned` if either input is missing
    or normalizes to empty — the spec says "the default path is
    meaningful, not a placeholder," but an entity without any vendor
    information legitimately has nowhere more specific to live.
    """
    parts = ["enterprise", "unassigned"]
    mfr_slug = slug(manufacturer or "")
    if mfr_slug:
        parts.append(mfr_slug)
        model_slug = slug(model or "")
        if model_slug:
            parts.append(model_slug)
    return ".".join(parts)


def manual_path(manufacturer: str | None, model: str | None) -> str:
    """KB-side address for a manual: enterprise.knowledge_base.manuals.{mfr}.{model}."""
    parts = ["enterprise", "knowledge_base", "manuals"]
    mfr_slug = slug(manufacturer or "")
    if mfr_slug:
        parts.append(mfr_slug)
        model_slug = slug(model or "")
        if model_slug:
            parts.append(model_slug)
    return ".".join(parts)


def fault_code_path(manufacturer: str | None, code: str) -> str:
    """KB-side address for a fault code:
    enterprise.knowledge_base.fault_codes.{mfr}.{code}."""
    parts = ["enterprise", "knowledge_base", "fault_codes"]
    mfr_slug = slug(manufacturer or "")
    if mfr_slug:
        parts.append(mfr_slug)
    code_slug = slug(code)
    if code_slug:
        parts.append(code_slug)
    return ".".join(parts)


def work_order_path(wo_number: str) -> str:
    """Operational address for a work order:
    enterprise.operations.work_orders.{wo_number}."""
    parts = ["enterprise", "operations", "work_orders"]
    wo_slug = slug(wo_number)
    if wo_slug:
        parts.append(wo_slug)
    return ".".join(parts)
