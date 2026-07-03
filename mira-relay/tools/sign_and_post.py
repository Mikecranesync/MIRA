"""CLI: sign and POST a single tag reading to mira-relay's HMAC-protected
``POST /api/v1/tags/ingest`` endpoint.

Usage (run from inside ``mira-relay/`` so ``ingest_contract``/``auth`` import
the same way ``mira-relay/pyproject.toml``'s ``pythonpath = ["."]`` resolves
them for pytest):

    cd mira-relay
    python -m tools.sign_and_post \\
        --url https://api.factorylm.com/api/v1/tags/ingest \\
        --tenant e88bd0e8-8a84-4e30-9803-c0dc6efb07fe \\
        --key-env MIRA_IGNITION_HMAC_KEY \\
        --tag "[default]Conveyor/VFD_Hz" --value 60.0 --value-type float \\
        --source-system ignition

Add ``--dry-run`` to print the body + headers (the HMAC key is masked — never
printed) without POSTing. This is how ``tests/test_sign_and_post.py`` proves
the signer and ``auth.verify_hmac`` agree, with zero network I/O.

Signing contract (mirrors ``mira-relay/auth.py`` and the canonical
``simlab/publishers.py:274-321 RelayIngestPublisher._hmac_headers``):

    signed_string = f"{tenant}\\n{nonce}\\n{timestamp}\\n{sha256_hex(body_bytes)}"
    signature = hmac_sha256(key, signed_string)

Headers: ``X-MIRA-Tenant``, ``X-MIRA-Nonce``, ``X-MIRA-Timestamp``,
``X-MIRA-Signature``. The body bytes are the deterministic serialization
(``separators=(",", ":")``) of the canonical ``ingest_contract.build_ingest_batch``
payload — HMAC signs the EXACT bytes sent, so never re-encode after signing.

The HMAC key is read from an environment variable only (``--key-env``, never
a CLI flag) and is never logged or printed, in any mode.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any

# Runnable both as `python -m tools.sign_and_post` (cwd=mira-relay/, where
# pythonpath=["."] / the -m cwd-insertion already puts mira-relay/ on
# sys.path) and as a standalone script from any cwd — insert mira-relay/ (the
# parent of this tools/ package) so `ingest_contract` resolves either way.
_MIRA_RELAY_DIR = Path(__file__).resolve().parents[1]
if str(_MIRA_RELAY_DIR) not in sys.path:
    sys.path.insert(0, str(_MIRA_RELAY_DIR))

from ingest_contract import build_ingest_batch, build_tag_entry  # noqa: E402

VALID_VALUE_TYPES = ("bool", "int", "float", "string", "enum")
VALID_QUALITY = ("good", "bad", "stale", "uncertain")
VALID_SOURCE_SYSTEMS = ("ignition", "plc_bridge", "relay", "simulator")


def _coerce_value(raw: str, value_type: str) -> Any:
    """Coerce the CLI ``--value`` string per ``--value-type``. Mirrors the
    shapes ``tag_ingest._canonical_value``/``_value_columns`` expect on the
    relay side (bool as True/False, int/float numeric, string/enum as-is)."""
    if value_type == "bool":
        return raw.strip().lower() in ("true", "1", "on", "yes")
    if value_type == "int":
        return int(raw)
    if value_type == "float":
        return float(raw)
    return raw  # string | enum


def build_signed_request(
    *,
    tenant_id: str,
    key: str,
    tag_path: str,
    value: Any,
    value_type: str = "string",
    quality: str = "good",
    source_system: str = "ignition",
    source_connection_id: str | None = None,
    ts: str | None = None,
    nonce: str | None = None,
    timestamp: int | None = None,
) -> tuple[bytes, dict[str, str]]:
    """Build the canonical single-tag batch body + HMAC headers.

    Pure function — no I/O — so it is directly unit-testable against
    ``auth.verify_hmac`` without a network call. ``tenant_id`` is carried on
    the ``X-MIRA-Tenant`` header only (HMAC mode); the body omits
    ``tenant_id`` per ``ingest_contract.build_ingest_batch``'s HMAC-caller
    convention (see that module's docstring).
    """
    tag_entry = build_tag_entry(tag_path, value, value_type=value_type, quality=quality, ts=ts)
    payload = build_ingest_batch(
        source_system,
        [tag_entry],
        tenant_id=None,
        source_connection_id=source_connection_id,
    )
    body_bytes = json.dumps(payload, separators=(",", ":")).encode()

    nonce = nonce or uuid.uuid4().hex
    ts_int = timestamp if timestamp is not None else int(time.time())
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    signed_string = f"{tenant_id}\n{nonce}\n{ts_int}\n{body_hash}"
    signature = hmac.new(key.encode(), signed_string.encode(), hashlib.sha256).hexdigest()

    headers = {
        "Content-Type": "application/json",
        "X-MIRA-Tenant": tenant_id,
        "X-MIRA-Nonce": nonce,
        "X-MIRA-Timestamp": str(ts_int),
        "X-MIRA-Signature": signature,
    }
    return body_bytes, headers


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="sign_and_post",
        description="Sign and POST one tag reading to mira-relay's POST /api/v1/tags/ingest.",
    )
    p.add_argument(
        "--url", required=True,
        help="Full ingest URL, e.g. https://api.factorylm.com/api/v1/tags/ingest",
    )
    p.add_argument("--tenant", required=True, help="Tenant UUID (sent as X-MIRA-Tenant)")
    p.add_argument(
        "--key-env", default="MIRA_IGNITION_HMAC_KEY",
        help="Env var holding the HMAC key (default: MIRA_IGNITION_HMAC_KEY). "
        "The key is NEVER accepted as a CLI flag and never printed/logged.",
    )
    p.add_argument("--tag", required=True, dest="tag_path", help="Raw source tag path, e.g. '[default]Conveyor/VFD_Hz'")
    p.add_argument("--value", required=True, help="Raw value, coerced per --value-type")
    p.add_argument("--value-type", default="float", choices=VALID_VALUE_TYPES)
    p.add_argument("--quality", default="good", choices=VALID_QUALITY)
    p.add_argument("--source-system", default="ignition", choices=VALID_SOURCE_SYSTEMS)
    p.add_argument("--source-connection-id", default=None)
    p.add_argument(
        "--dry-run", action="store_true",
        help="Print the body + headers (key masked) without POSTing.",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    key = os.getenv(args.key_env, "")
    if not key:
        print(
            f"error: environment variable {args.key_env} is not set "
            "(the HMAC key is never passed on the command line)",
            file=sys.stderr,
        )
        return 2

    try:
        value = _coerce_value(args.value, args.value_type)
    except ValueError as exc:
        print(f"error: could not coerce --value {args.value!r} as {args.value_type}: {exc}", file=sys.stderr)
        return 2

    body_bytes, headers = build_signed_request(
        tenant_id=args.tenant,
        key=key,
        tag_path=args.tag_path,
        value=value,
        value_type=args.value_type,
        quality=args.quality,
        source_system=args.source_system,
        source_connection_id=args.source_connection_id,
    )

    if args.dry_run:
        print("Body:", body_bytes.decode())
        print("Headers:")
        for k, v in headers.items():
            print(f"  {k}: {v}")
        print(f"(HMAC key read from ${args.key_env} -- not printed)")
        return 0

    import httpx  # lazy — not required for --dry-run / unit tests

    resp = httpx.post(args.url, content=body_bytes, headers=headers, timeout=10)
    print(f"HTTP {resp.status_code}")
    try:
        print(json.dumps(resp.json(), indent=2))
    except ValueError:
        print(resp.text)
    return 0 if resp.status_code == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
