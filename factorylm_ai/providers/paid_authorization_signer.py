"""Operator-side signer for paid Together authorizations.

The counterpart to :mod:`paid_authorization_guard`: the guard VERIFIES
Ed25519-signed approvals and deliberately cannot mint them — which means the
operator needs an offline tool that can. This is that tool. It never runs in
the paid runtime, never talks to a network, and never prints private key
material.

Trust model (mirrors the guard):

- The private key lives at an operator-chosen path OUTSIDE the repository.
  ``keygen`` refuses a destination inside the repo tree so the key cannot be
  committed by accident.
- ``sign`` canonically serializes the request-bound
  :class:`~factorylm_ai.finetune.PaidEventAuthorization` with the guard's own
  :func:`~factorylm_ai.providers.paid_authorization_guard._canonical_authorization_bytes`
  — the signer and verifier can never disagree about the signed bytes because
  they share the one implementation.
- The signed receipt is appended to the JSONL registry the guard reads. One
  registry row per ``authorization_id``: the guard rejects duplicates, so the
  signer refuses to create them.
- ``verify`` is a local self-check: it re-verifies the registry receipt against
  the public key WITHOUT touching the consumption ledger, so checking an
  approval does not spend it.
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from factorylm_ai.finetune import PaidEventAuthorization
from factorylm_ai.providers.paid_authorization_guard import (
    SIGNED_AUTHORIZATION_SCHEMA_VERSION,
    _canonical_authorization_bytes,
    _decode_public_key,
    _decode_signature,
)


class SignerError(ValueError):
    """A signing-side refusal. Always fail closed; never sign around it."""


def _repo_root() -> Path | None:
    """Best-effort repository root, for the keep-keys-out-of-the-repo guard."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    top = out.stdout.strip()
    return Path(top).resolve() if top else None


def _refuse_in_repo(path: Path, what: str) -> None:
    root = _repo_root()
    if root is None:
        return
    resolved = path.resolve()
    if resolved == root or root in resolved.parents:
        raise SignerError(
            f"{what} path {resolved} is inside the repository ({root}). "
            "Private key material must never live in the repo tree — choose a "
            "location outside it."
        )


def generate_keypair(private_key_path: Path) -> dict[str, str]:
    """Create an Ed25519 keypair; write the private key, return public info only.

    The returned dict deliberately contains NO private material — callers may
    print it verbatim.
    """
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    _refuse_in_repo(private_key_path, "private key")
    if private_key_path.exists():
        raise SignerError(
            f"refusing to overwrite existing key at {private_key_path} — move or "
            "delete it deliberately first"
        )

    private_key = Ed25519PrivateKey.generate()
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    private_key_path.parent.mkdir(parents=True, exist_ok=True)
    private_key_path.write_bytes(pem)
    try:  # POSIX only; harmless no-op semantics on Windows.
        private_key_path.chmod(0o600)
    except OSError:
        pass

    public_raw = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    public_b64 = base64.b64encode(public_raw).decode("ascii")
    return {
        "public_key_b64": public_b64,
        "private_key_path": str(private_key_path.resolve()),
        "env_hint": "export FACTORYLM_AI_PAID_AUTH_PUBLIC_KEY_B64=" + public_b64,
    }


def _load_private_key(private_key_path: Path) -> Any:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    try:
        pem = private_key_path.read_bytes()
    except OSError as exc:
        raise SignerError(f"cannot read private key at {private_key_path}: {exc}") from exc
    try:
        key = serialization.load_pem_private_key(pem, password=None)
    except (ValueError, TypeError) as exc:
        raise SignerError(f"{private_key_path} is not an unencrypted PEM private key") from exc
    if not isinstance(key, Ed25519PrivateKey):
        raise SignerError(f"{private_key_path} is not an Ed25519 key")
    return key


def _load_authorization(authorization_path: Path) -> PaidEventAuthorization:
    try:
        data = json.loads(authorization_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SignerError(f"cannot read authorization JSON {authorization_path}: {exc}") from exc
    if not isinstance(data, dict):
        raise SignerError("authorization JSON must be a single object")
    try:
        authorization = PaidEventAuthorization(**data)
    except TypeError as exc:
        raise SignerError(
            f"authorization JSON does not match PaidEventAuthorization: {exc}"
        ) from exc
    if authorization.used_at is not None:
        raise SignerError(
            "refusing to sign an authorization with used_at set — a fresh approval "
            "must be unconsumed"
        )
    return authorization


def _read_registry_rows(registry_path: Path) -> list[dict[str, Any]]:
    if not registry_path.exists():
        return []
    rows: list[dict[str, Any]] = []
    try:
        with registry_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                if not isinstance(record, dict):
                    raise ValueError("registry row is not an object")
                rows.append(record)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise SignerError(f"registry {registry_path} is unreadable: {exc}") from exc
    return rows


def sign_authorization(
    *,
    private_key_path: Path,
    authorization_path: Path,
    registry_path: Path,
    key_id: str | None = None,
) -> dict[str, Any]:
    """Sign one authorization and append its receipt to the registry.

    Refuses if the registry already carries the ``authorization_id`` — the
    guard rejects duplicate approvals (even byte-identical ones), so appending
    a second row would brick the authorization rather than renew it.
    """
    authorization = _load_authorization(authorization_path)
    private_key = _load_private_key(private_key_path)

    for row in _read_registry_rows(registry_path):
        payload = row.get("authorization")
        if (
            isinstance(payload, dict)
            and payload.get("authorization_id") == authorization.authorization_id
        ):
            raise SignerError(
                f"registry already holds authorization_id "
                f"{authorization.authorization_id!r} — the guard rejects duplicate "
                "approvals; mint a NEW authorization_id for a new approval"
            )

    signature = private_key.sign(_canonical_authorization_bytes(authorization))
    record: dict[str, Any] = {
        "schema_version": SIGNED_AUTHORIZATION_SCHEMA_VERSION,
        "authorization": authorization.trusted_receipt_dict(),
        "signature": base64.b64encode(signature).decode("ascii"),
    }
    if key_id:
        record["key_id"] = key_id

    registry_path.parent.mkdir(parents=True, exist_ok=True)
    with registry_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")

    return {
        "authorization_id": authorization.authorization_id,
        "action": authorization.action,
        "model": authorization.model,
        "spend_cap_usd": authorization.spend_cap_usd,
        "expires_at": authorization.expires_at,
        "registry": str(registry_path.resolve()),
    }


def verify_receipt(
    *,
    authorization_path: Path,
    registry_path: Path,
    public_key_b64: str,
    expected_key_id: str | None = None,
) -> dict[str, Any]:
    """Ledger-free self-check that the guard would accept this receipt.

    Runs the same match + signature logic as the guard's
    ``_verify_signed_registry_receipt`` but never enrolls or consumes, so a
    check does not spend the single-use approval.
    """
    from cryptography.exceptions import InvalidSignature

    authorization = _load_authorization(authorization_path)
    public_key = _decode_public_key(public_key_b64)
    trusted_payload = authorization.trusted_receipt_dict()

    matches: list[dict[str, Any]] = []
    conflicts = 0
    for row in _read_registry_rows(registry_path):
        payload = row.get("authorization")
        if not isinstance(payload, dict):
            continue
        if payload.get("authorization_id") != authorization.authorization_id:
            continue
        if payload == trusted_payload:
            matches.append(row)
        else:
            conflicts += 1

    if conflicts:
        raise SignerError("registry holds a CONFLICTING payload for this authorization_id")
    if len(matches) != 1:
        raise SignerError(
            "no signed approval in the registry for this authorization"
            if not matches
            else "duplicate signed approvals — the guard will reject this"
        )
    record = matches[0]
    if record.get("schema_version") != SIGNED_AUTHORIZATION_SCHEMA_VERSION:
        raise SignerError("unsupported signed-receipt schema version")
    if expected_key_id is not None and record.get("key_id") != expected_key_id:
        raise SignerError("key id mismatch")
    signature = _decode_signature(record.get("signature"))
    try:
        public_key.verify(signature, _canonical_authorization_bytes(authorization))
    except InvalidSignature as exc:
        raise SignerError("signature does not verify against the public key") from exc

    return {
        "authorization_id": authorization.authorization_id,
        "verified": True,
        "key_id": record.get("key_id"),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="sign_paid_authorization",
        description=(
            "Offline operator signer for paid Together authorizations. "
            "Counterpart to the runtime guard, which can only verify."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_keygen = sub.add_parser("keygen", help="generate an Ed25519 operator keypair")
    p_keygen.add_argument(
        "--private-key",
        required=True,
        type=Path,
        help="destination for the private key (MUST be outside the repository)",
    )

    p_sign = sub.add_parser("sign", help="sign one authorization into the registry")
    p_sign.add_argument("--private-key", required=True, type=Path)
    p_sign.add_argument(
        "--authorization",
        required=True,
        type=Path,
        help="JSON file carrying the PaidEventAuthorization fields",
    )
    p_sign.add_argument("--registry", required=True, type=Path)
    p_sign.add_argument("--key-id", default=None)

    p_verify = sub.add_parser("verify", help="ledger-free self-check of a signed receipt")
    p_verify.add_argument("--authorization", required=True, type=Path)
    p_verify.add_argument("--registry", required=True, type=Path)
    p_verify.add_argument("--public-key-b64", required=True)
    p_verify.add_argument("--key-id", default=None)

    args = parser.parse_args(argv)
    try:
        if args.command == "keygen":
            result = generate_keypair(args.private_key)
        elif args.command == "sign":
            result = sign_authorization(
                private_key_path=args.private_key,
                authorization_path=args.authorization,
                registry_path=args.registry,
                key_id=args.key_id,
            )
        else:
            result = verify_receipt(
                authorization_path=args.authorization,
                registry_path=args.registry,
                public_key_b64=args.public_key_b64,
                expected_key_id=args.key_id,
            )
    except SignerError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
