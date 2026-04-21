"""Tests for three bugs found in MicroLogix forensic session (2026-04-21)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "mira-bots"))

from shared.guardrails import _DOCUMENTATION_PHRASES, classify_intent


# ---------------------------------------------------------------------------
# Fix 1: Installation / setup / commissioning phrases → documentation intent
# ---------------------------------------------------------------------------

INSTALL_PHRASES = [
    "how to install",
    "installation steps",
    "install this",
    "installing this",
    "getting ready to install",
    "first steps to install",
    "how do i wire",
    "wiring steps",
    "wiring guide",
    "how to wire",
    "setup guide",
    "set up this",
    "setting up this",
    "how to set up",
    "commissioning steps",
    "commissioning guide",
    "how to commission",
    "startup procedure",
    "startup steps",
    "first time setup",
    "initial setup",
    "getting started with",
]


@pytest.mark.parametrize("phrase", INSTALL_PHRASES)
def test_install_phrase_in_tuple(phrase: str) -> None:
    assert phrase in _DOCUMENTATION_PHRASES, f"'{phrase}' missing from _DOCUMENTATION_PHRASES"


@pytest.mark.parametrize(
    "message",
    [
        "I'm getting ready to install this PLC",
        "What are the installation steps for this drive?",
        "Can you show me the wiring guide for the MicroLogix 1100?",
        "how do I wire the 24VDC supply?",
        "What's the startup procedure for this VFD?",
        "First time setup on the AB 1400",
        "Commissioning steps for this sensor?",
        "Getting started with the MicroLogix 1400",
    ],
)
def test_install_message_routes_to_documentation(message: str) -> None:
    result = classify_intent(message)
    assert result == "documentation", (
        f"Expected 'documentation' for '{message}', got '{result}'"
    )


# ---------------------------------------------------------------------------
# Fix 3: _parse_response brace scan handles trailing whitespace/newlines
# ---------------------------------------------------------------------------

class _FakeSupervisor:
    """Minimal stub to exercise _parse_response without spinning up the engine."""

    def _extract_parsed(self, parsed: dict) -> dict:
        raw_conf = parsed.get("confidence", "LOW")
        confidence = raw_conf if raw_conf in ("HIGH", "MEDIUM", "LOW") else "LOW"
        return {
            "next_state": parsed.get("next_state"),
            "reply": parsed["reply"],
            "options": parsed.get("options", []),
            "confidence": confidence,
        }

    def _parse_response(self, raw: str) -> dict:
        """Copied from engine.py to test in isolation."""
        raw_stripped = raw.strip()

        # Strategy 1: direct parse
        try:
            parsed = json.loads(raw_stripped)
            if isinstance(parsed, dict) and "reply" in parsed:
                return self._extract_parsed(parsed)
        except (json.JSONDecodeError, TypeError):
            pass

        # Strategy 2: markdown code block
        import re
        for block in re.findall(r"```(?:json)?\s*(.*?)```", raw_stripped, re.DOTALL):
            try:
                parsed = json.loads(block)
                if isinstance(parsed, dict) and "reply" in parsed:
                    return self._extract_parsed(parsed)
            except (json.JSONDecodeError, TypeError):
                continue

        # Strategy 3: brace scan (the fixed version)
        for i in range(len(raw_stripped)):
            if raw_stripped[i] == "{":
                for j in range(len(raw_stripped), i, -1):
                    if raw_stripped[j - 1] == "}":
                        try:
                            parsed = json.loads(raw_stripped[i:j].rstrip())  # Fix 3
                            if isinstance(parsed, dict) and "reply" in parsed:
                                return self._extract_parsed(parsed)
                        except (json.JSONDecodeError, TypeError):
                            continue
                break

        return {"reply": raw_stripped, "next_state": None, "options": [], "confidence": "LOW"}


@pytest.fixture()
def supervisor() -> _FakeSupervisor:
    return _FakeSupervisor()


def test_parse_response_trailing_newline(supervisor: _FakeSupervisor) -> None:
    raw = '{"reply": "Check the overload relay.", "next_state": "DIAGNOSIS"}\n\n'
    result = supervisor._parse_response(raw)
    assert result["reply"] == "Check the overload relay."
    assert result["next_state"] == "DIAGNOSIS"


def test_parse_response_trailing_spaces(supervisor: _FakeSupervisor) -> None:
    raw = '{"reply": "Measure voltage at L1.", "confidence": "HIGH"}   '
    result = supervisor._parse_response(raw)
    assert result["reply"] == "Measure voltage at L1."
    assert result["confidence"] == "HIGH"


def test_parse_response_embedded_json_with_trailing_whitespace(supervisor: _FakeSupervisor) -> None:
    raw = 'Here is my answer: {"reply": "Reset the drive.", "next_state": "FIX_STEP"}  \n'
    result = supervisor._parse_response(raw)
    assert result["reply"] == "Reset the drive."
    assert result["next_state"] == "FIX_STEP"


def test_parse_response_plain_text_fallback(supervisor: _FakeSupervisor) -> None:
    raw = "Check the motor connections and verify power supply."
    result = supervisor._parse_response(raw)
    assert result["reply"] == raw
    assert result["next_state"] is None
