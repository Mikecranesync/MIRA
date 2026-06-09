"""Tests for Supervisor._layer1_reply helpers — prompt loading and the
echo-vs-claim stripper from spec §4.0.1 / §10.1.

Spec: docs/specs/conversational-engine-upgrade-spec.md
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from shared.engine import Supervisor

# ---------------------------------------------------------------------------
# Prompt loading


def test_layer1_prompt_general_loads():
    prompt = Supervisor._load_layer1_prompt("general")
    assert prompt, "general prompt must be present"
    assert "MIRA" in prompt
    # Must enforce the never-claim-specifics rule (load-bearing per spec §10.1).
    assert "Never claim" in prompt or "never claim" in prompt.lower()


def test_layer1_prompt_clarify_loads():
    prompt = Supervisor._load_layer1_prompt("clarify")
    assert prompt
    # The clarify prompt must explicitly forbid diagnosis.
    assert "diagnosis" in prompt.lower() or "diagnose" in prompt.lower()


def test_layer1_prompt_attachment_loads():
    prompt = Supervisor._load_layer1_prompt("attachment")
    assert prompt
    assert "vision_ocr_cache" in prompt.lower() or "ocr" in prompt.lower()


def test_layer1_prompt_unknown_key_falls_back_empty():
    # Unknown key should not raise; returns "" so caller falls through.
    prompt = Supervisor._load_layer1_prompt("nonexistent_layer1_key_xyz")
    assert prompt == ""


# ---------------------------------------------------------------------------
# Echo-vs-claim stripper (§4.0.1, §10.1)


def test_strip_layer1_claims_passes_echoed_brand():
    # PowerFlex IS in uns_context — should be kept.
    uns_ctx = {
        "manufacturer": "Rockwell Automation",
        "manufacturer_alias": "rockwell",
        "product_family": "PowerFlex",
        "model": "525",
    }
    reply = "Looks like a PowerFlex 525 nameplate — what do you want to know?"
    cleaned = Supervisor._strip_layer1_claims(reply, uns_ctx, "")
    assert "PowerFlex" in cleaned
    assert "525" in cleaned


def test_strip_layer1_claims_passes_echoed_fault_from_ocr():
    # F0004 IS in vision_ocr_cache — keep it.
    reply = "I see F0004 on the drive — what would you like to know?"
    cleaned = Supervisor._strip_layer1_claims(reply, {}, "POWERFLEX 525 / FAULT F0004 / 1HP")
    assert "F0004" in cleaned


def test_strip_layer1_claims_strips_invented_brand():
    # Siemens is NOT in uns_context or OCR — must be stripped.
    uns_ctx = {"manufacturer": "Rockwell Automation"}
    reply = "Sounds like a Siemens Sinamics drive issue."
    cleaned = Supervisor._strip_layer1_claims(reply, uns_ctx, "")
    assert "siemens" not in cleaned.lower()
    assert "sinamics" not in cleaned.lower()


def test_strip_layer1_claims_strips_invented_fault_code():
    # F0099 is NOT in uns_context or OCR — must be replaced.
    reply = "That sounds like an F0099 undervoltage trip."
    cleaned = Supervisor._strip_layer1_claims(reply, {}, "")
    assert "F0099" not in cleaned
    assert "that code" in cleaned.lower()


def test_strip_layer1_claims_handles_empty_reply():
    assert Supervisor._strip_layer1_claims("", {}, "") == ""


def test_strip_layer1_claims_preserves_non_industrial_text():
    # No brands or fault codes -> reply passes through unchanged.
    reply = "What machine are you at, and what are you seeing on the screen?"
    cleaned = Supervisor._strip_layer1_claims(reply, {}, "")
    assert cleaned == reply
