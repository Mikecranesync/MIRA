"""End-to-end Ignition chat round-trip test.

Spec / issue: GitHub #1626 (audit task D10).
Architecture: docs/mira-ignition-secure-architecture.md §9 D10.

What this exercises end-to-end:
    Ignition WebDev (signed by mira-pipeline/ignition_chat.signing-compatible
    HMAC) → POST /api/v1/ignition/chat → Supervisor engine → audit_log row
    → GET /api/v1/audit returns the row.

Run locally (services already up via `docker compose up -d`):
    MIRA_IGNITION_HMAC_KEY=$(doppler secrets get MIRA_IGNITION_HMAC_KEY \
        --project factorylm --config dev --plain) \\
    PIPELINE_URL=http://localhost:9099 \\
        python3 -m pytest tests/e2e/ignition_chat_roundtrip.py -v

Run against staging (after Doppler setup):
    doppler run -p factorylm -c stg -- \\
        python3 -m pytest tests/e2e/ignition_chat_roundtrip.py -v

The test SKIPS (does not fail) when env is incomplete — this is by design
so the file can ship in CI without requiring all CI runners to have a live
pipeline + NeonDB at hand. The smoke-test.yml wiring is tracked separately
(D10 acceptance item).
"""

from __future__ import annotations

import hashlib
import hmac as _hmac
import json
import os
import time
import uuid

import httpx
import pytest

PIPELINE_URL = os.getenv("PIPELINE_URL", "http://localhost:9099").rstrip("/")
HMAC_KEY = os.getenv("MIRA_IGNITION_HMAC_KEY", "")
TENANT_ID = os.getenv("E2E_TENANT_ID", "11111111-1111-1111-1111-111111111111")
TIMEOUT = httpx.Timeout(45.0)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _sign(key: str, tenant: str, body_bytes: bytes) -> dict[str, str]:
    """Produce the same headers the Jython WebDev client sends.

    Mirrors ignition/webdev/FactoryLM/api/chat/signing.py build_headers()
    byte-for-byte, so a successful sign here proves the cloud verifier
    accepts the WebDev contract.
    """
    nonce = uuid.uuid4().hex
    ts = int(time.time())
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    signed_string = f"{tenant}\n{nonce}\n{ts}\n{body_hash}"
    signature = _hmac.new(
        key.encode("utf-8"),
        signed_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "Content-Type": "application/json",
        "X-MIRA-Tenant": tenant,
        "X-MIRA-Nonce": nonce,
        "X-MIRA-Timestamp": str(ts),
        "X-MIRA-Signature": signature,
    }


def _require_live() -> None:
    if not HMAC_KEY:
        pytest.skip("MIRA_IGNITION_HMAC_KEY not set — skipping live E2E")
    try:
        with httpx.Client(timeout=httpx.Timeout(5.0)) as c:
            r = c.get(f"{PIPELINE_URL}/health")
            if r.status_code != 200:
                pytest.skip(f"mira-pipeline /health returned {r.status_code}")
    except httpx.HTTPError as exc:
        pytest.skip(f"mira-pipeline unreachable at {PIPELINE_URL}: {exc}")


# ── Tests ────────────────────────────────────────────────────────────────────


class TestChatRoundtrip:
    def test_signed_chat_returns_grounded_shape(self):
        """Happy path — signed POST returns the documented response shape."""
        _require_live()
        body = json.dumps(
            {
                "question": "why is the conveyor stopped?",
                "asset_id": "Conveyor_E2E",
                "tag_snapshot": {
                    "[default]Conveyor/Motor_Running": {"value": "false", "quality": "Good"},
                    "[default]Conveyor/Fault_Alarm": {"value": "true", "quality": "Good"},
                },
                "tenant_id": TENANT_ID,
            }
        ).encode()
        headers = _sign(HMAC_KEY, TENANT_ID, body)

        with httpx.Client(timeout=TIMEOUT) as c:
            resp = c.post(
                f"{PIPELINE_URL}/api/v1/ignition/chat",
                content=body,
                headers=headers,
            )

        assert resp.status_code == 200, f"status={resp.status_code} body={resp.text[:300]}"
        payload = resp.json()
        # Documented response shape from audit §3.2.
        for key in ("answer", "sources", "citations", "evidence", "tenant_id", "asset_id", "latency_ms"):
            assert key in payload, f"missing key {key} in response: {payload!r}"
        assert payload["tenant_id"] == TENANT_ID
        assert payload["asset_id"] == "Conveyor_E2E"
        assert isinstance(payload["answer"], str)

    def test_unsigned_chat_returns_401(self):
        """Defense check — unsigned POST is rejected before reaching the engine."""
        _require_live()
        body = b'{"question": "noop", "tenant_id": "x"}'
        with httpx.Client(timeout=TIMEOUT) as c:
            resp = c.post(
                f"{PIPELINE_URL}/api/v1/ignition/chat",
                content=body,
                headers={"Content-Type": "application/json"},
            )
        assert resp.status_code == 401, f"expected 401, got {resp.status_code}"

    def test_audit_row_written_after_chat(self):
        """After a successful chat, GET /api/v1/audit returns at least one row
        for this tenant whose chat_id matches the engine's per-asset key."""
        _require_live()
        # Use a fresh tenant-local prompt so we can locate our row deterministically.
        marker = f"e2e-marker-{uuid.uuid4().hex[:8]}"
        chat_body = json.dumps(
            {
                "question": f"{marker} why did conveyor pause?",
                "asset_id": "Conveyor_E2E",
                "tag_snapshot": {
                    "[default]Conveyor/Motor_Running": {"value": "false", "quality": "Good"},
                },
                "tenant_id": TENANT_ID,
            }
        ).encode()
        with httpx.Client(timeout=TIMEOUT) as c:
            r1 = c.post(
                f"{PIPELINE_URL}/api/v1/ignition/chat",
                content=chat_body,
                headers=_sign(HMAC_KEY, TENANT_ID, chat_body),
            )
            assert r1.status_code == 200, r1.text[:300]

            # Audit read — different body (GET has no body but the verifier
            # signs the empty body just the same).
            audit_body = b""
            r2 = c.get(
                f"{PIPELINE_URL}/api/v1/audit",
                params={"asset_id": "Conveyor_E2E", "limit": 20},
                headers=_sign(HMAC_KEY, TENANT_ID, audit_body),
            )
            assert r2.status_code == 200, r2.text[:300]

        rows = r2.json().get("rows", [])
        matches = [r for r in rows if marker in (r.get("prompt") or "")]
        assert matches, (
            f"audit row with marker {marker!r} not found "
            f"in {len(rows)} recent rows (NEON_DATABASE_URL configured?)"
        )
        row = matches[0]
        assert row["status"] == "ok"
        assert row["asset_id"] == "Conveyor_E2E"
        # Tag snapshot is preserved as the read list.
        assert "[default]Conveyor/Motor_Running" in row.get("tag_reads_json", [])

    def test_no_tag_outside_allowlist_should_reach_audit(self):
        """The cloud trusts the WebDev side to enforce the allowlist; we assert
        only that whatever the test sends is what the audit row records — no
        cross-contamination, no silent tag injection."""
        _require_live()
        marker = f"e2e-allowlist-{uuid.uuid4().hex[:8]}"
        clean_paths = ["[default]Conveyor/Motor_Running"]
        body = json.dumps(
            {
                "question": f"{marker} status check",
                "asset_id": "Conveyor_E2E",
                "tag_snapshot": {p: {"value": "x", "quality": "Good"} for p in clean_paths},
                "tenant_id": TENANT_ID,
            }
        ).encode()
        with httpx.Client(timeout=TIMEOUT) as c:
            r1 = c.post(
                f"{PIPELINE_URL}/api/v1/ignition/chat",
                content=body,
                headers=_sign(HMAC_KEY, TENANT_ID, body),
            )
            assert r1.status_code == 200, r1.text[:300]

            r2 = c.get(
                f"{PIPELINE_URL}/api/v1/audit",
                params={"asset_id": "Conveyor_E2E", "limit": 20},
                headers=_sign(HMAC_KEY, TENANT_ID, b""),
            )
            assert r2.status_code == 200

        rows = r2.json().get("rows", [])
        match = next((r for r in rows if marker in (r.get("prompt") or "")), None)
        assert match is not None, f"marker {marker!r} not found in audit"
        # The audit record's tag_reads matches what was sent — set equality.
        assert set(match.get("tag_reads_json", [])) == set(clean_paths)
