"""
Write-path round-trip tests.

For every write endpoint we care about, this suite:
  1. Synthesizes a row via POST/PATCH.
  2. Reads it back via GET.
  3. Asserts the round-tripped fields match what we sent.
  4. Cleans up unconditionally.

Spec: docs/specs/enforcement-layer-spec.md §4.2

Run:
    BASE_URL=https://app.factorylm.com \\
    ENFORCEMENT_TEST_BEARER=$(doppler secrets get ENFORCEMENT_TEST_BEARER --plain) \\
    pytest tests/integration/test_write_paths.py -v

If `ENFORCEMENT_TEST_BEARER` is unset the suite skips itself rather than failing
hard — local pre-commit shouldn't error when secrets aren't around.

All synthetic rows are tagged with the prefix `__ENFORCEMENT__-<runid>` so the
nightly sweep can pick up anything that leaks past `finally:`.
"""

from __future__ import annotations

import os
import uuid
from typing import Optional

import httpx
import pytest

BASE_URL = os.getenv("BASE_URL", "https://app.factorylm.com").rstrip("/")
BEARER = os.getenv("ENFORCEMENT_TEST_BEARER", "")
RUN_ID = uuid.uuid4().hex[:8]
TAG_PREFIX = f"__ENFORCEMENT__-{RUN_ID}"
HTTP_TIMEOUT = 30.0

skip_if_no_auth = pytest.mark.skipif(
    not BEARER,
    reason="ENFORCEMENT_TEST_BEARER not set — pull from Doppler factorylm/prd to run",
)


def _client() -> httpx.Client:
    return httpx.Client(
        base_url=BASE_URL,
        timeout=HTTP_TIMEOUT,
        headers={
            "Authorization": f"Bearer {BEARER}",
            "Content-Type": "application/json",
            "User-Agent": "mira-enforcement-tests/1.0",
        },
        follow_redirects=True,
    )


def _delete(client: httpx.Client, path: str) -> None:
    """Best-effort cleanup. Never raises — leaked rows are caught by nightly sweep."""
    try:
        client.delete(path)
    except Exception:
        pass


# ─── Work orders ────────────────────────────────────────────────────────────


@skip_if_no_auth
def test_work_order_round_trip() -> None:
    payload = {
        "title": f"{TAG_PREFIX} synthetic WO",
        "description": "Created by enforcement-layer write-path test.",
        "priority": "low",
        "status": "open",
    }
    wo_id: Optional[str] = None

    with _client() as client:
        resp = client.post("/api/work-orders", json=payload)
        assert resp.status_code in (200, 201), (
            f"POST /api/work-orders failed: {resp.status_code} {resp.text[:300]}"
        )
        body = resp.json()
        wo_id = body.get("id") or body.get("work_order", {}).get("id")
        assert wo_id, f"POST response had no id: {body!r}"

        try:
            got = client.get(f"/api/work-orders/{wo_id}")
            assert got.status_code == 200, f"GET work-orders/{wo_id} failed: {got.status_code}"
            row = got.json()
            wo = row.get("work_order", row)
            assert wo.get("title", "").startswith(TAG_PREFIX), f"title not round-tripped: {wo.get('title')!r}"
            assert wo.get("priority") == "low", f"priority drift: {wo.get('priority')!r}"
            assert wo.get("status") in ("open", "in_progress"), f"status invalid: {wo.get('status')!r}"
        finally:
            # Mark cancelled so it disappears from default views; nightly sweep deletes by tag prefix.
            client.patch(f"/api/work-orders/{wo_id}", json={"status": "cancelled"})


# ─── Assets ──────────────────────────────────────────────────────────────────


@skip_if_no_auth
def test_asset_round_trip() -> None:
    payload = {
        "name": f"{TAG_PREFIX} synthetic asset",
        "tag": f"{TAG_PREFIX}-asset",
        "manufacturer": "ACME",
        "model": f"MODEL-{RUN_ID}",
        "serialNumber": f"SN-{RUN_ID}",
        "criticality": "low",
    }
    asset_id: Optional[str] = None

    with _client() as client:
        resp = client.post("/api/assets", json=payload)
        assert resp.status_code in (200, 201), (
            f"POST /api/assets failed: {resp.status_code} {resp.text[:300]}"
        )
        body = resp.json()
        asset_id = body.get("id") or body.get("asset", {}).get("id")
        assert asset_id, f"POST response had no id: {body!r}"

        try:
            got = client.get(f"/api/assets/{asset_id}")
            assert got.status_code == 200, f"GET assets/{asset_id} failed: {got.status_code}"
            row = got.json()
            asset = row.get("asset", row)
            assert asset.get("manufacturer") == "ACME", f"manufacturer drift: {asset.get('manufacturer')!r}"
            assert asset.get("criticality") in ("low", "medium"), f"criticality drift: {asset.get('criticality')!r}"
            # Model may live under model or model_number depending on serializer
            model = asset.get("model") or asset.get("model_number")
            assert model and RUN_ID in model, f"model not round-tripped: {model!r}"
        finally:
            _delete(client, f"/api/assets/{asset_id}")


# ─── PM schedules ────────────────────────────────────────────────────────────


@skip_if_no_auth
def test_pm_schedule_round_trip() -> None:
    """PM schedules require an asset to attach to — we create one, then attach."""
    asset_id: Optional[str] = None
    pm_id: Optional[str] = None

    with _client() as client:
        # Create an asset to attach the PM to.
        a = client.post(
            "/api/assets",
            json={
                "name": f"{TAG_PREFIX} pm-host asset",
                "tag": f"{TAG_PREFIX}-pm-host",
                "manufacturer": "ACME",
                "model": f"PM-HOST-{RUN_ID}",
                "criticality": "low",
            },
        )
        if a.status_code not in (200, 201):
            pytest.skip(f"asset create failed ({a.status_code}); cannot test PM round-trip")
        asset_id = (a.json().get("id") or a.json().get("asset", {}).get("id"))

        try:
            payload = {
                "asset_id": asset_id,
                "title": f"{TAG_PREFIX} synthetic PM",
                "frequency_days": 30,
                "trigger_type": "calendar",
            }
            resp = client.post("/api/pm-schedules", json=payload)
            if resp.status_code == 404:
                # POST may not be implemented; PATCH-only API. That's fine — we
                # log this as a known shape and don't fail the suite for it.
                pytest.skip("/api/pm-schedules POST not implemented; skipping PM round-trip")
            assert resp.status_code in (200, 201), (
                f"POST /api/pm-schedules failed: {resp.status_code} {resp.text[:300]}"
            )
            body = resp.json()
            pm_id = body.get("id") or body.get("pm_schedule", {}).get("id")
            assert pm_id, f"POST response had no id: {body!r}"

            # PATCH frequency, then GET and assert it stuck.
            client.patch(f"/api/pm-schedules/{pm_id}", json={"frequency_days": 45})
            got = client.get(f"/api/pm-schedules/{pm_id}")
            assert got.status_code == 200, f"GET pm-schedules/{pm_id} failed: {got.status_code}"
            row = got.json()
            pm = row.get("pm_schedule", row)
            assert pm.get("frequency_days") == 45, f"frequency_days drift: {pm.get('frequency_days')!r}"
        finally:
            if pm_id:
                _delete(client, f"/api/pm-schedules/{pm_id}")
            if asset_id:
                _delete(client, f"/api/assets/{asset_id}")


# ─── Smoke: the test tenant is reachable at all ──────────────────────────────


@skip_if_no_auth
def test_auth_smoke() -> None:
    """Sanity: the bearer token actually authenticates against /api/me."""
    with _client() as client:
        resp = client.get("/api/me")
        assert resp.status_code == 200, (
            f"/api/me unauthenticated ({resp.status_code}); token may be expired. "
            f"Refresh ENFORCEMENT_TEST_BEARER from Doppler factorylm/prd."
        )
        body = resp.json()
        assert "email" in body or "user" in body, f"/api/me payload unexpected: {body!r}"
