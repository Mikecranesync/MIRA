from __future__ import annotations

import json
import sqlite3

import pytest
from starlette.testclient import TestClient

import relay_server


@pytest.fixture
def client():
    return TestClient(relay_server.app)


def _make_payload(
    equipment_id: str = "VFD-001",
    tags: dict | None = None,
    tenant_id: str = "test-tenant",
) -> dict:
    if tags is None:
        tags = {
            "outputFrequency": {"v": 42.1, "q": "Good", "t": "2026-04-17 12:00:00"},
            "motorCurrent": {"v": 8.3, "q": "Good", "t": "2026-04-17 12:00:00"},
            "heatsinkTemp": {"v": 55.2, "q": "Good", "t": "2026-04-17 12:00:00"},
        }
    return {
        "type": "tags",
        "tenant_id": tenant_id,
        "agent_id": "ignition-test",
        "equipment": {equipment_id: tags},
    }


class TestHealth:
    def test_health_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


class TestHttpIngest:
    def test_ingest_valid_payload(self, client, _tmp_db):
        resp = client.post("/ingest", json=_make_payload())
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["equipment_count"] == 1

        db = sqlite3.connect(_tmp_db)
        db.row_factory = sqlite3.Row
        row = db.execute(
            "SELECT * FROM equipment_status WHERE equipment_id = 'VFD-001'"
        ).fetchone()
        assert row is not None
        assert row["status"] == "running"
        assert row["speed_rpm"] == pytest.approx(42.1)
        assert row["current_amps"] == pytest.approx(8.3)
        assert row["temperature_c"] == pytest.approx(55.2)
        db.close()

    def test_ingest_upsert_updates_values(self, client, _tmp_db):
        client.post("/ingest", json=_make_payload())
        updated = _make_payload(tags={
            "outputFrequency": {"v": 50.0, "q": "Good", "t": "2026-04-17 12:01:00"},
        })
        resp = client.post("/ingest", json=updated)
        assert resp.status_code == 200

        db = sqlite3.connect(_tmp_db)
        db.row_factory = sqlite3.Row
        row = db.execute(
            "SELECT * FROM equipment_status WHERE equipment_id = 'VFD-001'"
        ).fetchone()
        assert row["speed_rpm"] == pytest.approx(50.0)
        assert row["current_amps"] == pytest.approx(8.3)
        db.close()

    def test_ingest_invalid_json(self, client):
        resp = client.post("/ingest", content=b"not json", headers={"Content-Type": "application/json"})
        assert resp.status_code == 400

    def test_ingest_wrong_type(self, client):
        resp = client.post("/ingest", json={"type": "discovery", "equipment": {}})
        assert resp.status_code == 400

    def test_ingest_empty_equipment(self, client):
        resp = client.post("/ingest", json={"type": "tags", "equipment": {}})
        assert resp.status_code == 200
        assert resp.json()["equipment_count"] == 0

    def test_ingest_multiple_equipment(self, client, _tmp_db):
        payload = {
            "type": "tags",
            "tenant_id": "test",
            "agent_id": "test",
            "equipment": {
                "VFD-001": {"motorCurrent": {"v": 8.3, "q": "Good", "t": "now"}},
                "PUMP-002": {"pressurePSI": {"v": 45.0, "q": "Good", "t": "now"}},
            },
        }
        resp = client.post("/ingest", json=payload)
        assert resp.json()["equipment_count"] == 2

        db = sqlite3.connect(_tmp_db)
        rows = db.execute("SELECT COUNT(*) FROM equipment_status").fetchone()
        assert rows[0] == 2
        db.close()


class TestFaultDetection:
    def test_fault_code_creates_fault_row(self, client, _tmp_db):
        payload = _make_payload(tags={
            "motorCurrent": {"v": 8.3, "q": "Good", "t": "now"},
            "faultCode": {"v": 42, "q": "Good", "t": "now"},
        })
        resp = client.post("/ingest", json=payload)
        assert resp.status_code == 200

        db = sqlite3.connect(_tmp_db)
        db.row_factory = sqlite3.Row
        eq = db.execute("SELECT status FROM equipment_status WHERE equipment_id = 'VFD-001'").fetchone()
        assert eq["status"] == "faulted"

        fault = db.execute("SELECT * FROM faults WHERE equipment_id = 'VFD-001' AND resolved = 0").fetchone()
        assert fault is not None
        assert fault["fault_code"] == "42"
        db.close()

    def test_duplicate_fault_not_inserted(self, client, _tmp_db):
        payload = _make_payload(tags={"faultCode": {"v": 42, "q": "Good", "t": "now"}})
        client.post("/ingest", json=payload)
        client.post("/ingest", json=payload)

        db = sqlite3.connect(_tmp_db)
        count = db.execute(
            "SELECT COUNT(*) FROM faults WHERE equipment_id = 'VFD-001' AND fault_code = '42'"
        ).fetchone()[0]
        assert count == 1
        db.close()

    def test_zero_fault_code_ignored(self, client, _tmp_db):
        payload = _make_payload(tags={"faultCode": {"v": 0, "q": "Good", "t": "now"}})
        client.post("/ingest", json=payload)

        db = sqlite3.connect(_tmp_db)
        count = db.execute("SELECT COUNT(*) FROM faults").fetchone()[0]
        assert count == 0
        db.close()


class TestTagColumnMapping:
    @pytest.mark.parametrize("tag_name,column", [
        ("outputFrequency", "speed_rpm"),
        ("speedRPM", "speed_rpm"),
        ("motorCurrent", "current_amps"),
        ("outputCurrent", "current_amps"),
        ("heatsinkTemp", "temperature_c"),
        ("pressurePSI", "pressure_psi"),
    ])
    def test_known_tags_map_to_columns(self, client, _tmp_db, tag_name, column):
        payload = _make_payload(tags={tag_name: {"v": 99.9, "q": "Good", "t": "now"}})
        client.post("/ingest", json=payload)

        db = sqlite3.connect(_tmp_db)
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT * FROM equipment_status WHERE equipment_id = 'VFD-001'").fetchone()
        assert row[column] == pytest.approx(99.9)
        db.close()

    def test_unknown_tags_stored_in_metadata(self, client, _tmp_db):
        payload = _make_payload(tags={
            "customSensor": {"v": 123.4, "q": "Good", "t": "now"},
        })
        client.post("/ingest", json=payload)

        db = sqlite3.connect(_tmp_db)
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT metadata FROM equipment_status WHERE equipment_id = 'VFD-001'").fetchone()
        meta = json.loads(row["metadata"])
        assert meta["customSensor"]["v"] == 123.4
        db.close()


class TestAuth:
    def test_auth_required_when_key_set(self, client, monkeypatch):
        monkeypatch.setattr(relay_server, "RELAY_API_KEY", "secret-key-123")
        resp = client.post("/ingest", json=_make_payload())
        assert resp.status_code == 401

    def test_auth_passes_with_correct_key(self, client, _tmp_db, monkeypatch):
        monkeypatch.setattr(relay_server, "RELAY_API_KEY", "secret-key-123")
        resp = client.post(
            "/ingest",
            json=_make_payload(),
            headers={"Authorization": "Bearer secret-key-123"},
        )
        assert resp.status_code == 200

    def test_auth_not_required_when_key_empty(self, client, _tmp_db):
        resp = client.post("/ingest", json=_make_payload())
        assert resp.status_code == 200


class TestWebSocket:
    def test_ws_tag_ingest(self, client, _tmp_db):
        with client.websocket_connect("/ws") as ws:
            ws.send_json(_make_payload())
            resp = ws.receive_json()
            assert resp["type"] == "ack"
            assert resp["equipment_count"] == 1

        db = sqlite3.connect(_tmp_db)
        row = db.execute("SELECT COUNT(*) FROM equipment_status").fetchone()
        assert row[0] == 1
        db.close()

    def test_ws_ping_pong(self, client):
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "ping"})
            resp = ws.receive_json()
            assert resp["type"] == "pong"

    def test_ws_unknown_type(self, client):
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "unknown"})
            resp = ws.receive_json()
            assert "error" in resp

    def test_ws_auth_required_when_key_set(self, client, monkeypatch):
        monkeypatch.setattr(relay_server, "RELAY_API_KEY", "ws-secret")
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "auth", "token": "ws-secret"})
            resp = ws.receive_json()
            assert resp["type"] == "auth_ok"
            ws.send_json({"type": "ping"})
            resp = ws.receive_json()
            assert resp["type"] == "pong"

    def test_ws_auth_rejected_bad_token(self, client, monkeypatch):
        monkeypatch.setattr(relay_server, "RELAY_API_KEY", "ws-secret")
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "auth", "token": "wrong"})
            resp = ws.receive_json()
            assert "error" in resp


class TestProcessTagPayload:
    def test_direct_call(self, _tmp_db):
        count = relay_server.process_tag_payload(_make_payload())
        assert count == 1

    def test_string_tag_values_stored_in_metadata(self, _tmp_db):
        payload = _make_payload(tags={
            "statusText": {"v": "RUNNING", "q": "Good", "t": "now"},
        })
        count = relay_server.process_tag_payload(payload)
        assert count == 1

        db = sqlite3.connect(_tmp_db)
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT metadata FROM equipment_status WHERE equipment_id = 'VFD-001'").fetchone()
        meta = json.loads(row["metadata"])
        assert meta["statusText"]["v"] == "RUNNING"
        db.close()
