"""Capability-gated provider routing — fail-closed enforcement (PR-A).

The acceptance rule these tests pin: a provider must never be assigned a
capability it has not explicitly passed; full_reconstruction is unavailable
until BOTH reconstruction capabilities are qualified somewhere.
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense.providers import (  # noqa: E402
    CAPABILITIES,
    CapabilityUnavailable,
    capability_status,
    load_registry,
    reconstruction_gate,
    select_provider,
)


def _reg(**providers):
    return {"providers": providers}


def test_committed_registry_loads_and_is_shape_valid():
    reg = load_registry()
    assert reg["providers"], "registry must not be empty"
    for caps in reg["providers"].values():
        for cap, rec in caps.items():
            if cap.startswith("_"):
                continue
            assert cap in CAPABILITIES
            assert rec["status"] in {"qualified", "disqualified", "untested"}


def test_no_provider_in_committed_registry_is_broadly_qualified():
    reg = load_registry()
    for name, caps in reg["providers"].items():
        statuses = {rec["status"] for cap, rec in caps.items()
                    if not cap.startswith("_")}
        assert statuses != {"qualified"}, (
            f"{name} is qualified for EVERYTHING — capability-specific "
            f"qualification only; re-run the probes")


def test_select_returns_only_explicitly_qualified():
    reg = _reg(a={"device_inventory": {"status": "qualified", "evidence": "x"}},
               b={"device_inventory": {"status": "disqualified", "evidence": "x"}})
    assert select_provider("device_inventory", registry=reg) == "a"


def test_disqualified_and_untested_never_selectable():
    reg = _reg(a={"device_inventory": {"status": "disqualified", "evidence": "x"}},
               b={"device_inventory": {"status": "untested"}})
    with pytest.raises(CapabilityUnavailable):
        select_provider("device_inventory", registry=reg)


def test_unknown_provider_defaults_untested_and_fails_closed():
    assert capability_status("nope/model", "device_inventory",
                             registry=_reg()) == "untested"
    with pytest.raises(CapabilityUnavailable):
        select_provider("device_inventory", candidates=["nope/model"],
                        registry=_reg())


def test_unknown_capability_rejected():
    with pytest.raises(ValueError):
        capability_status("a", "broadly_smart", registry=_reg())


def test_missing_evidence_on_qualified_is_a_registry_error(tmp_path):
    bad = tmp_path / "caps.json"
    bad.write_text('{"providers": {"a": {"device_inventory": '
                   '{"status": "qualified"}}}}', encoding="utf-8")
    with pytest.raises(ValueError):
        load_registry(bad)


def test_reconstruction_gate_fails_closed_today():
    """On the committed registry, full_reconstruction must be unavailable
    (2026-07-16 bake-off: every reachable provider disqualified on xrefs)."""
    out = reconstruction_gate()
    assert out["state"] == "advanced_reasoning_unavailable"
    assert "queue" in out["action"]


def test_reconstruction_gate_opens_only_with_both_capabilities():
    reg = _reg(f={"cross_reference_extraction": {"status": "qualified", "evidence": "x"},
                  "system_reconstruction": {"status": "qualified", "evidence": "x"}})
    out = reconstruction_gate(registry=reg)
    assert out["state"] == "available"
    reg2 = _reg(f={"cross_reference_extraction": {"status": "qualified", "evidence": "x"},
                   "system_reconstruction": {"status": "disqualified", "evidence": "x"}})
    assert reconstruction_gate(registry=reg2)["state"] == "advanced_reasoning_unavailable"
