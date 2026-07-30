"""Tests for the read-only print-workspace inspection endpoints (Package C).

Constructs a minimal FastAPI app with ONLY the workspace router — never
importing ask_api.app (which builds the heavy Supervisor engine at import
time), matching the drive-pack API test idiom.

The store is seeded through the REAL Package A ingest path
(``print_workspace.ingest_print_photo`` + ``append_technician_observation``)
over the synthetic K17 fixture, hermetic and keyless: InMemory visual store
(``NEON_DATABASE_URL`` removed), tmp sqlite mapping db, no network, no LLM.
Covers auth, unknown-session 404, tenant isolation, the summary shape, the
entities trust filter, per-tag evidence with coordinates, superseded
visibility, and the never-500 contract.
"""

from __future__ import annotations

import asyncio
import os
import sys

os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

pytest.importorskip("pydantic")
pytest.importorskip("PIL")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from ask_api.workspace import router as workspace_router  # noqa: E402
from printsense.benchmarks import persistent_qa_fixture as fx  # noqa: E402
from shared import print_workspace  # noqa: E402

TENANT = "t-api"
CHAT = "chat-api"
MEASUREMENT = "I have 24V before F12 but nothing after."


def _client() -> TestClient:
    """Minimal app with only the workspace router (never ask_api.app)."""
    app = FastAPI()
    app.include_router(workspace_router)
    return TestClient(app)


async def _seed_workspace() -> dict:
    """Wide shot + technician measurement + K17 close-up, via the REAL Package
    A ingest path — returns ids the assertions need."""
    wide = await print_workspace.ingest_print_photo(
        CHAT,
        fx.page_png(fx.BASE),
        fx.vision_data(fx.BASE),
        "What would energize K17?",
        tenant_id=TENANT,
    )
    assert wide is not None and wide.status == "ingested"
    obs_id = await print_workspace.append_technician_observation(
        wide.session_id, TENANT, MEASUREMENT, {"value": 24.0, "unit": "V", "negated": True}
    )
    assert obs_id
    closeup = await print_workspace.ingest_print_photo(
        CHAT,
        fx.page_png(fx.CLOSE_UP_BASE),
        fx.vision_data(fx.CLOSE_UP_BASE),
        "close-up of the K17 area",
        tenant_id=TENANT,
    )
    assert closeup is not None and closeup.superseded_ids
    return {
        "session_id": wide.session_id,
        "revision": closeup.revision,
        "superseded_ids": closeup.superseded_ids,
    }


@pytest.fixture
def ws(monkeypatch, tmp_path):
    """Hermetic seeded workspace (InMemory store, tmp mapping db, auth off)."""
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    monkeypatch.delenv("ASK_API_KEY", raising=False)
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira.db"))
    monkeypatch.setenv("MIRA_PRINT_CAS_DIR", str(tmp_path / "cas"))
    print_workspace._reset_for_tests()
    seeded = asyncio.run(_seed_workspace())
    yield seeded
    print_workspace._reset_for_tests()


# --------------------------------------------------------------------------- #
# auth (request-time ASK_API_KEY, drive_pack idiom)
# --------------------------------------------------------------------------- #


def test_auth_off_allows_requests(ws):
    resp = _client().get(
        f"/workspace/{ws['session_id']}/summary", headers={"X-Mira-Tenant": TENANT}
    )
    assert resp.status_code == 200


def test_auth_on_missing_key_401(ws, monkeypatch):
    monkeypatch.setenv("ASK_API_KEY", "sekret")
    client = _client()
    for url in (
        f"/workspace/{ws['session_id']}/summary",
        f"/workspace/{ws['session_id']}/entities",
        f"/workspace/{ws['session_id']}/evidence/K17",
    ):
        resp = client.get(url, headers={"X-Mira-Tenant": TENANT})
        assert resp.status_code == 401


def test_auth_on_wrong_key_401(ws, monkeypatch):
    monkeypatch.setenv("ASK_API_KEY", "sekret")
    resp = _client().get(
        f"/workspace/{ws['session_id']}/summary",
        headers={"X-Mira-Tenant": TENANT, "X-Mira-Key": "wrong"},
    )
    assert resp.status_code == 401


def test_auth_on_correct_key_succeeds(ws, monkeypatch):
    monkeypatch.setenv("ASK_API_KEY", "sekret")
    resp = _client().get(
        f"/workspace/{ws['session_id']}/summary",
        headers={"X-Mira-Tenant": TENANT, "X-Mira-Key": "sekret"},
    )
    assert resp.status_code == 200


# --------------------------------------------------------------------------- #
# unknown session / tenant isolation
# --------------------------------------------------------------------------- #


def test_unknown_session_is_404(ws):
    client = _client()
    for url in (
        "/workspace/no-such-session/summary",
        "/workspace/no-such-session/entities",
        "/workspace/no-such-session/evidence/K17",
    ):
        resp = client.get(url, headers={"X-Mira-Tenant": TENANT})
        assert resp.status_code == 404
        assert resp.json() == {"detail": "unknown session"}


def test_foreign_tenant_sees_nothing(ws):
    """A real session id under the wrong tenant is indistinguishable from an
    unknown one — no cross-tenant existence oracle."""
    resp = _client().get(
        f"/workspace/{ws['session_id']}/summary", headers={"X-Mira-Tenant": "someone-else"}
    )
    assert resp.status_code == 404


# --------------------------------------------------------------------------- #
# summary
# --------------------------------------------------------------------------- #


def test_summary_happy_path(ws):
    resp = _client().get(
        f"/workspace/{ws['session_id']}/summary", headers={"X-Mira-Tenant": TENANT}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["session_id"] == ws["session_id"]
    assert body["tenant_id"] == TENANT
    assert body["read_only"] is True
    # the print-model version is the close-up's bumped revision
    assert body["print_model_version"] == ws["revision"]
    counts = body["counts"]
    assert counts["superseded"] == len(ws["superseded_ids"]) == 5
    assert counts["technician_reported"] == 1
    # active OCR = 11 wide + 7 close-up - 5 superseded
    assert counts["ocr_entities"] == 13
    assert counts["observations_active"] + counts["superseded"] == counts["observations_total"]
    assert body["trust_summary"]["Shown on the drawing"] == 13
    assert body["trust_summary"]["Reported by technician"] == 1
    assert "Superseded" not in body["trust_summary"]  # active mix only


# --------------------------------------------------------------------------- #
# entities (+ trust filter)
# --------------------------------------------------------------------------- #


def test_entities_lists_active_ledger_with_trust_labels(ws):
    resp = _client().get(
        f"/workspace/{ws['session_id']}/entities", headers={"X-Mira-Tenant": TENANT}
    )
    assert resp.status_code == 200
    body = resp.json()
    # 13 OCR + 1 technician + 2 LIKELY vision-description rows (one per ingest)
    assert body["count"] == len(body["entities"]) == 16
    values = {e["value"] for e in body["entities"]}
    assert {"-K17", "-F12", "21", "22", MEASUREMENT} <= values
    assert all(e["superseded"] is False for e in body["entities"])  # active view
    by_value = {e["value"]: e for e in body["entities"]}
    assert by_value["-K17"]["trust_label"] == "Shown on the drawing"
    assert by_value["-K17"]["coordinates"]["bbox"] == fx.CLOSE_UP_BASE["tokens"][0]["bbox"]
    assert by_value[MEASUREMENT]["trust_label"] == "Reported by technician"
    assert by_value[MEASUREMENT]["coordinates"] is None  # honest: no bbox stored


def test_entities_trust_filter_by_label_and_state(ws):
    client = _client()
    resp = client.get(
        f"/workspace/{ws['session_id']}/entities",
        params={"trust": "reported by technician"},
        headers={"X-Mira-Tenant": TENANT},
    )
    body = resp.json()
    assert body["count"] == 1
    assert body["entities"][0]["value"] == MEASUREMENT

    resp = client.get(
        f"/workspace/{ws['session_id']}/entities",
        params={"trust": "VISIBLE"},
        headers={"X-Mira-Tenant": TENANT},
    )
    body = resp.json()
    assert body["count"] == 13
    assert all(e["evidence_state"] == "VISIBLE" for e in body["entities"])

    resp = client.get(
        f"/workspace/{ws['session_id']}/entities",
        params={"trust": "no-such-label"},
        headers={"X-Mira-Tenant": TENANT},
    )
    assert resp.json()["count"] == 0


# --------------------------------------------------------------------------- #
# evidence per tag (coordinates + superseded history)
# --------------------------------------------------------------------------- #


def test_evidence_for_tag_includes_coordinates_and_superseded_history(ws):
    resp = _client().get(
        f"/workspace/{ws['session_id']}/evidence/K17", headers={"X-Mira-Tenant": TENANT}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["tag"] == "K17"  # unprefixed query matches "-K17" rows
    assert body["print_model_version"] == ws["revision"]
    # the wide-shot row (superseded) AND the close-up re-read, plus the
    # technician measurement that names K17's circuit? No — F12 only. So:
    ocr_rows = [o for o in body["observations"] if o["extractor"] == "ocr"]
    assert len(ocr_rows) == 2
    assert body["superseded_count"] == 1
    stale = next(o for o in ocr_rows if o["superseded"])
    fresh = next(o for o in ocr_rows if not o["superseded"])
    assert stale["evidence_state"] == "SUPERSEDED"
    assert stale["superseded_by"] == fresh["observation_id"]
    assert stale["coordinates"]["bbox"] == [640, 100, 700, 118]  # wide-shot bbox
    assert fresh["coordinates"]["bbox"] == fx.CLOSE_UP_BASE["tokens"][0]["bbox"]
    assert stale["trust_label"] == "Superseded"


def test_evidence_for_technician_referenced_tag(ws):
    body = (
        _client()
        .get(f"/workspace/{ws['session_id']}/evidence/F12", headers={"X-Mira-Tenant": TENANT})
        .json()
    )
    values = {o["value"] for o in body["observations"]}
    assert "-F12" in values
    assert MEASUREMENT in values  # the measurement mentions F12 — surfaced too
    by_value = {o["value"]: o for o in body["observations"]}
    assert by_value[MEASUREMENT]["trust_label"] == "Reported by technician"


def test_evidence_for_unknown_tag_is_honest_empty(ws):
    body = (
        _client()
        .get(f"/workspace/{ws['session_id']}/evidence/Q99", headers={"X-Mira-Tenant": TENANT})
        .json()
    )
    assert body["count"] == 0
    assert body["observations"] == []
    assert body["superseded_count"] == 0


# --------------------------------------------------------------------------- #
# never-500
# --------------------------------------------------------------------------- #


def test_store_failure_never_500s(ws, monkeypatch):
    store = print_workspace._get_service().store

    async def _boom(*args, **kwargs):
        raise RuntimeError("store broke")

    monkeypatch.setattr(store, "get_session", _boom)
    client = _client()
    for url in (
        f"/workspace/{ws['session_id']}/summary",
        f"/workspace/{ws['session_id']}/entities",
        f"/workspace/{ws['session_id']}/evidence/K17",
    ):
        resp = client.get(url, headers={"X-Mira-Tenant": TENANT})
        assert resp.status_code == 200
        assert resp.json()["error"] == "workspace_unavailable"
