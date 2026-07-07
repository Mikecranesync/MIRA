"""Tests for the drive-pack Q&A HTTP endpoint.

These tests construct a minimal FastAPI app with ONLY the drive_pack router —
never importing ask_api.app (which builds the heavy Supervisor engine at import time).
This allows fast, isolated testing of the drive-pack resolution logic and HTTP layer.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ask_api.drive_pack import router as drive_pack_router


def _client() -> TestClient:
    """Create a minimal app with only the drive_pack router.

    Avoids import ask_api.app, which constructs the Supervisor engine.
    """
    app = FastAPI()
    app.include_router(drive_pack_router)
    return TestClient(app)


class TestDrivePackAskBasic:
    """Core drive-pack Q&A functionality."""

    def test_ask_ce10_resolves_gs10_from_question(self):
        """Question text alone resolves GS10 and answers CE10."""
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={"question": "what does CE10 mean on my gs10"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["matched"] is True
        assert body["answer_source"] == "drive_pack"
        assert body["fallback_used"] is False
        assert body["live_telemetry"] is False
        assert body["read_only"] is True
        assert len(body["citations"]) > 0
        assert "CE10" in body["answer"]

    def test_ask_with_explicit_drive_alias(self):
        """Drive field resolves to pack and answers question."""
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={"drive": "gs10", "question": "what causes CE10?"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["matched"] is True
        assert body["answer_source"] == "drive_pack"

    def test_ask_with_explicit_pack_id(self):
        """pack_id field is used directly (no resolution)."""
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={
                "pack_id": "durapulse_gs10",
                "question": "what is P09.03?",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["matched"] is True
        assert body["matched_kind"] == "parameter"
        assert "P09.03" in body["answer"]

    def test_ask_unmatched_question_returns_honest_answer(self):
        """Question that doesn't resolve to a pack returns UNRESOLVED dict."""
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={"question": "how do I fix my acme 9000 blender"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["matched"] is False
        assert body["answer_source"] == "none"
        assert body["resolved"] is False
        # When no pack resolves, we return UNRESOLVED with empty answer
        assert body["pack_id"] is None
        assert body["answer"] == ""


class TestDrivePackAskResolution:
    """Pack resolution strategy (pack_id > drive > question)."""

    def test_pack_id_takes_precedence_over_drive(self):
        """Explicit pack_id bypasses drive field resolution."""
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={
                "pack_id": "durapulse_gs10",
                "drive": "nonexistent",
                "question": "what is P09.03?",
            },
        )
        # Should succeed because pack_id is used directly
        assert resp.status_code == 200
        body = resp.json()
        assert body["matched"] is True

    def test_drive_takes_precedence_over_question_resolution(self):
        """Explicit drive field is resolved before question text."""
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={
                "drive": "gs10",
                "question": "what does CE10 mean?",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["matched"] is True
        assert body["pack_id"] == "durapulse_gs10"

    def test_unresolved_drive_returns_unresolved_shape(self):
        """Unknown drive alias returns UNRESOLVED dict, HTTP 200."""
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={
                "drive": "nonexistent_drive",
                "question": "what is this?",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["pack_id"] is None
        assert body["resolved"] is False
        assert body["matched"] is False
        assert body["answer"] == ""


class TestDrivePackAskAuth:
    """Optional shared-secret authentication."""

    def test_auth_off_request_without_header_succeeds(self, monkeypatch):
        """When ASK_API_KEY is not set, requests without header are allowed."""
        monkeypatch.delenv("ASK_API_KEY", raising=False)
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={"question": "what does CE10 mean on my gs10"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["matched"] is True

    def test_auth_on_request_without_header_fails(self, monkeypatch):
        """When ASK_API_KEY is set, request without X-Mira-Key header returns 401."""
        monkeypatch.setenv("ASK_API_KEY", "sekret")
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={"question": "what does CE10 mean on my gs10"},
        )
        assert resp.status_code == 401

    def test_auth_on_request_with_wrong_key_fails(self, monkeypatch):
        """When ASK_API_KEY is set, wrong X-Mira-Key header returns 401."""
        monkeypatch.setenv("ASK_API_KEY", "sekret")
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={"question": "what does CE10 mean on my gs10"},
            headers={"X-Mira-Key": "wrong"},
        )
        assert resp.status_code == 401

    def test_auth_on_request_with_correct_key_succeeds(self, monkeypatch):
        """When ASK_API_KEY is set, correct X-Mira-Key header allows the request."""
        monkeypatch.setenv("ASK_API_KEY", "sekret")
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={"question": "what does CE10 mean on my gs10"},
            headers={"X-Mira-Key": "sekret"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["matched"] is True


class TestDrivePackAskGuarantees:
    """Verify the technician-safe contract."""

    def test_fallback_used_always_false(self):
        """fallback_used is always False (no generic LLM answer)."""
        client = _client()
        for question in [
            "what does CE10 mean on my gs10",
            "how do I fix my acme 9000 blender",
        ]:
            resp = client.post("/drive-pack/ask", json={"question": question})
            assert resp.status_code == 200
            body = resp.json()
            assert body["fallback_used"] is False

    def test_live_telemetry_always_false(self):
        """live_telemetry is always False (static manual-pack only)."""
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={"question": "what does CE10 mean on my gs10"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["live_telemetry"] is False

    def test_read_only_always_true(self):
        """read_only is always True (no drive writes)."""
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={"question": "what does CE10 mean on my gs10"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["read_only"] is True

    def test_parameter_answer_includes_view_only_warning(self):
        """Parameter answers include VIEW-ONLY safety language."""
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={"pack_id": "durapulse_gs10", "question": "what is P09.03?"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["matched"] is True
        assert body["matched_kind"] == "parameter"
        assert "VIEW-ONLY" in body["answer"] or "VIEW" in body["answer"]


class TestDrivePackAskErrorHandling:
    """Graceful error handling — never 500."""

    def test_invalid_json_returns_422(self):
        """Malformed JSON returns 422 (FastAPI validation)."""
        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={"invalid_field": "value"},  # missing required 'question'
        )
        assert resp.status_code == 422

    def test_exception_in_answer_returns_unresolved_dict(self, monkeypatch):
        """If answer_question raises, catch and return UNRESOLVED dict."""
        # Simulate an error by patching answer_question to raise.
        from ask_api import drive_pack

        original_answer = drive_pack.answer_question

        def mock_answer_question(pack_id, question):
            raise ValueError("Simulated error")

        monkeypatch.setattr(drive_pack, "answer_question", mock_answer_question)

        client = _client()
        resp = client.post(
            "/drive-pack/ask",
            json={"pack_id": "durapulse_gs10", "question": "test"},
        )
        assert resp.status_code == 200
        body = resp.json()
        # Should return UNRESOLVED shape
        assert body["pack_id"] is None
        assert body["resolved"] is False
        assert body["matched"] is False

        # Restore
        monkeypatch.setattr(drive_pack, "answer_question", original_answer)
