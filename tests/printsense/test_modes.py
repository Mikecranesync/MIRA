"""Degraded product modes — honest-claim contracts (PR-B)."""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import modes  # noqa: E402


def test_scout_banner_verbatim():
    env = modes.package_scout_envelope({"devices": []})
    assert env["banner"] == ("Preliminary package inventory — full system "
                             "reconstruction has not been performed.")
    assert env["system_reconstruction_performed"] is False
    assert env["degraded_mode_reason"]


def test_one_off_page_never_claims_reconstruction():
    env = modes.one_off_page_envelope({"devices": []})
    assert env["scope"] == "single_page"
    assert env["system_reconstruction_performed"] is False
    assert env["system_reconstruction_claim_forbidden"] is True
    assert "honest_uncertainty" in env["supported"]


def test_full_reconstruction_gate_closed_on_committed_registry():
    out = modes.full_reconstruction_entry()
    assert out["state"] == "advanced_reasoning_unavailable"
    assert out["system_reconstruction_performed"] is False
    assert "queue" in out["action"]


def test_full_reconstruction_opens_only_with_both_capabilities_qualified():
    reg = {"providers": {"f": {
        "cross_reference_extraction": {"status": "qualified", "evidence": "x"},
        "system_reconstruction": {"status": "qualified", "evidence": "x"}}}}
    out = modes.full_reconstruction_entry(registry=reg)
    assert out["state"] == "available"
    assert out["providers"]["xref"] == "f"
