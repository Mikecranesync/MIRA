"""Governed fine-tune dry-run helpers for PR 4.

Pure utilities only: count local JSONL tokens, estimate spend, build a dry-run
preflight report, and shape adapter artifacts for the registry. This module
does not upload files, call Together, or launch jobs.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from factorylm_ai.budget import BudgetExceeded, BudgetGuard
from factorylm_ai.pricing import estimate_finetune_cost
from factorylm_ai.registry import ZtaArtifact


@dataclass(frozen=True)
class FinetuneDryRunPreflight:
    train_file: str
    validation_file: str | None
    training_tokens: int
    validation_tokens: int
    epochs: int
    n_evals: int
    estimated_cost_usd: float
    budget_cap_usd: float
    allowed: bool
    blocking: list[str]
    would_upload: bool
    would_create_job: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "train_file": self.train_file,
            "validation_file": self.validation_file,
            "training_tokens": self.training_tokens,
            "validation_tokens": self.validation_tokens,
            "epochs": self.epochs,
            "n_evals": self.n_evals,
            "estimated_cost_usd": self.estimated_cost_usd,
            "budget_cap_usd": self.budget_cap_usd,
            "allowed": self.allowed,
            "blocking": list(self.blocking),
            "would_upload": self.would_upload,
            "would_create_job": self.would_create_job,
        }


def count_jsonl_tokens(path: str | Path) -> int:
    """Conservatively estimate tokens in a Together JSONL file.

    This avoids adding a tokenizer dependency. Each JSON line is parsed and
    compacted to canonical JSON, then estimated at chars/4 with a one-token
    floor per non-empty line. Malformed JSON fails fast so a dry-run cannot
    bless a broken training file.
    """
    p = Path(path)
    total = 0
    with p.open("r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{p}:{lineno}: invalid JSONL: {exc.msg}") from exc
            compact = json.dumps(obj, sort_keys=True, separators=(",", ":"))
            total += max(1, math.ceil(len(compact) / 4))
    return total


def build_finetune_dry_run_preflight(
    train_file: str | Path,
    *,
    validation_file: str | Path | None = None,
    budget: BudgetGuard | None = None,
    epochs: int = 3,
    n_evals: int = 0,
    method: str = "sft",
) -> FinetuneDryRunPreflight:
    """Build the Phase-4 preflight report without touching the network."""
    guard = budget or BudgetGuard(cap_usd=5.0)
    training_tokens = count_jsonl_tokens(train_file)
    validation_tokens = count_jsonl_tokens(validation_file) if validation_file is not None else 0
    estimated_cost = estimate_finetune_cost(
        training_tokens=training_tokens,
        validation_tokens=validation_tokens,
        epochs=epochs,
        n_evals=n_evals,
        method=method,
    )
    blocking: list[str] = []
    try:
        guard.precheck(estimated_cost)
    except BudgetExceeded:
        blocking.append("budget")

    allowed = not blocking
    return FinetuneDryRunPreflight(
        train_file=str(train_file),
        validation_file=str(validation_file) if validation_file is not None else None,
        training_tokens=training_tokens,
        validation_tokens=validation_tokens,
        epochs=epochs,
        n_evals=n_evals,
        estimated_cost_usd=estimated_cost,
        budget_cap_usd=guard.cap_usd,
        allowed=allowed,
        blocking=blocking,
        would_upload=allowed,
        would_create_job=allowed,
    )


def adapter_artifact_from_job(
    job: dict[str, Any],
    *,
    dataset_version: str,
    dataset_manifest_hash: str,
    hyperparams: dict[str, Any],
    created_at: str,
    created_by: str,
) -> ZtaArtifact:
    """Return an unpromoted adapter artifact row for a completed/queued FT job."""
    job_id = str(job.get("id") or "")
    if not job_id:
        raise ValueError("fine-tune job metadata must include non-empty id")
    base_model = str(job.get("model") or "")
    output_model = str(job.get("model_output_name") or job.get("output_model") or "")
    return ZtaArtifact(
        artifact_id=f"adapter:{job_id}",
        artifact_type="adapter",
        version=job_id,
        source_interaction_ids=[],
        source_file_hashes=[dataset_manifest_hash],
        tenant_id=None,
        created_at=created_at,
        created_by=created_by,
        review_status="draft",
        benchmark_status="untested",
        runtime_allowed=False,
        metadata={
            "job_id": job_id,
            "base_model": base_model,
            "output_model": output_model,
            "dataset_version": dataset_version,
            "dataset_manifest_hash": dataset_manifest_hash,
            "hyperparams": dict(hyperparams),
        },
    )
