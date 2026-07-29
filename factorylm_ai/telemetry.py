"""Per-call telemetry sink — the seam every model call's outcome is recorded through.

ZTA role: :class:`ModelRun` is the append-only audit trail the promotion
gate (:mod:`factorylm_ai.promotion`) and the artifact registry
(:mod:`factorylm_ai.registry`) ultimately reason about — cost, latency,
JSON validity, evidence presence, human rating, all keyed to a task and
prompt/schema version. :func:`log_model_run` validates every row against
``schemas/model_run.schema.json`` before it is ever written, so the JSONL
file can be trusted downstream without re-validating.

The schema is loaded LAZILY — the import of
:mod:`factorylm_ai.schemas.validate` and the ``load_schema("model_run")``
call both happen inside :func:`log_model_run`'s body, not at module import
time. ``factorylm_ai/schemas/`` is written by a parallel-stage builder in
this package's initial build, so importing it eagerly here would race; if
the schema genuinely isn't present when this function is called, it raises
a clear :class:`RuntimeError` instead of a three-frames-down import error.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from .providers.base import ModelResponse

logger = logging.getLogger("factorylm-ai")


@dataclass
class ModelRun:
    """One provider call's outcome — mirrors ``schemas/model_run.schema.json`` exactly."""

    ts: str
    provider: str
    model: str
    adapter: str | None
    task: str
    input_hash: str
    prompt_version: str
    schema_version: str
    latency_ms: int
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float
    json_valid: bool
    evidence_required: bool
    evidence_present: bool
    human_rating: str  # "accepted" | "corrected" | "rejected" | "unknown"


def _default_runs_path() -> Path:
    data_dir = os.getenv("FACTORYLM_AI_DATA_DIR") or "factorylm_ai/data"
    return Path(data_dir) / "runs" / "model_runs.jsonl"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def log_model_run(run: ModelRun, path: str | None = None) -> None:
    """Validate ``run`` against the ``model_run`` schema, then append it as
    one JSON line to the runs JSONL file.

    Default path is ``<FACTORYLM_AI_DATA_DIR or "factorylm_ai/data">/runs/model_runs.jsonl``;
    the parent directory is created lazily (only when this function actually
    writes — never at import time). Raises whatever the schema validator
    raises on an invalid ``run`` (fail closed: nothing is written unless it
    validates first).
    """
    try:
        from .schemas.validate import load_schema, validate_or_raise

        schema = load_schema("model_run")
    except Exception as exc:
        raise RuntimeError(
            "factorylm_ai.telemetry.log_model_run: could not load "
            "schemas/model_run.schema.json (factorylm_ai/schemas/ may not be "
            "built yet in this checkout) — cannot validate a ModelRun "
            f"without it: {exc}"
        ) from exc

    payload = asdict(run)
    validate_or_raise(payload, schema)

    target = Path(path) if path is not None else _default_runs_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, sort_keys=True))
        fh.write("\n")
    logger.info(
        "MODEL_RUN_LOGGED task=%s provider=%s model=%s path=%s",
        run.task,
        run.provider,
        run.model,
        target,
    )


def model_run_from_response(
    task_id: str,
    req_hash: str,
    prompt_version: str,
    schema_version: str,
    resp: ModelResponse,
    json_valid: bool,
    evidence_required: bool = False,
    evidence_present: bool = False,
) -> ModelRun:
    """Build a :class:`ModelRun` from a completed :class:`ModelResponse`.

    ``adapter`` is always ``None`` here — ``ModelResponse`` carries no
    adapter field (only the originating ``ModelRequest`` does); a caller
    that needs the adapter id on the logged run constructs ``ModelRun``
    directly instead of via this helper. ``human_rating`` starts at
    ``"unknown"`` — it is updated later by whatever records human feedback
    (:mod:`factorylm_ai.flywheel.records`), never guessed here.
    """
    return ModelRun(
        ts=_now_iso(),
        provider=resp.provider,
        model=resp.model,
        adapter=None,
        task=task_id,
        input_hash=req_hash,
        prompt_version=prompt_version,
        schema_version=schema_version,
        latency_ms=resp.latency_ms,
        input_tokens=resp.input_tokens,
        output_tokens=resp.output_tokens,
        estimated_cost_usd=resp.estimated_cost_usd,
        json_valid=json_valid,
        evidence_required=evidence_required,
        evidence_present=evidence_present,
        human_rating="unknown",
    )
