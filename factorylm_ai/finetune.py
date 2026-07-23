"""Governed fine-tune dry-run helpers for PR 4.

Pure utilities only: count local JSONL tokens, estimate spend, build a dry-run
preflight report, and shape adapter artifacts for the registry. This module
does not upload files, call Together, or launch jobs.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from factorylm_ai.budget import BudgetExceeded, BudgetGuard
from factorylm_ai.pricing import estimate_finetune_cost
from factorylm_ai.registry import ZtaArtifact

ACTION_CREATE_FINETUNE_JOB = "together.create_finetune_job"
ACTION_TEMPORARY_ENDPOINT_BENCHMARK = "together.temporary_endpoint_benchmark"
AUTHORIZED_SPEND_ISSUERS = frozenset({"mike", "mikecranesync"})
LOCAL_TOKEN_SAFETY_FACTOR = 1.25


def _parse_iso_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


def _nonnull_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


@dataclass(frozen=True)
class PaidEventAuthorization:
    """Durable evidence that Mike approved one specific paid Together action."""

    authorization_id: str
    action: str
    dataset_manifest_hash: str
    model: str
    spend_cap_usd: float
    issued_by: str
    issued_at: str
    expires_at: str
    receipt_ref: str
    single_use: bool = True
    used_at: str | None = None

    def blockers_for(
        self,
        *,
        action: str,
        dataset_manifest_hash: str,
        model: str,
        spend_cap_usd: float,
        now: datetime | None = None,
    ) -> list[str]:
        now = now or datetime.now(UTC)
        blockers: list[str] = []
        if not _nonnull_string(self.authorization_id):
            blockers.append("authorization_id")
        if not _nonnull_string(self.receipt_ref):
            blockers.append("authorization_receipt")
        if self.action != action:
            blockers.append("authorization_action")
        if self.dataset_manifest_hash != dataset_manifest_hash:
            blockers.append("authorization_manifest")
        if self.model != model:
            blockers.append("authorization_model")
        if round(float(self.spend_cap_usd), 4) != round(float(spend_cap_usd), 4):
            blockers.append("authorization_spend_cap")
        if self.issued_by.strip().lower() not in AUTHORIZED_SPEND_ISSUERS:
            blockers.append("authorization_issuer")
        issued_at = _parse_iso_timestamp(self.issued_at)
        if issued_at is None or issued_at > now:
            blockers.append("authorization_issued_at")
        expires_at = _parse_iso_timestamp(self.expires_at)
        if expires_at is None or expires_at <= now:
            blockers.append("authorization_expired")
        if not self.single_use or self.used_at is not None:
            blockers.append("authorization_single_use")
        return blockers

    def to_dict(self) -> dict[str, Any]:
        return {
            "authorization_id": self.authorization_id,
            "action": self.action,
            "dataset_manifest_hash": self.dataset_manifest_hash,
            "model": self.model,
            "spend_cap_usd": self.spend_cap_usd,
            "issued_by": self.issued_by,
            "issued_at": self.issued_at,
            "expires_at": self.expires_at,
            "receipt_ref": self.receipt_ref,
            "single_use": self.single_use,
            "used_at": self.used_at,
        }


@dataclass(frozen=True)
class TogetherPriceEstimate:
    """Authoritative Together ``/fine-tunes/estimate-price`` result plus receipt."""

    estimated_total_price: float
    allowed_to_proceed: bool
    estimated_train_token_count: int
    estimated_eval_token_count: int = 0
    receipt_ref: str | None = None
    estimation_available: bool = True
    user_limit: float | None = None
    raw: dict[str, Any] | None = None

    @classmethod
    def from_response(
        cls, data: dict[str, Any], *, receipt_ref: str | None
    ) -> "TogetherPriceEstimate":
        return cls(
            estimated_total_price=float(data.get("estimated_total_price") or 0.0),
            allowed_to_proceed=bool(data.get("allowed_to_proceed")),
            estimated_train_token_count=int(data.get("estimated_train_token_count") or 0),
            estimated_eval_token_count=int(data.get("estimated_eval_token_count") or 0),
            receipt_ref=receipt_ref,
            estimation_available=bool(data.get("estimation_available", True)),
            user_limit=float(data["user_limit"]) if data.get("user_limit") is not None else None,
            raw=dict(data),
        )

    def blockers_for(
        self,
        *,
        local_estimate_usd: float,
        local_training_tokens: int,
        local_validation_tokens: int,
        spend_cap_usd: float,
    ) -> list[str]:
        blockers: list[str] = []
        if not _nonnull_string(self.receipt_ref):
            blockers.append("together_estimate_receipt")
        if not self.estimation_available:
            blockers.append("together_estimate_unavailable")
        if not self.allowed_to_proceed:
            blockers.append("together_estimate_allowed")
        if self.estimated_total_price <= 0:
            blockers.append("together_estimate_price")
        if self.estimated_total_price > spend_cap_usd:
            blockers.append("budget")
        if self.estimated_total_price > local_estimate_usd + 0.01:
            blockers.append("estimate_mismatch")
        if self.estimated_train_token_count > local_training_tokens:
            blockers.append("estimate_mismatch")
        if self.estimated_eval_token_count > local_validation_tokens:
            blockers.append("estimate_mismatch")
        return blockers

    def to_dict(self) -> dict[str, Any]:
        return {
            "estimated_total_price": self.estimated_total_price,
            "allowed_to_proceed": self.allowed_to_proceed,
            "estimated_train_token_count": self.estimated_train_token_count,
            "estimated_eval_token_count": self.estimated_eval_token_count,
            "receipt_ref": self.receipt_ref,
            "estimation_available": self.estimation_available,
            "user_limit": self.user_limit,
        }


@dataclass(frozen=True)
class FineTuneApprovalEvidence:
    """The full evidence package required before a paid fine-tune job."""

    paid_gate_report: Any | None
    dataset_manifest_hash: str | None
    model_support_receipt_ref: str | None
    authorization: PaidEventAuthorization | None
    local_estimate_usd: float | None
    together_estimate: TogetherPriceEstimate | None

    def blockers_for(
        self,
        *,
        action: str,
        dataset_manifest_hash: str,
        model: str,
        spend_cap_usd: float,
        local_estimate_usd: float,
        local_training_tokens: int,
        local_validation_tokens: int,
    ) -> list[str]:
        blockers: list[str] = []
        if not (self.paid_gate_report is not None and bool(self.paid_gate_report.passed)):
            blockers.append("paid_gate_pass")
        if not _nonnull_string(self.dataset_manifest_hash):
            blockers.append("manifest_hash")
        elif self.dataset_manifest_hash != dataset_manifest_hash:
            blockers.append("manifest_hash")
        if not _nonnull_string(self.model_support_receipt_ref):
            blockers.append("model_support_receipt")
        if self.authorization is None:
            blockers.append("authorization_receipt")
        else:
            blockers.extend(
                self.authorization.blockers_for(
                    action=action,
                    dataset_manifest_hash=dataset_manifest_hash,
                    model=model,
                    spend_cap_usd=spend_cap_usd,
                )
            )
        if self.local_estimate_usd is None or self.local_estimate_usd <= 0:
            blockers.append("local_estimate")
        elif self.local_estimate_usd + 0.01 < local_estimate_usd:
            blockers.append("local_estimate")
        if self.together_estimate is None:
            blockers.append("together_estimate")
        else:
            blockers.extend(
                self.together_estimate.blockers_for(
                    local_estimate_usd=local_estimate_usd,
                    local_training_tokens=local_training_tokens,
                    local_validation_tokens=local_validation_tokens,
                    spend_cap_usd=spend_cap_usd,
                )
            )
        return sorted(set(blockers))

    def approved_for(self, **kwargs: Any) -> bool:
        return not self.blockers_for(**kwargs)

    def to_dict(self) -> dict[str, Any]:
        return {
            "paid_gate_pass": bool(
                self.paid_gate_report is not None and self.paid_gate_report.passed
            ),
            "dataset_manifest_hash": self.dataset_manifest_hash,
            "model_support_receipt_ref": self.model_support_receipt_ref,
            "authorization": self.authorization.to_dict() if self.authorization else None,
            "local_estimate_usd": self.local_estimate_usd,
            "together_estimate": self.together_estimate.to_dict()
            if self.together_estimate
            else None,
        }


def _dedupe(items: list[str]) -> list[str]:
    return sorted(set(items))


@dataclass(frozen=True)
class FinetuneDryRunPreflight:
    train_file: str
    validation_file: str | None
    model: str | None
    training_tokens: int
    validation_tokens: int
    epochs: int
    n_evals: int
    local_estimate_usd: float
    together_estimate_usd: float | None
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
            "model": self.model,
            "training_tokens": self.training_tokens,
            "validation_tokens": self.validation_tokens,
            "epochs": self.epochs,
            "n_evals": self.n_evals,
            "local_estimate_usd": self.local_estimate_usd,
            "together_estimate_usd": self.together_estimate_usd,
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
    compacted to canonical JSON, then estimated at chars/4 with a safety
    factor and a one-token floor per non-empty line. Malformed JSON fails fast
    so a dry-run cannot bless a broken training file.
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
            rough = math.ceil(len(compact) / 4)
            total += max(1, math.ceil(rough * LOCAL_TOKEN_SAFETY_FACTOR))
    return total


def build_finetune_dry_run_preflight(
    train_file: str | Path,
    *,
    validation_file: str | Path | None = None,
    budget: BudgetGuard | None = None,
    model: str | None = None,
    paid_gate_report: Any | None = None,
    manifest_hash: str | None = None,
    model_support_receipt_ref: str | None = None,
    authorization: PaidEventAuthorization | None = None,
    together_estimate: TogetherPriceEstimate | None = None,
    epochs: int = 3,
    n_evals: int = 0,
    method: str = "sft",
) -> FinetuneDryRunPreflight:
    """Build the Phase-4 preflight report without touching the network."""
    guard = budget or BudgetGuard(cap_usd=5.0)
    training_tokens = count_jsonl_tokens(train_file)
    validation_tokens = count_jsonl_tokens(validation_file) if validation_file is not None else 0
    local_estimate = estimate_finetune_cost(
        training_tokens=training_tokens,
        validation_tokens=validation_tokens,
        epochs=epochs,
        n_evals=n_evals,
        method=method,
    )
    together_cost = (
        together_estimate.estimated_total_price if together_estimate is not None else None
    )
    estimated_cost = max(local_estimate, together_cost or 0.0)
    blocking: list[str] = []
    try:
        guard.precheck(estimated_cost)
    except BudgetExceeded:
        blocking.append("budget")

    if not _nonnull_string(model):
        blocking.append("model")
    approval = FineTuneApprovalEvidence(
        paid_gate_report=paid_gate_report,
        dataset_manifest_hash=manifest_hash,
        model_support_receipt_ref=model_support_receipt_ref,
        authorization=authorization,
        local_estimate_usd=local_estimate,
        together_estimate=together_estimate,
    )
    blocking.extend(
        approval.blockers_for(
            action=ACTION_CREATE_FINETUNE_JOB,
            dataset_manifest_hash=manifest_hash or "",
            model=model or "",
            spend_cap_usd=guard.cap_usd,
            local_estimate_usd=local_estimate,
            local_training_tokens=training_tokens,
            local_validation_tokens=validation_tokens,
        )
    )
    blocking = _dedupe(blocking)
    allowed = not blocking
    return FinetuneDryRunPreflight(
        train_file=str(train_file),
        validation_file=str(validation_file) if validation_file is not None else None,
        model=model,
        training_tokens=training_tokens,
        validation_tokens=validation_tokens,
        epochs=epochs,
        n_evals=n_evals,
        local_estimate_usd=local_estimate,
        together_estimate_usd=together_cost,
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
