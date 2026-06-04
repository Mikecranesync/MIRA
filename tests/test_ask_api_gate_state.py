"""Tests for the /ask UNS gate-state derivation (HMI-facing fields)."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from ask_api.gate_state import derive_uns_gate


def test_awaiting_confirmation_surfaces_candidate():
    state = {
        "state": "AWAITING_UNS_CONFIRMATION",
        "context": {"pending_uns_confirm": {"candidate": "Allen-Bradley, PowerFlex 525"}},
        "asset_identified": None,
    }
    g = derive_uns_gate(state)
    assert g["uns_gate_state"] == "awaiting_confirmation"
    assert g["candidate_asset"] == "Allen-Bradley, PowerFlex 525"
    assert g["confirmed_asset"] == ""


def test_answered_surfaces_confirmed_asset():
    state = {"state": "IDLE", "context": {}, "asset_identified": "Siemens, SINAMICS G120"}
    g = derive_uns_gate(state)
    assert g["uns_gate_state"] == "answered"
    assert g["confirmed_asset"] == "Siemens, SINAMICS G120"
    assert g["candidate_asset"] == ""


def test_awaiting_with_no_candidate():
    state = {"state": "AWAITING_UNS_CONFIRMATION", "context": {"pending_uns_confirm": {"candidate": None}}}
    g = derive_uns_gate(state)
    assert g["uns_gate_state"] == "awaiting_confirmation"
    assert g["candidate_asset"] == ""


def test_none_and_empty_state_default_to_answered():
    assert derive_uns_gate(None)["uns_gate_state"] == "answered"
    assert derive_uns_gate({})["uns_gate_state"] == "answered"
    assert derive_uns_gate({})["confirmed_asset"] == ""
