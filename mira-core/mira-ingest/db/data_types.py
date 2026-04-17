"""Valid data_type values for knowledge_entries (vision doc Problem 1).

Used by the ingest + recall paths to scope retrieval by the semantic
type of knowledge (manual vs live telemetry vs fault event vs tribal
knowledge captured from tech resolution, etc.).
"""

from __future__ import annotations

MANUAL = "manual"
TELEMETRY = "telemetry"
FAULT_EVENT = "fault_event"
TRIBAL_KNOWLEDGE = "tribal_knowledge"
WORK_ORDER = "work_order"
OEM_NOTE = "oem_note"
PHOTO_DESCRIPTION = "photo_description"

ALL: tuple[str, ...] = (
    MANUAL,
    TELEMETRY,
    FAULT_EVENT,
    TRIBAL_KNOWLEDGE,
    WORK_ORDER,
    OEM_NOTE,
    PHOTO_DESCRIPTION,
)


def is_valid(value: str) -> bool:
    return value in ALL


def validate(value: str) -> str:
    if not is_valid(value):
        raise ValueError(f"invalid data_type: {value!r}; allowed: {ALL}")
    return value
