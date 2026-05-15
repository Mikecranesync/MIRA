"""Tests for resolve_uns_path_multi — multi-vendor UNS resolution with KB
pair-coverage validation (the chimera filter).

Triggering bug: "Connect my Micro 820 to an AutomationDirect GS11 VFD..."
was producing the fabricated product name "AutomationDirect 820" because
the legacy resolver greedily picked one vendor + one digit-bearing token
without validating they belong together.

This file covers:
  * Multi-vendor messages return one candidate per vendor.
  * Chimeric (vendor, model) pairs get their model field cleared when the
    KB has zero rows for the pair.
  * Single-vendor messages remain backward-compatible.
  * The existing resolve_uns_path() return type is unchanged.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import patch

sys.path.insert(0, "mira-bots")

os.environ.setdefault("NEON_DATABASE_URL", "postgres://test:test@localhost/test")

from shared.uns_resolver import (  # noqa: E402
    UNSContext,
    UNSResolution,
    _match_all_vendors,
    resolve_uns_path,
    resolve_uns_path_multi,
)

# ---------------------------------------------------------------------------
# _match_all_vendors — the multi-vendor detection primitive
# ---------------------------------------------------------------------------


def test_match_all_vendors_returns_multiple_when_two_named():
    msg = (
        "i want to connect my micro 820 to an automationdirect gs11 vfd "
        "using rs485 modbus"
    )
    matches = _match_all_vendors(msg)
    canonicals = [m[0] for m in matches]
    # AutomationDirect is recognized; "micro" is not yet in the alias table
    # (Rockwell Micro 8xx aliases are a follow-up). Once added, this test
    # will exercise Rockwell as well — for now we verify the multi-vendor
    # primitive correctly returns AutomationDirect's match info.
    assert "AutomationDirect" in canonicals


def test_match_all_vendors_dedupes_canonical():
    """Two aliases that map to the same canonical vendor return one entry."""
    msg = "allen-bradley rockwell powerflex 525"
    matches = _match_all_vendors(msg)
    canonicals = [m[0] for m in matches]
    # All three aliases map to "Rockwell Automation"
    assert canonicals == ["Rockwell Automation"]


def test_match_all_vendors_sorted_by_position():
    msg = "siemens drive and a yaskawa controller and an abb meter"
    matches = _match_all_vendors(msg)
    canonicals = [m[0] for m in matches]
    assert canonicals == ["Siemens", "Yaskawa", "ABB"]


def test_match_all_vendors_two_distinct_canonicals():
    """Cross-vendor message: both vendors surface."""
    msg = "powerflex 525 connected to a gs10 drive"
    matches = _match_all_vendors(msg)
    canonicals = sorted(m[0] for m in matches)
    assert canonicals == ["AutomationDirect", "Rockwell Automation"]


def test_match_all_vendors_empty_for_no_match():
    matches = _match_all_vendors("the motor is making noise")
    assert matches == []


# ---------------------------------------------------------------------------
# resolve_uns_path_multi — wraps resolve_uns_path with multi-vendor candidates
# ---------------------------------------------------------------------------


def test_single_vendor_message_returns_one_candidate():
    """Backward-compat shape: one vendor in → one candidate out, primary
    matches resolve_uns_path()."""
    legacy = resolve_uns_path("PowerFlex 525 F0004")
    resolution = resolve_uns_path_multi("PowerFlex 525 F0004")
    assert isinstance(resolution, UNSResolution)
    assert resolution.primary.manufacturer == legacy.manufacturer
    assert resolution.primary.model == legacy.model
    assert resolution.primary.fault_code == legacy.fault_code
    assert len(resolution.candidates) == 1
    assert resolution.has_multi_vendor is False


def test_zero_vendor_message_returns_empty_candidates():
    resolution = resolve_uns_path_multi("Motor hums but won't turn")
    assert resolution.primary.manufacturer is None
    assert resolution.candidates == ()
    assert resolution.has_multi_vendor is False


def test_two_vendor_message_returns_two_candidates_without_tenant():
    """Without tenant_id the chimera filter is skipped, but the multi-vendor
    structure is still produced."""
    resolution = resolve_uns_path_multi("PowerFlex 525 connected to GS10")
    assert resolution.has_multi_vendor is True
    vendors = sorted(resolution.vendors())
    assert vendors == ["AutomationDirect", "Rockwell Automation"]


def test_chimera_filter_clears_model_when_pair_has_no_kb_rows():
    """The headline test: a (vendor, model) pair with zero KB coverage
    must have its model field cleared so the engine never speaks it.

    Scenario mirrors Mike's actual chimera message: one vendor's product
    has real KB coverage; the other pair is the chimera the filter must
    block.
    """

    def fake_pair_coverage(vendor: str, model: str, tenant_id: str):
        # The covered pair: AutomationDirect + GS11 (4,284 chunks in prod).
        if vendor == "AutomationDirect" and model == "GS11":
            return True, 4284
        # The chimera: Rockwell Automation + 525 in this test setup has no
        # rows (the engine integration PR will treat unsupported pairs as
        # "drop the model, keep the vendor").
        return False, 0

    with patch(
        "shared.uns_resolver.kb_has_pair_coverage", side_effect=fake_pair_coverage
    ):
        resolution = resolve_uns_path_multi(
            "PowerFlex 525 connected to AutomationDirect GS11",
            tenant_id="t-1",
        )

    rockwell = next(
        c for c in resolution.candidates if c.manufacturer == "Rockwell Automation"
    )
    auto_direct = next(
        c for c in resolution.candidates if c.manufacturer == "AutomationDirect"
    )
    # Chimera filter dropped the model for the unsupported pair.
    assert rockwell.model is None
    # The covered pair keeps its model.
    assert auto_direct.model == "GS11"


def test_chimera_filter_keeps_vendor_when_model_dropped():
    """Even when the model is dropped, the vendor stays so the caller can
    offer vendor-level documentation."""

    def fake_pair_coverage(vendor: str, model: str, tenant_id: str):
        return False, 0  # Nothing has coverage

    with patch(
        "shared.uns_resolver.kb_has_pair_coverage", side_effect=fake_pair_coverage
    ):
        resolution = resolve_uns_path_multi(
            "PowerFlex 525 connected to AutomationDirect GS11",
            tenant_id="t-1",
        )

    for cand in resolution.candidates:
        assert cand.manufacturer is not None  # vendor preserved
        assert cand.model is None  # chimera-filtered


def test_resolve_uns_path_unchanged_for_backward_compat():
    """The legacy resolve_uns_path return type must remain UNSContext, not
    UNSResolution. Every existing call site reads .manufacturer / .model /
    etc. directly on the result.
    """
    ctx = resolve_uns_path("PowerFlex 525 F0004")
    assert isinstance(ctx, UNSContext)
    assert ctx.manufacturer == "Rockwell Automation"
    assert ctx.model == "525"
    assert ctx.fault_code == "F0004"


def test_primary_is_first_candidate_in_message_order():
    """Primary must reflect message-order so any caller defaulting to
    `.primary` gets the same vendor the legacy resolver would have picked.
    """
    # Position-wise, "powerflex" comes before "gs10" in this message.
    resolution = resolve_uns_path_multi("PowerFlex 525 wired into GS10")
    assert resolution.primary.manufacturer == "Rockwell Automation"

    # Flip the order; primary follows.
    resolution2 = resolve_uns_path_multi("GS10 connected to a PowerFlex 525")
    assert resolution2.primary.manufacturer == "AutomationDirect"
