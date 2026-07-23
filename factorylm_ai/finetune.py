"""Governed fine-tune dry-run helpers for PR 4.

Pure utilities only: count local JSONL tokens, estimate spend, build a dry-run
preflight report, and shape adapter artifacts for the registry. This module
does not upload files, call Together, or launch jobs.
"""

from __future__ import annotations

import json
import math
import os
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from factorylm_ai.budget import BudgetExceeded, BudgetGuard
from factorylm_ai.pricing import estimate_finetune_cost
from factorylm_ai.registry import ZtaArtifact

ACTION_CREATE_FINETUNE_JOB = "together.create_finetune_job"
ACTION_TEMPORARY_ENDPOINT_BENCHMARK = "together.temporary_endpoint_benchmark"
AUTHORIZED_SPEND_ISSUERS = frozenset({"mike", "mikecranesync"})
CANONICAL_FINETUNE_REQUEST_SCHEMA_VERSION = "together-finetune-request-v1"
CANONICAL_PAID_ACTION_REQUEST_SCHEMA_VERSION = "factorylm-paid-action-request-v1"
TRUSTED_AUTHORIZATION_LEDGER_SCHEMA_VERSION = "factorylm-paid-authorization-ledger-v1"
DEFAULT_TOGETHER_PROVIDER = "together"
DEFAULT_CURRENCY = "USD"
DEFAULT_WIRE_VERIFICATION_REF = "docs/zta/2026-07-23-pr4-together-wire-verification.md"
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


def _canonical_json_bytes(data: Any) -> bytes:
    return json.dumps(
        data,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    ).encode("utf-8")


def _sha256_json(data: Any) -> str:
    import hashlib

    return "sha256:" + hashlib.sha256(_canonical_json_bytes(data)).hexdigest()


def _finite_number(value: object) -> bool:
    return isinstance(value, int | float) and math.isfinite(float(value))


def _redact_secretish(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            key_lower = key_text.lower()
            if (
                key_lower in {"api_key", "apikey", "secret", "password", "private_key"}
                or "token" in key_lower
                or "bearer" in key_lower
                or (key_lower == "authorization" and isinstance(item, str))
            ):
                continue
            redacted[key_text] = _redact_secretish(item)
        return redacted
    if isinstance(value, list):
        return [_redact_secretish(item) for item in value]
    if isinstance(value, tuple):
        return [_redact_secretish(item) for item in value]
    return value


def _coerce_report(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "to_dict"):
        try:
            return value.to_dict()
        except TypeError:
            pass
    if isinstance(value, dict):
        return dict(value)
    if hasattr(value, "__dict__"):
        return dict(value.__dict__)
    return {"repr": repr(value)}


def _make_training_method_payload(
    training_method: str,
    train_on_inputs: bool | str | None,
) -> dict[str, Any]:
    method_payload: dict[str, Any] = {"method": training_method}
    if train_on_inputs is not None:
        method_payload["train_on_inputs"] = train_on_inputs
    return method_payload


def _make_training_type_payload(
    *,
    lora: bool,
    lora_r: int | None,
    lora_alpha: int | None,
    lora_dropout: float | None,
    lora_trainable_modules: str | None,
) -> dict[str, Any]:
    type_payload: dict[str, Any] = {"type": "Lora" if lora else "Full"}
    if lora:
        if lora_r is not None:
            type_payload["lora_r"] = lora_r
        if lora_alpha is not None:
            type_payload["lora_alpha"] = lora_alpha
        if lora_dropout is not None:
            type_payload["lora_dropout"] = lora_dropout
        if lora_trainable_modules is not None:
            type_payload["lora_trainable_modules"] = lora_trainable_modules
    return type_payload


@dataclass(frozen=True)
class CanonicalFineTuneRequest:
    """Versioned, deterministic representation of a Together fine-tune request."""

    schema_version: str
    provider: str
    action: str
    request: dict[str, Any]

    @property
    def canonical_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "provider": self.provider,
            "action": self.action,
            "request": _redact_secretish(self.request),
        }

    @property
    def canonical_json(self) -> str:
        return _canonical_json_bytes(self.canonical_dict).decode("ascii")

    @property
    def request_hash(self) -> str:
        return _sha256_json(self.canonical_dict)

    def create_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "training_file": self.request["training_file"],
            "model": self.request["model"],
            "n_epochs": self.request["n_epochs"],
            "n_evals": self.request["n_evals"],
            "suffix": self.request["suffix"],
            "training_method": dict(self.request["training_method"]),
            "training_type": dict(self.request["training_type"]),
        }
        optional_map = {
            "validation_file": "validation_file",
            "n_checkpoints": "n_checkpoints",
            "packing": "packing",
            "learning_rate": "learning_rate",
            "random_seed": "random_seed",
        }
        for canonical_key, payload_key in optional_map.items():
            value = self.request.get(canonical_key)
            if value is not None:
                payload[payload_key] = value
        return payload

    def estimate_payload(self) -> dict[str, Any]:
        payload = {
            "training_file": self.request["training_file"],
            "model": self.request["model"],
            "n_epochs": self.request["n_epochs"],
            "n_evals": self.request["n_evals"],
            "training_method": dict(self.request["training_method"]),
            "training_type": dict(self.request["training_type"]),
        }
        if self.request.get("validation_file") is not None:
            payload["validation_file"] = self.request["validation_file"]
        return payload


def canonical_finetune_request(
    *,
    training_file_id: str,
    model: str,
    suffix: str | None = None,
    validation_file: str | None = None,
    n_epochs: int = 3,
    n_evals: int = 0,
    n_checkpoints: int | None = None,
    seed: int | None = None,
    train_on_inputs: bool | str | None = None,
    packing: bool | None = None,
    learning_rate: float | None = None,
    lora_r: int | None = None,
    lora_alpha: int | None = None,
    lora_dropout: float | None = None,
    lora_trainable_modules: str | None = None,
    lora: bool = True,
    training_method: str = "sft",
) -> CanonicalFineTuneRequest:
    if training_method not in ("sft", "dpo"):
        raise ValueError(f"training_method must be 'sft' or 'dpo', got {training_method!r}")
    request = {
        "training_file": training_file_id,
        "validation_file": validation_file,
        "model": model,
        "suffix": suffix,
        "n_epochs": n_epochs,
        "n_evals": n_evals,
        "n_checkpoints": n_checkpoints,
        "packing": packing,
        "learning_rate": learning_rate,
        "random_seed": seed,
        "training_method": _make_training_method_payload(training_method, train_on_inputs),
        "training_type": _make_training_type_payload(
            lora=lora,
            lora_r=lora_r,
            lora_alpha=lora_alpha,
            lora_dropout=lora_dropout,
            lora_trainable_modules=lora_trainable_modules,
        ),
    }
    return CanonicalFineTuneRequest(
        schema_version=CANONICAL_FINETUNE_REQUEST_SCHEMA_VERSION,
        provider=DEFAULT_TOGETHER_PROVIDER,
        action=ACTION_CREATE_FINETUNE_JOB,
        request=request,
    )


def canonical_paid_action_request_hash(
    *,
    provider: str,
    action: str,
    payload: dict[str, Any],
) -> str:
    return _sha256_json(
        {
            "schema_version": CANONICAL_PAID_ACTION_REQUEST_SCHEMA_VERSION,
            "provider": provider,
            "action": action,
            "request": _redact_secretish(payload),
        }
    )


@dataclass(frozen=True)
class PaidEventAuthorization:
    """Durable evidence that Mike approved one specific paid Together action."""

    authorization_id: str
    provider: str
    action: str
    dataset_manifest_hash: str
    model: str
    request_hash: str
    currency: str
    spend_cap_usd: float
    issued_by: str
    authority_ref: str
    issued_at: str
    expires_at: str
    receipt_ref: str
    single_use: bool = True
    used_at: str | None = None

    def blockers_for(
        self,
        *,
        provider: str = DEFAULT_TOGETHER_PROVIDER,
        action: str,
        dataset_manifest_hash: str,
        model: str,
        request_hash: str,
        spend_cap_usd: float,
        currency: str = DEFAULT_CURRENCY,
        now: datetime | None = None,
    ) -> list[str]:
        now = now or datetime.now(UTC)
        blockers: list[str] = []
        if not _nonnull_string(self.authorization_id):
            blockers.append("authorization_id")
        if not _nonnull_string(self.receipt_ref):
            blockers.append("authorization_receipt")
        if self.provider != provider:
            blockers.append("authorization_provider")
        if self.action != action:
            blockers.append("authorization_action")
        if self.dataset_manifest_hash != dataset_manifest_hash:
            blockers.append("authorization_manifest")
        if self.model != model:
            blockers.append("authorization_model")
        if self.request_hash != request_hash or not _nonnull_string(self.request_hash):
            blockers.append("authorization_request_hash")
        if self.currency != currency:
            blockers.append("authorization_currency")
        if not _finite_number(self.spend_cap_usd) or round(float(self.spend_cap_usd), 4) != round(
            float(spend_cap_usd), 4
        ):
            blockers.append("authorization_spend_cap")
        if self.issued_by.strip().lower() not in AUTHORIZED_SPEND_ISSUERS:
            blockers.append("authorization_issuer")
        if not _nonnull_string(self.authority_ref):
            blockers.append("authorization_authority")
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
            "provider": self.provider,
            "action": self.action,
            "dataset_manifest_hash": self.dataset_manifest_hash,
            "model": self.model,
            "request_hash": self.request_hash,
            "currency": self.currency,
            "spend_cap_usd": self.spend_cap_usd,
            "issued_by": self.issued_by,
            "authority_ref": self.authority_ref,
            "issued_at": self.issued_at,
            "expires_at": self.expires_at,
            "receipt_ref": self.receipt_ref,
            "single_use": self.single_use,
            "used_at": self.used_at,
        }

    def trusted_receipt_dict(self) -> dict[str, Any]:
        return self.to_dict()


class PaidAuthorizationRejected(ValueError):
    """Raised when trusted paid authorization verification fails closed."""


class PaidAuthorizationUnavailable(RuntimeError):
    """Raised when the trusted paid authorization ledger cannot be checked."""


@dataclass(frozen=True)
class PaidAuthorizationVerificationState:
    schema_version: str
    authorization_id: str
    event: str
    trusted: bool
    consumed: bool
    request_hash: str
    receipt_ref: str
    ledger_ref: str
    consumed_at: str | None = None
    blockers: list[str] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "authorization_id": self.authorization_id,
            "event": self.event,
            "trusted": self.trusted,
            "consumed": self.consumed,
            "request_hash": self.request_hash,
            "receipt_ref": self.receipt_ref,
            "ledger_ref": self.ledger_ref,
            "consumed_at": self.consumed_at,
            "blockers": list(self.blockers or []),
        }


class PaidAuthorizationVerifier(Protocol):
    def verify_and_consume(
        self,
        authorization: PaidEventAuthorization,
        *,
        request: CanonicalFineTuneRequest | None = None,
        request_hash: str | None = None,
        provider: str,
        action: str,
        max_approved_cost: float,
        currency: str,
        consumer_ref: str,
        now: str | datetime | None = None,
    ) -> PaidAuthorizationVerificationState: ...


class PaidAuthorizationLedger:
    """Append-only trusted ledger with atomic per-authorization consumption."""

    def __init__(self, path: str | Path, *, lock_timeout_seconds: float = 5.0) -> None:
        self.path = Path(path)
        self.lock_timeout_seconds = lock_timeout_seconds

    def record_authorized(self, authorization: PaidEventAuthorization) -> None:
        self._append(
            {
                "schema_version": TRUSTED_AUTHORIZATION_LEDGER_SCHEMA_VERSION,
                "event": "authorized",
                "authorization_id": authorization.authorization_id,
                "authorization": authorization.trusted_receipt_dict(),
                "receipt_hash": _sha256_json(authorization.trusted_receipt_dict()),
                "recorded_at": datetime.now(UTC).isoformat(),
            }
        )

    def record_revoked(self, authorization_id: str, *, reason: str) -> None:
        self._append(
            {
                "schema_version": TRUSTED_AUTHORIZATION_LEDGER_SCHEMA_VERSION,
                "event": "revoked",
                "authorization_id": authorization_id,
                "reason": reason,
                "recorded_at": datetime.now(UTC).isoformat(),
            }
        )

    def authorization_state(self, authorization_id: str) -> dict[str, Any]:
        state = self._state_for(authorization_id)
        return state["latest"] if state["latest"] is not None else {"event": "unknown"}

    def verify_and_consume(
        self,
        authorization: PaidEventAuthorization,
        *,
        request: CanonicalFineTuneRequest | None = None,
        request_hash: str | None = None,
        provider: str,
        action: str,
        max_approved_cost: float,
        currency: str,
        consumer_ref: str,
        now: str | datetime | None = None,
    ) -> PaidAuthorizationVerificationState:
        expected_request_hash = request.request_hash if request is not None else request_hash
        if not _nonnull_string(expected_request_hash):
            raise PaidAuthorizationRejected("authorization rejected: missing request hash")
        check_time = _coerce_datetime(now)
        with self._locked(authorization.authorization_id):
            state = self._state_for(authorization.authorization_id)
            authorized = state["authorized"]
            latest = state["latest"]
            if authorized is None:
                raise PaidAuthorizationRejected(
                    f"authorization {authorization.authorization_id!r} rejected: unknown"
                )
            if latest is not None and latest.get("event") == "revoked":
                raise PaidAuthorizationRejected(
                    f"authorization {authorization.authorization_id!r} rejected: revoked"
                )
            if latest is not None and latest.get("event") == "consumed":
                raise PaidAuthorizationRejected(
                    f"authorization {authorization.authorization_id!r} rejected: already consumed"
                )
            trusted = authorized.get("authorization")
            if trusted != authorization.trusted_receipt_dict():
                raise PaidAuthorizationRejected(
                    f"authorization {authorization.authorization_id!r} rejected: trusted receipt mismatch"
                )
            blockers = authorization.blockers_for(
                provider=provider,
                action=action,
                dataset_manifest_hash=authorization.dataset_manifest_hash,
                model=authorization.model,
                request_hash=str(expected_request_hash),
                spend_cap_usd=max_approved_cost,
                currency=currency,
                now=check_time,
            )
            if blockers:
                raise PaidAuthorizationRejected(
                    f"authorization {authorization.authorization_id!r} rejected: {', '.join(blockers)}"
                )
            consumed_at = check_time.isoformat()
            self._append_unlocked(
                {
                    "schema_version": TRUSTED_AUTHORIZATION_LEDGER_SCHEMA_VERSION,
                    "event": "consumed",
                    "authorization_id": authorization.authorization_id,
                    "request_hash": expected_request_hash,
                    "receipt_ref": authorization.receipt_ref,
                    "consumer_ref": consumer_ref,
                    "consumed_at": consumed_at,
                    "recorded_at": consumed_at,
                }
            )
            return PaidAuthorizationVerificationState(
                schema_version=TRUSTED_AUTHORIZATION_LEDGER_SCHEMA_VERSION,
                authorization_id=authorization.authorization_id,
                event="consumed",
                trusted=True,
                consumed=True,
                request_hash=str(expected_request_hash),
                receipt_ref=authorization.receipt_ref,
                ledger_ref=str(self.path),
                consumed_at=consumed_at,
                blockers=[],
            )

    def _state_for(self, authorization_id: str) -> dict[str, Any]:
        authorized: dict[str, Any] | None = None
        latest: dict[str, Any] | None = None
        for record in self._read_all():
            if record.get("authorization_id") != authorization_id:
                continue
            if record.get("event") == "authorized":
                authorized = record
                latest = record
            elif record.get("event") in {"revoked", "consumed"}:
                latest = record
        return {"authorized": authorized, "latest": latest}

    def _append(self, record: dict[str, Any]) -> None:
        with self._locked(str(record.get("authorization_id") or "ledger")):
            self._append_unlocked(record)

    def _append_unlocked(self, record: dict[str, Any]) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(_redact_secretish(record), sort_keys=True, allow_nan=False))
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
        except OSError as exc:
            raise PaidAuthorizationUnavailable(
                f"trusted paid-authorization ledger unavailable: {self.path}: {exc}"
            ) from exc

    def _read_all(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        if not self.path.is_file():
            raise PaidAuthorizationUnavailable(
                f"trusted paid-authorization ledger unavailable: {self.path} is not a file"
            )
        rows: list[dict[str, Any]] = []
        try:
            with self.path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        parsed = json.loads(line)
                        if isinstance(parsed, dict):
                            rows.append(parsed)
        except (OSError, json.JSONDecodeError) as exc:
            raise PaidAuthorizationUnavailable(
                f"trusted paid-authorization ledger unavailable: {self.path}: {exc}"
            ) from exc
        return rows

    def _locked(self, authorization_id: str) -> "_LedgerLock":
        return _LedgerLock(self.path, authorization_id, timeout_seconds=self.lock_timeout_seconds)


class _LedgerLock:
    def __init__(self, ledger_path: Path, authorization_id: str, *, timeout_seconds: float) -> None:
        safe_id = re.sub(r"[^A-Za-z0-9_.-]", "_", authorization_id) or "ledger"
        self.lock_path = ledger_path.with_name(f"{ledger_path.name}.{safe_id}.lock")
        self.timeout_seconds = timeout_seconds
        self._fd: int | None = None

    def __enter__(self) -> "_LedgerLock":
        deadline = time.monotonic() + self.timeout_seconds
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        while True:
            try:
                self._fd = os.open(
                    self.lock_path,
                    os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                )
                os.write(self._fd, str(os.getpid()).encode("ascii"))
                return self
            except (FileExistsError, PermissionError) as exc:
                # Windows can report an existing lock file as PermissionError
                # while another process/thread still owns the file handle.
                if time.monotonic() >= deadline:
                    raise PaidAuthorizationUnavailable(
                        f"trusted paid-authorization ledger lock timed out: {self.lock_path}"
                    ) from exc
                time.sleep(0.005)
            except OSError as exc:
                raise PaidAuthorizationUnavailable(
                    f"trusted paid-authorization ledger lock unavailable: {self.lock_path}: {exc}"
                ) from exc

    def __exit__(self, *exc_info: object) -> None:
        if self._fd is not None:
            os.close(self._fd)
            self._fd = None
        try:
            self.lock_path.unlink(missing_ok=True)
        except OSError:
            pass


def _coerce_datetime(value: str | datetime | None) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    parsed = _parse_iso_timestamp(value) if value is not None else None
    return parsed or datetime.now(UTC)


@dataclass(frozen=True)
class TogetherPriceEstimate:
    """Authoritative Together ``/fine-tunes/estimate-price`` result plus receipt."""

    provider: str
    request_schema_version: str
    request_hash: str
    estimated_total_price: float
    allowed_to_proceed: bool
    estimated_train_token_count: int
    estimated_eval_token_count: int = 0
    receipt_ref: str | None = None
    issued_at: str | None = None
    estimation_available: bool = True
    user_limit: float | None = None
    raw_evidence_hash: str | None = None
    raw: dict[str, Any] | None = None

    @classmethod
    def from_response(
        cls,
        data: dict[str, Any],
        *,
        receipt_ref: str | None,
        request: CanonicalFineTuneRequest,
        issued_at: str | None = None,
    ) -> "TogetherPriceEstimate":
        redacted_raw = _redact_secretish(data)
        return cls(
            provider=request.provider,
            request_schema_version=request.schema_version,
            request_hash=request.request_hash,
            estimated_total_price=float(data.get("estimated_total_price") or 0.0),
            allowed_to_proceed=bool(data.get("allowed_to_proceed")),
            estimated_train_token_count=int(data.get("estimated_train_token_count") or 0),
            estimated_eval_token_count=int(data.get("estimated_eval_token_count") or 0),
            receipt_ref=receipt_ref,
            issued_at=issued_at or datetime.now(UTC).isoformat(),
            estimation_available=bool(data.get("estimation_available", True)),
            user_limit=float(data["user_limit"]) if data.get("user_limit") is not None else None,
            raw_evidence_hash=_sha256_json(redacted_raw),
            raw=redacted_raw,
        )

    def blockers_for(
        self,
        *,
        request: CanonicalFineTuneRequest | None = None,
        local_estimate_usd: float,
        local_training_tokens: int,
        local_validation_tokens: int,
        spend_cap_usd: float,
    ) -> list[str]:
        blockers: list[str] = []
        if self.provider != DEFAULT_TOGETHER_PROVIDER:
            blockers.append("estimate_provider")
        if self.request_schema_version != CANONICAL_FINETUNE_REQUEST_SCHEMA_VERSION:
            blockers.append("estimate_request_schema")
        if request is not None and self.request_hash != request.request_hash:
            blockers.append("estimate_request_hash")
        if not _nonnull_string(self.request_hash):
            blockers.append("estimate_request_hash")
        if not _nonnull_string(self.receipt_ref):
            blockers.append("together_estimate_receipt")
        if _parse_iso_timestamp(self.issued_at) is None:
            blockers.append("together_estimate_issued_at")
        if not self.estimation_available:
            blockers.append("together_estimate_unavailable")
        if not self.allowed_to_proceed:
            blockers.append("together_estimate_allowed")
        if not _finite_number(self.estimated_total_price) or self.estimated_total_price <= 0:
            blockers.append("together_estimate_price")
        if (
            _finite_number(self.estimated_total_price)
            and self.estimated_total_price > spend_cap_usd
        ):
            blockers.append("budget")
        if (
            _finite_number(self.estimated_total_price)
            and self.estimated_total_price > local_estimate_usd + 0.01
        ):
            blockers.append("estimate_mismatch")
        if (
            self.estimated_train_token_count < 0
            or self.estimated_train_token_count > local_training_tokens
        ):
            blockers.append("estimate_mismatch")
        if (
            self.estimated_eval_token_count < 0
            or self.estimated_eval_token_count > local_validation_tokens
        ):
            blockers.append("estimate_mismatch")
        return blockers

    def _raw_hash(self) -> str | None:
        if self.raw_evidence_hash:
            return self.raw_evidence_hash
        if self.raw is None:
            return None
        return _sha256_json(_redact_secretish(self.raw))

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "request_schema_version": self.request_schema_version,
            "request_hash": self.request_hash,
            "estimated_total_price": self.estimated_total_price,
            "allowed_to_proceed": self.allowed_to_proceed,
            "estimated_train_token_count": self.estimated_train_token_count,
            "estimated_eval_token_count": self.estimated_eval_token_count,
            "receipt_ref": self.receipt_ref,
            "issued_at": self.issued_at,
            "estimation_available": self.estimation_available,
            "user_limit": self.user_limit,
            "raw_evidence_hash": self._raw_hash(),
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
    authorization_verification_state: dict[str, Any] | None = None

    def blockers_for(
        self,
        *,
        action: str,
        dataset_manifest_hash: str,
        model: str,
        request: CanonicalFineTuneRequest | None = None,
        request_hash: str | None = None,
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
                    provider=DEFAULT_TOGETHER_PROVIDER,
                    action=action,
                    dataset_manifest_hash=dataset_manifest_hash,
                    model=model,
                    request_hash=request.request_hash
                    if request is not None
                    else (request_hash or ""),
                    spend_cap_usd=spend_cap_usd,
                    currency=DEFAULT_CURRENCY,
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
                    request=request,
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
            "authorization_verification_state": dict(self.authorization_verification_state or {}),
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
    manifest_hash: str | None
    canonical_request_schema_version: str | None
    canonical_request_hash: str | None
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
    warnings: list[str]
    would_upload: bool
    would_create_job: bool
    paid_gate_report: Any | None
    model_support_receipt_ref: str | None
    authorization: PaidEventAuthorization | None
    authorization_verification_state: dict[str, Any] | None
    together_estimate: TogetherPriceEstimate | None
    endpoint_lifecycle_plan: dict[str, Any] | None
    wire_verification_ref: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "train_file": self.train_file,
            "validation_file": self.validation_file,
            "model": self.model,
            "manifest_hash": self.manifest_hash,
            "canonical_request_schema_version": self.canonical_request_schema_version,
            "canonical_request_hash": self.canonical_request_hash,
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
            "warnings": list(self.warnings),
            "would_upload": self.would_upload,
            "would_create_job": self.would_create_job,
            "paid_gate_report": _coerce_report(self.paid_gate_report),
            "model_support_receipt_ref": self.model_support_receipt_ref,
            "authorization": self.authorization.to_dict() if self.authorization else None,
            "authorization_verification_state": dict(self.authorization_verification_state or {}),
            "authorization_expires_at": self.authorization.expires_at
            if self.authorization
            else None,
            "authorization_consumption_state": "unconsumed"
            if self.authorization and self.authorization.used_at is None
            else "missing_or_consumed",
            "together_estimate": self.together_estimate.to_dict()
            if self.together_estimate
            else None,
            "endpoint_lifecycle_plan": dict(self.endpoint_lifecycle_plan or {}),
            "wire_verification_ref": self.wire_verification_ref,
            "dry_run": True,
            "executed": False,
            "upload_occurred": False,
            "fine_tune_job_created": False,
            "endpoint_created": False,
            "authorization_consumed": False,
            "spend_occurred": False,
            "deployment_occurred": False,
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
    training_file_id: str | None = None,
    validation_file_id: str | None = None,
    suffix: str | None = None,
    paid_gate_report: Any | None = None,
    manifest_hash: str | None = None,
    model_support_receipt_ref: str | None = None,
    authorization: PaidEventAuthorization | None = None,
    authorization_verification_state: dict[str, Any] | None = None,
    together_estimate: TogetherPriceEstimate | None = None,
    epochs: int = 3,
    n_evals: int = 0,
    n_checkpoints: int | None = None,
    seed: int | None = None,
    train_on_inputs: bool | str | None = None,
    packing: bool | None = None,
    learning_rate: float | None = None,
    lora_r: int | None = None,
    lora_alpha: int | None = None,
    lora_dropout: float | None = None,
    lora_trainable_modules: str | None = None,
    lora: bool = True,
    method: str = "sft",
    wire_verification_ref: str = DEFAULT_WIRE_VERIFICATION_REF,
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
    warnings: list[str] = []
    try:
        guard.precheck(estimated_cost)
    except BudgetExceeded:
        blocking.append("budget")

    if not _nonnull_string(model):
        blocking.append("model")
    canonical_request: CanonicalFineTuneRequest | None = None
    if _nonnull_string(training_file_id) and _nonnull_string(model):
        canonical_request = canonical_finetune_request(
            training_file_id=str(training_file_id),
            validation_file=validation_file_id,
            model=str(model),
            suffix=suffix,
            n_epochs=epochs,
            n_evals=n_evals,
            n_checkpoints=n_checkpoints,
            seed=seed,
            train_on_inputs=train_on_inputs,
            packing=packing,
            learning_rate=learning_rate,
            lora_r=lora_r,
            lora_alpha=lora_alpha,
            lora_dropout=lora_dropout,
            lora_trainable_modules=lora_trainable_modules,
            lora=lora,
            training_method=method,
        )
    else:
        blocking.append("canonical_request_hash")
    approval = FineTuneApprovalEvidence(
        paid_gate_report=paid_gate_report,
        dataset_manifest_hash=manifest_hash,
        model_support_receipt_ref=model_support_receipt_ref,
        authorization=authorization,
        local_estimate_usd=local_estimate,
        together_estimate=together_estimate,
        authorization_verification_state=authorization_verification_state,
    )
    blocking.extend(
        approval.blockers_for(
            action=ACTION_CREATE_FINETUNE_JOB,
            dataset_manifest_hash=manifest_hash or "",
            model=model or "",
            request=canonical_request,
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
        manifest_hash=manifest_hash,
        canonical_request_schema_version=canonical_request.schema_version
        if canonical_request
        else None,
        canonical_request_hash=canonical_request.request_hash if canonical_request else None,
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
        warnings=warnings,
        would_upload=allowed,
        would_create_job=allowed,
        paid_gate_report=paid_gate_report,
        model_support_receipt_ref=model_support_receipt_ref,
        authorization=authorization,
        authorization_verification_state=authorization_verification_state,
        together_estimate=together_estimate,
        endpoint_lifecycle_plan={
            "temporary_endpoint_required": False,
            "temporary_endpoint_created": False,
            "cleanup_required_if_created": True,
        },
        wire_verification_ref=wire_verification_ref,
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
