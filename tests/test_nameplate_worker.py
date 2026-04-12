"""Tests for NameplateWorker — vision-based nameplate field extraction.

All tests are offline: the InferenceRouter.complete() method is mocked so no
network calls are made.  Fixture images live in tests/fixtures/.
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

# Make mira-bots importable from the repo root.
REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

from shared.workers.nameplate_worker import NAMEPLATE_FIELDS, NameplateWorker  # noqa: E402

FIXTURES = REPO_ROOT / "tests" / "fixtures"


# ── Helpers ──────────────────────────────────────────────────────────────────


def _b64_fixture(name: str) -> str:
    """Return base64-encoded contents of a fixture JPEG."""
    path = FIXTURES / name
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _make_worker() -> NameplateWorker:
    """Return a NameplateWorker with no real endpoints configured."""
    return NameplateWorker(openwebui_url="", api_key="", vision_model="test-model")


# ── Tests ────────────────────────────────────────────────────────────────────


class TestExtractsGs10Fields:
    """Router returns well-formed JSON — all expected fields present and correct."""

    @pytest.mark.asyncio
    async def test_extracts_gs10_fields(self):
        canned_json = (
            '{"manufacturer": "AutomationDirect", "model": "GS1-45P0", '
            '"serial": "AD2024-78956", "voltage": "460V", '
            '"fla": "12A", "hp": "5", "frequency": "60Hz", "rpm": null}'
        )

        worker = _make_worker()
        photo_b64 = _b64_fixture("nameplate_gs10.jpg")

        with patch.object(
            worker._router,
            "complete",
            new=AsyncMock(
                return_value=(
                    canned_json,
                    {"provider": "claude", "input_tokens": 10, "output_tokens": 20},
                )
            ),
        ):
            result = await worker.extract(photo_b64)

        assert result["manufacturer"] == "AutomationDirect"
        assert result["model"] == "GS1-45P0"
        assert result["serial"] == "AD2024-78956"
        assert result["voltage"] == "460V"
        assert result["fla"] == "12A"
        assert result["hp"] == "5"
        assert result["frequency"] == "60Hz"
        assert result.get("rpm") is None
        # All canonical fields must be present in the returned dict.
        for field in NAMEPLATE_FIELDS:
            assert field in result, f"Missing field: {field}"


class TestHandlesMissingFields:
    """Router returns partial JSON (FANUC nameplate — fewer fields visible).

    Fields not in the JSON response must appear in the result as None.
    """

    @pytest.mark.asyncio
    async def test_handles_missing_fields(self):
        partial_json = '{"manufacturer": "FANUC", "model": "R-2000iC/165F"}'

        worker = _make_worker()
        photo_b64 = _b64_fixture("nameplate_fanuc.jpg")

        with patch.object(
            worker._router,
            "complete",
            new=AsyncMock(
                return_value=(
                    partial_json,
                    {"provider": "claude", "input_tokens": 8, "output_tokens": 10},
                )
            ),
        ):
            result = await worker.extract(photo_b64)

        assert result["manufacturer"] == "FANUC"
        assert result["model"] == "R-2000iC/165F"

        # Fields absent in the model response must be None, not KeyError.
        for field in ("serial", "voltage", "fla", "hp", "frequency", "rpm"):
            assert result[field] is None, f"Expected None for {field}, got {result[field]!r}"


class TestHandlesInvalidJson:
    """Router returns plain prose instead of JSON — worker must not raise."""

    @pytest.mark.asyncio
    async def test_handles_invalid_json(self):
        prose = (
            "I can see a nameplate on this industrial drive. "
            "The manufacturer appears to be AutomationDirect but I cannot "
            "read the model number clearly."
        )

        worker = _make_worker()
        photo_b64 = _b64_fixture("nameplate_gs10.jpg")

        with patch.object(
            worker._router,
            "complete",
            new=AsyncMock(
                return_value=(prose, {"provider": "groq", "input_tokens": 5, "output_tokens": 30})
            ),
        ):
            result = await worker.extract(photo_b64)

        # Must not raise — must return a dict with a parse_error key.
        assert isinstance(result, dict)
        assert "parse_error" in result
        # Must NOT raise an exception — that's the key contract.


class TestPromptAsksForJson:
    """Verify the messages passed to the router contain JSON and all field names."""

    @pytest.mark.asyncio
    async def test_prompt_asks_for_json(self):
        worker = _make_worker()
        photo_b64 = _b64_fixture("nameplate_gs10.jpg")

        captured: list[list[dict]] = []

        async def capture_complete(messages, **kwargs):
            captured.append(messages)
            # Return valid JSON so extract() doesn't short-circuit.
            return ('{"manufacturer": "Test"}', {})

        with patch.object(worker._router, "complete", new=capture_complete):
            await worker.extract(photo_b64)

        assert captured, "complete() was never called"
        messages = captured[0]

        # Collect all text content from the messages.
        full_text = ""
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                full_text += content
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        full_text += block.get("text", "")

        full_text_lower = full_text.lower()

        assert "json" in full_text_lower, "Prompt must mention JSON"

        for field in ("manufacturer", "model", "serial", "voltage", "fla", "hp"):
            assert field in full_text_lower, f"Prompt must mention field: {field}"
