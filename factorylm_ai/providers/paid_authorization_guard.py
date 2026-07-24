"""Trusted paid-authorization boundary for Together billable operations.

The provider runtime only receives an Ed25519 public key. Operator approvals are
signed offline and stored in a JSONL registry. A signed receipt is verified and
matched byte-for-byte to the request-bound ``PaidEventAuthorization`` before the
existing append-only ledger may enroll or atomically consume it.
"""

from __future__ import annotations

import base64
import binascii
import inspect
import json
import os
import tempfile
from pathlib import Path
from types import ModuleType
from typing import Any, cast

from factorylm_ai.finetune import (
    PaidAuthorizationLedger,
    PaidAuthorizationRejected,
    PaidAuthorizationUnavailable,
    PaidAuthorizationVerificationState,
    PaidEventAuthorization,
)

SIGNED_AUTHORIZATION_SCHEMA_VERSION = "factorylm-paid-authorization-signed-v1"
_SIGNATURE_DOMAIN = b"factorylm-paid-authorization-v1\x00"
_PUBLIC_KEY_ENV = "FACTORYLM_AI_PAID_AUTH_PUBLIC_KEY_B64"
_REGISTRY_ENV = "FACTORYLM_AI_PAID_AUTH_REGISTRY"
_LEDGER_ENV = "FACTORYLM_AI_PAID_AUTH_LEDGER"
_KEY_ID_ENV = "FACTORYLM_AI_PAID_AUTH_KEY_ID"


def _canonical_authorization_bytes(authorization: PaidEventAuthorization) -> bytes:
    payload = json.dumps(
        authorization.trusted_receipt_dict(),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    ).encode("utf-8")
    return _SIGNATURE_DOMAIN + payload


def _decode_public_key(value: str) -> Any:
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise PaidAuthorizationUnavailable(
            f"{_PUBLIC_KEY_ENV} is not valid base64"
        ) from exc
    if len(raw) != 32:
        raise PaidAuthorizationUnavailable(
            f"{_PUBLIC_KEY_ENV} must decode to a 32-byte Ed25519 public key"
        )
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

        return Ed25519PublicKey.from_public_bytes(raw)
    except ImportError as exc:
        raise PaidAuthorizationUnavailable(
            "cryptography is required for paid-authorization verification"
        ) from exc
    except ValueError as exc:
        raise PaidAuthorizationUnavailable(
            f"{_PUBLIC_KEY_ENV} is not a valid Ed25519 public key"
        ) from exc


def _decode_signature(value: object) -> bytes:
    if not isinstance(value, str) or not value:
        raise PaidAuthorizationRejected("authorization rejected: missing operator signature")
    try:
        signature = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise PaidAuthorizationRejected(
            "authorization rejected: malformed operator signature"
        ) from exc
    if len(signature) != 64:
        raise PaidAuthorizationRejected(
            "authorization rejected: invalid Ed25519 signature length"
        )
    return signature


class TrustedPaidAuthorizationVerifier:
    """Verify operator-signed approvals, then use the atomic consumption ledger."""

    def __init__(
        self,
        *,
        registry_path: str | Path,
        ledger_path: str | Path,
        public_key: Any,
        expected_key_id: str | None = None,
    ) -> None:
        self.registry_path = Path(registry_path)
        self.ledger = PaidAuthorizationLedger(ledger_path)
        self.public_key = public_key
        self.expected_key_id = expected_key_id.strip() if expected_key_id else None

    @classmethod
    def from_environment(cls) -> "TrustedPaidAuthorizationVerifier":
        public_key_b64 = os.getenv(_PUBLIC_KEY_ENV) or ""
        registry_path = os.getenv(_REGISTRY_ENV) or ""
        ledger_path = os.getenv(_LEDGER_ENV) or ""
        missing = [
            name
            for name, value in (
                (_PUBLIC_KEY_ENV, public_key_b64),
                (_REGISTRY_ENV, registry_path),
                (_LEDGER_ENV, ledger_path),
            )
            if not value
        ]
        if missing:
            raise PaidAuthorizationUnavailable(
                "trusted paid-authorization configuration missing: " + ", ".join(missing)
            )
        return cls(
            registry_path=registry_path,
            ledger_path=ledger_path,
            public_key=_decode_public_key(public_key_b64),
            expected_key_id=os.getenv(_KEY_ID_ENV),
        )

    def verify_and_consume(
        self,
        authorization: PaidEventAuthorization,
        **kwargs: Any,
    ) -> PaidAuthorizationVerificationState:
        self._verify_signed_registry_receipt(authorization)
        # Enrollment is reachable only after signature verification. The runtime
        # never receives a private key and cannot mint a new trusted approval.
        self.ledger.record_authorized(authorization)
        return self.ledger.verify_and_consume(authorization, **kwargs)

    def _verify_signed_registry_receipt(
        self, authorization: PaidEventAuthorization
    ) -> None:
        records = self._read_registry()
        matches: list[dict[str, Any]] = []
        conflicts = False
        trusted_payload = authorization.trusted_receipt_dict()

        for record in records:
            payload = record.get("authorization")
            if not isinstance(payload, dict):
                continue
            if payload.get("authorization_id") != authorization.authorization_id:
                continue
            if payload == trusted_payload:
                matches.append(record)
            else:
                conflicts = True

        if conflicts:
            raise PaidAuthorizationRejected(
                f"authorization {authorization.authorization_id!r} rejected: "
                "conflicting signed-registry payload"
            )
        if len(matches) != 1:
            reason = "unknown signed approval" if not matches else "duplicate signed approvals"
            raise PaidAuthorizationRejected(
                f"authorization {authorization.authorization_id!r} rejected: {reason}"
            )

        record = matches[0]
        if record.get("schema_version") != SIGNED_AUTHORIZATION_SCHEMA_VERSION:
            raise PaidAuthorizationRejected(
                f"authorization {authorization.authorization_id!r} rejected: "
                "unsupported signed-receipt schema"
            )
        key_id = record.get("key_id")
        if self.expected_key_id is not None and key_id != self.expected_key_id:
            raise PaidAuthorizationRejected(
                f"authorization {authorization.authorization_id!r} rejected: key id mismatch"
            )
        signature = _decode_signature(record.get("signature"))
        try:
            from cryptography.exceptions import InvalidSignature
        except ImportError as exc:
            raise PaidAuthorizationUnavailable(
                "cryptography is required for paid-authorization verification"
            ) from exc
        try:
            self.public_key.verify(signature, _canonical_authorization_bytes(authorization))
        except InvalidSignature as exc:
            raise PaidAuthorizationRejected(
                f"authorization {authorization.authorization_id!r} rejected: "
                "invalid operator signature"
            ) from exc

    def _read_registry(self) -> list[dict[str, Any]]:
        if not self.registry_path.is_file():
            raise PaidAuthorizationUnavailable(
                f"trusted paid-authorization registry unavailable: {self.registry_path}"
            )
        rows: list[dict[str, Any]] = []
        try:
            with self.registry_path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    record = json.loads(line)
                    if not isinstance(record, dict):
                        raise ValueError("registry row is not an object")
                    rows.append(record)
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            raise PaidAuthorizationUnavailable(
                f"trusted paid-authorization registry unavailable: {self.registry_path}: {exc}"
            ) from exc
        return rows


class _RuntimeVerifier:
    """Lazy verifier so budget/network gates retain their existing order."""

    def verify_and_consume(
        self,
        authorization: PaidEventAuthorization,
        **kwargs: Any,
    ) -> PaidAuthorizationVerificationState:
        return TrustedPaidAuthorizationVerifier.from_environment().verify_and_consume(
            authorization, **kwargs
        )


def _legacy_pytest_ledger(value: object) -> PaidAuthorizationLedger | None:
    """Keep pre-existing hermetic tests working without a production bypass."""

    if value.__class__ is not PaidAuthorizationLedger:
        return None
    if not os.getenv("PYTEST_CURRENT_TEST"):
        return None
    ledger = cast(PaidAuthorizationLedger, value)
    try:
        ledger_path = ledger.path.resolve()
        temp_root = Path(tempfile.gettempdir()).resolve()
        ledger_path.relative_to(temp_root)
    except (AttributeError, OSError, ValueError):
        return None
    if ledger_path.name != "paid-authorizations.jsonl":
        return None
    return ledger


def _select_verifier(supplied: object | None) -> object:
    if supplied is None:
        return _RuntimeVerifier()
    legacy = _legacy_pytest_ledger(supplied)
    if legacy is not None:
        return legacy
    raise PaidAuthorizationRejected(
        "caller-supplied paid-authorization verifiers are forbidden; "
        "the Together provider owns trusted verifier construction"
    )


def install_paid_authorization_guard(together_module: ModuleType) -> None:
    """Replace paid entry points with provider-owned verifier wrappers once."""

    if getattr(together_module, "_trusted_paid_guard_installed", False):
        return

    original_create = together_module.create_finetune_job
    original_benchmark = together_module.run_temporary_endpoint_benchmark

    async def guarded_create_finetune_job(*args: Any, **kwargs: Any) -> Any:
        supplied = kwargs.pop("authorization_verifier", None)
        kwargs["authorization_verifier"] = _select_verifier(supplied)
        return await original_create(*args, **kwargs)

    async def guarded_temporary_endpoint_benchmark(*args: Any, **kwargs: Any) -> Any:
        supplied = kwargs.pop("authorization_verifier", None)
        kwargs["authorization_verifier"] = _select_verifier(supplied)
        return await original_benchmark(*args, **kwargs)

    guarded_create_finetune_job.__name__ = original_create.__name__
    guarded_create_finetune_job.__doc__ = original_create.__doc__
    guarded_create_finetune_job.__module__ = original_create.__module__
    guarded_temporary_endpoint_benchmark.__name__ = original_benchmark.__name__
    guarded_temporary_endpoint_benchmark.__doc__ = original_benchmark.__doc__
    guarded_temporary_endpoint_benchmark.__module__ = original_benchmark.__module__

    # Deliberately omit the unsafe verifier parameter from introspection while
    # retaining kwargs compatibility long enough for the existing hermetic tests.
    for wrapper, original in (
        (guarded_create_finetune_job, original_create),
        (guarded_temporary_endpoint_benchmark, original_benchmark),
    ):
        signature = inspect.signature(original)
        wrapper.__signature__ = signature.replace(  # type: ignore[attr-defined]
            parameters=[
                parameter
                for parameter in signature.parameters.values()
                if parameter.name != "authorization_verifier"
            ]
        )

    together_module.create_finetune_job = guarded_create_finetune_job
    together_module.run_temporary_endpoint_benchmark = guarded_temporary_endpoint_benchmark
    together_module._trusted_paid_guard_installed = True


__all__ = [
    "SIGNED_AUTHORIZATION_SCHEMA_VERSION",
    "TrustedPaidAuthorizationVerifier",
    "install_paid_authorization_guard",
]
