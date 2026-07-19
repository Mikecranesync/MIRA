"""Together fine-tuning JSONL exporter — the flywheel's terminal write step.

ZTA role: converts approved, split-assigned training_record dicts (built by
:func:`factorylm_ai.flywheel.records.new_training_record`, typically
bucketed by :func:`factorylm_ai.flywheel.splits.split_records`) into the
JSONL shape Together's fine-tuning file-upload endpoint expects (see
``docs/zta/together-liquid-model-strategy.md`` and
``factorylm_ai/providers/together.py``'s ``upload_file``/
``create_finetune_job`` helpers).

This is a WRITE GATE, not just a formatter:

- Fails CLOSED on any unapproved record — :class:`ExportRefused` aborts the
  entire call before a single byte is written, even if only one record out
  of many is missing ``approved_by``.
- Drops sensitive/tenant-scoped records by default (a governance SKIP, not a
  refusal — the rest of the export proceeds; every skip is logged).
- Physically never writes the holdout split. The held-back slice exists so a
  benchmark/eval run has data the model has provably never trained on; this
  is the one place in the pipeline that guarantee is enforced in code, not
  just by convention.
- Redacts every kept record
  (:func:`factorylm_ai.flywheel.redact.redact_record`) before it is
  serialized — nothing reaches disk unredacted.

Nothing in this module calls a network API — it only writes local JSONL
files. Uploading them to Together is a separate, explicit, human-invoked
step (``providers/together.py``'s fine-tuning helpers, network-gated),
consistent with the lab's "nothing spends without an explicit --live flag"
doctrine.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from .redact import redact_record

logger = logging.getLogger("factorylm-ai")

_VALID_FMTS = ("chat", "function_calling")
# Deterministic write order. "holdout" is deliberately absent — see module docstring.
_EXPORTABLE_SPLITS = ("train", "dev", "test")


class ExportRefused(Exception):
    """Raised when ANY record in the input list is missing ``approved_by``.

    Whole-call failure by design: export aborts before anything is
    written — no partial JSONL files, no silent drop of the unapproved row.
    """


def export_together_jsonl(
    records: list[dict[str, Any]],
    out_dir: str,
    *,
    fmt: str = "chat",
    include_tenant_sensitive: bool = False,
) -> dict[str, str]:
    """Write approved training_record dicts to Together fine-tuning JSONL files.

    ``fmt="chat"`` writes ``{"messages": [...]}`` per line. ``fmt="function_calling"``
    additionally writes the record's ``tools`` array — ``{"messages": [...],
    "tools": [...]}`` — Together's function-calling fine-tuning shape:
    assistant turns carry ``tool_calls`` and ``role: "tool"`` result
    messages are included directly in ``messages``. This function passes
    both through verbatim (after redaction); it does not construct or
    validate tool-call shapes itself.

    Gates, in order:

    1. Any record with a missing/None/empty ``approved_by`` -> raises
       :class:`ExportRefused` immediately. Nothing is written, even for
       records earlier in the list that were fine.
    2. ``split == "holdout"`` -> skipped (logged), never written, never
       returned.
    3. ``sensitive`` truthy OR ``tenant_id is not None`` -> skipped (logged)
       unless ``include_tenant_sensitive=True``.

    Every record that survives the gates is redacted
    (:func:`factorylm_ai.flywheel.redact.redact_record`) before being
    serialized.

    Returns ``{"train": path, "dev": path, "test": path}`` — always exactly
    these three keys, in this order; each file is written even if empty, so
    a caller never has to guard a missing key. ``out_dir`` is created if it
    does not already exist.
    """
    if fmt not in _VALID_FMTS:
        raise ValueError(f"export_together_jsonl: fmt must be one of {_VALID_FMTS}, got {fmt!r}")

    # Gate 1 — approved_by. A whole-list pre-pass so a single unapproved
    # record anywhere in the batch refuses the ENTIRE export before any file
    # is touched (fail closed; see ExportRefused docstring).
    for record in records:
        if not record.get("approved_by"):
            raise ExportRefused(
                f"export_together_jsonl: record {record.get('record_id', '<unknown>')!r} "
                "has no approved_by (review not approved) — refusing the entire export"
            )

    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        record_id = record.get("record_id", "<unknown>")
        split = record.get("split")

        if not isinstance(split, str):
            logger.info(
                "export_together_jsonl: skipping record %s — missing/invalid split value %r",
                record_id,
                split,
            )
            continue

        if split == "holdout":
            logger.info(
                "export_together_jsonl: skipping record %s — holdout is NEVER exported",
                record_id,
            )
            continue

        sensitive_or_tenant = bool(record.get("sensitive")) or record.get("tenant_id") is not None
        if sensitive_or_tenant and not include_tenant_sensitive:
            logger.info(
                "export_together_jsonl: skipping sensitive/tenant record %s "
                "(sensitive=%s tenant_id=%r) — pass include_tenant_sensitive=True to include it",
                record_id,
                record.get("sensitive"),
                record.get("tenant_id"),
            )
            continue

        grouped.setdefault(split, []).append(redact_record(record))

    # Defense in depth: the loop above already `continue`s past every
    # holdout record, so this can never actually fire. It documents and
    # locks in the invariant rather than trusting the loop logic alone.
    assert "holdout" not in grouped, (
        "export_together_jsonl: holdout must never be staged for export"
    )

    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    written: dict[str, str] = {}
    for split in _EXPORTABLE_SPLITS:
        file_path = out_path / f"{split}.jsonl"
        rows = grouped.get(split, [])
        with file_path.open("w", encoding="utf-8") as f:
            for record in rows:
                f.write(json.dumps(_to_jsonl_line(record, fmt), sort_keys=True))
                f.write("\n")
        written[split] = str(file_path)
        logger.info(
            "export_together_jsonl: wrote %d record(s) to %s (fmt=%s)",
            len(rows),
            file_path,
            fmt,
        )

    return written


def _to_jsonl_line(record: dict[str, Any], fmt: str) -> dict[str, Any]:
    messages = record.get("messages") or []
    if fmt == "function_calling":
        return {"messages": messages, "tools": record.get("tools") or []}
    return {"messages": messages}
