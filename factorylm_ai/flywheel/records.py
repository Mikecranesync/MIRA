"""Flywheel record builders — the four schema-validated dict shapes.

ZTA role: every function here builds ONE JSON-Schema-validated dict and
returns it. Nothing is persisted here — persistence is the JSONL sinks in
:mod:`factorylm_ai.telemetry` / :mod:`factorylm_ai.registry` and the export
step in :mod:`factorylm_ai.flywheel.export`. This module's only job is to
guarantee that a record is schema-valid before a caller ever sees it: every
builder validates via :func:`factorylm_ai.schemas.validate.validate_or_raise`
before returning, so an invalid record is never handed back silently.

Provenance law: :func:`new_training_record` REQUIRES a non-empty
``source_interaction_ids`` — a fine-tuning candidate that cannot be traced
back to at least one real interaction is refused outright (raises
``ValueError`` before validation is even attempted). This is the flywheel's
first data-governance gate; :mod:`factorylm_ai.flywheel.export` is the last.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from factorylm_ai.schemas.validate import load_schema, validate_or_raise

from .splits import assign_split


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def new_interaction_record(
    *,
    channel: str,
    input_kind: str,
    interaction_id: str | None = None,
    ts: str | None = None,
    tenant_id: str | None = None,
    input_text: str | None = None,
    input_hashes: list[str] | None = None,
    route: str | None = None,
    model_runs: list[dict[str, Any]] | None = None,
    final_text: str | None = None,
    human_rating: str = "unknown",
    review_status: str = "draft",
    sensitive: bool = False,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Build and validate one interaction_record (schemas/interaction_record.schema.json).

    ``interaction_id``/``ts`` are generated when omitted. ``human_rating``
    defaults to ``"unknown"`` and ``review_status`` to ``"draft"`` — both
    are updated later as feedback/review happens, never guessed here.
    Raises :class:`factorylm_ai.schemas.validate.SchemaError` if the
    resulting record does not validate (e.g. an out-of-enum ``human_rating``).
    """
    record: dict[str, Any] = {
        "interaction_id": interaction_id or _new_id("int"),
        "ts": ts or _now_iso(),
        "channel": channel,
        "tenant_id": tenant_id,
        "input_kind": input_kind,
        "input_text": input_text,
        "input_hashes": list(input_hashes) if input_hashes is not None else [],
        "route": route,
        "model_runs": list(model_runs) if model_runs is not None else [],
        "final_text": final_text,
        "human_rating": human_rating,
        "review_status": review_status,
        "sensitive": sensitive,
        "tags": list(tags) if tags is not None else [],
    }
    validate_or_raise(record, load_schema("interaction_record"))
    return record


def new_feedback_event(
    *,
    interaction_id: str,
    kind: str,
    text: str = "",
    feedback_id: str | None = None,
    ts: str | None = None,
    corrected_fields: dict[str, Any] | None = None,
    reviewer: str | None = None,
) -> dict[str, Any]:
    """Build and validate one feedback_event (schemas/feedback_event.schema.json).

    ``kind`` must be one of "correction"/"approval"/"rejection"/"benchmark_flag"
    (enforced by schema validation, not re-checked here). ``corrected_fields``
    is the free-form ``{field_name: corrected_value}`` map used when
    ``kind == "correction"`` — the seed for a later training_record/eval_case.
    Raises :class:`factorylm_ai.schemas.validate.SchemaError` on an invalid
    ``kind`` or a malformed record.
    """
    record: dict[str, Any] = {
        "feedback_id": feedback_id or _new_id("fb"),
        "ts": ts or _now_iso(),
        "interaction_id": interaction_id,
        "kind": kind,
        "text": text,
        "corrected_fields": corrected_fields,
        "reviewer": reviewer,
    }
    validate_or_raise(record, load_schema("feedback_event"))
    return record


def new_training_record(
    *,
    source_interaction_ids: list[str],
    messages: list[dict[str, Any]],
    tags: list[str],
    sensitive: bool,
    approved_by: str | None,
    record_id: str | None = None,
    tools: list[dict[str, Any]] | None = None,
    tenant_id: str | None = None,
    split: str | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Build and validate one training_record (schemas/training_record.schema.json).

    PROVENANCE LAW: ``source_interaction_ids`` must be non-empty — raises
    ``ValueError`` immediately (before schema validation is even attempted)
    if it is empty. A training record with no traceable source interaction
    is not a fine-tuning candidate; it is untracked data and must not be
    built.

    ``split`` defaults to :func:`factorylm_ai.flywheel.splits.assign_split`
    applied to ``record_id`` (deterministic 70/10/10/10) when omitted — pass
    an explicit ``split`` only to force a specific bucket (tests, or a
    curated eval/holdout set assembled by hand).

    ``approved_by`` is required by the schema but explicitly allowed to be
    ``None`` here — a record starts life unapproved. Export refuses any
    record where it is still ``None``: see
    :func:`factorylm_ai.flywheel.export.export_together_jsonl`.
    """
    if not source_interaction_ids:
        raise ValueError(
            "new_training_record: source_interaction_ids must be non-empty "
            "(provenance law — a training record must trace back to at "
            "least one real interaction)"
        )
    record_id = record_id or _new_id("tr")
    record: dict[str, Any] = {
        "record_id": record_id,
        "source_interaction_ids": list(source_interaction_ids),
        "messages": messages,
        "tools": tools,
        "split": split if split is not None else assign_split(record_id),
        "tags": list(tags),
        "sensitive": sensitive,
        "tenant_id": tenant_id,
        "approved_by": approved_by,
        "created_at": created_at or _now_iso(),
    }
    validate_or_raise(record, load_schema("training_record"))
    return record


def new_eval_case(
    *,
    input_value: Any,
    expected_value: Any,
    case_id: str | None = None,
    source_interaction_ids: list[str] | None = None,
    judge: str = "deterministic",
    frozen: bool = True,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Build and validate one eval_case (schemas/eval_case.schema.json).

    ``split`` is ALWAYS the literal ``"eval"`` — not a caller-supplied
    parameter — an eval case must never be mixed into a training split (see
    the schema's own description, and the cross-split guard in
    :func:`factorylm_ai.flywheel.splits.split_records`). ``frozen`` defaults
    to ``True``: once an eval case is in the frozen benchmark set, it should
    not silently change out from under a promotion decision
    (:mod:`factorylm_ai.promotion`); pass ``frozen=False`` explicitly for a
    draft/candidate case still being assembled.
    """
    record: dict[str, Any] = {
        "case_id": case_id or _new_id("ec"),
        "source_interaction_ids": (
            list(source_interaction_ids) if source_interaction_ids is not None else []
        ),
        "input": input_value,
        "expected": expected_value,
        "judge": judge,
        "frozen": frozen,
        "split": "eval",
        "tags": list(tags) if tags is not None else [],
    }
    validate_or_raise(record, load_schema("eval_case"))
    return record
