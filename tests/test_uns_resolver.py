"""UNS message resolver — exhaustive offline tests.

Covers Mike's regression case (2026-05-13), pure-digit models adjacent to
known vendor families, fault-code-before-model precedence, carry-over across
turns, every alias in VENDOR_ALIASES, every fault pattern, path-build
correctness, and the offline guarantee (no DB calls).

Run: `python -m pytest tests/test_uns_resolver.py -v`
"""

from __future__ import annotations

import pytest
from shared.uns_resolver import (
    FAMILY_FROM_ALIAS,
    FAULT_PATTERNS,
    VENDOR_ALIASES,
    UNSContext,
    resolve_uns_path,
)

# ---------------------------------------------------------------------------
# Mike's regression case + variants
# ---------------------------------------------------------------------------


def test_mike_regression_exact_message():
    """The exact 2026-05-13 message that motivated the resolver."""
    ctx = resolve_uns_path("I have a powerflex 525 and it has it called f0004")
    assert ctx.manufacturer == "Rockwell Automation"
    assert ctx.manufacturer_alias == "powerflex"
    assert ctx.product_family == "PowerFlex"
    assert ctx.model == "525"
    assert ctx.fault_code == "F0004"
    assert ctx.fault_code_raw == "f0004"
    assert ctx.category == "fault_codes"
    assert ctx.uns_path is not None
    assert "rockwell_automation" in ctx.uns_path
    assert "525" in ctx.uns_path
    assert "f0004" in ctx.uns_path
    assert ctx.confidence == 0.9  # alias-only, all three fields


def test_powerflex_titlecase():
    ctx = resolve_uns_path("PowerFlex 525 F0004")
    assert ctx.manufacturer == "Rockwell Automation"
    assert ctx.model == "525"
    assert ctx.fault_code == "F0004"


def test_powerflex_no_fault():
    ctx = resolve_uns_path("PowerFlex 525 is humming")
    assert ctx.manufacturer == "Rockwell Automation"
    assert ctx.model == "525"
    assert ctx.fault_code is None


def test_fault_code_not_captured_as_model():
    """The historical bug: f0004 must not end up as the model."""
    ctx = resolve_uns_path("powerflex 525 f0004")
    assert ctx.model == "525", f"model should be '525', got {ctx.model!r}"
    assert ctx.model != "f0004"


# ---------------------------------------------------------------------------
# AutomationDirect / GS family
# ---------------------------------------------------------------------------


def test_gs10_oc_fault():
    ctx = resolve_uns_path("GS10 ocA fault")
    assert ctx.manufacturer == "AutomationDirect"
    # GS10 IS the model/family
    assert ctx.product_family == "GS10"
    assert ctx.fault_code is not None
    assert ctx.fault_code.lower().startswith("oc")


def test_gs20_oc():
    ctx = resolve_uns_path("My GS20 drive shows OC")
    assert ctx.manufacturer == "AutomationDirect"
    assert ctx.fault_code in ("OC", "oC")


def test_automationdirect_spelled_out():
    ctx = resolve_uns_path("AutomationDirect drive is showing E001")
    assert ctx.manufacturer == "AutomationDirect"
    assert ctx.fault_code == "E0001"


# ---------------------------------------------------------------------------
# Siemens / Mitsubishi / Yaskawa / etc.
# ---------------------------------------------------------------------------


def test_siemens_micromaster():
    ctx = resolve_uns_path("Siemens Micromaster 440 trip")
    assert ctx.manufacturer == "Siemens"
    # Micromaster is a family alias
    assert ctx.product_family in ("Micromaster", None)
    assert ctx.model == "440"


def test_mitsubishi_fr_d():
    ctx = resolve_uns_path("FR-D 700 alarm A002")
    assert ctx.manufacturer == "Mitsubishi Electric"
    assert ctx.product_family == "FR-D"
    assert ctx.fault_code == "A0002"


def test_yaskawa_simple():
    ctx = resolve_uns_path("Yaskawa A1000 drive F004")
    assert ctx.manufacturer == "Yaskawa"
    assert ctx.fault_code == "F0004"


def test_abb_singleton():
    ctx = resolve_uns_path("ABB ACS580 fault F0023")
    assert ctx.manufacturer == "ABB"
    assert ctx.fault_code == "F0023"


def test_danfoss_aqua_drive():
    ctx = resolve_uns_path("Aqua Drive showing alarm")
    assert ctx.manufacturer == "Danfoss"
    assert ctx.product_family == "AquaDrive"


def test_schneider_electric():
    ctx = resolve_uns_path("Schneider Electric Altivar 71 fault")
    assert ctx.manufacturer == "Schneider Electric"
    assert ctx.model == "71" or ctx.model == "Altivar"


def test_allen_bradley_hyphenated():
    ctx = resolve_uns_path("Allen-Bradley 1756-L73 PLC fault")
    assert ctx.manufacturer == "Rockwell Automation"


def test_allen_bradley_two_words():
    ctx = resolve_uns_path("allen bradley contactor")
    assert ctx.manufacturer == "Rockwell Automation"


# ---------------------------------------------------------------------------
# Edge cases — empty, gibberish, multiple vendors
# ---------------------------------------------------------------------------


def test_empty_message():
    ctx = resolve_uns_path("")
    assert ctx.manufacturer is None
    assert ctx.model is None
    assert ctx.fault_code is None
    assert ctx.confidence == 0.0
    assert ctx.uns_path is None


def test_gibberish():
    ctx = resolve_uns_path("Motor hums but won't turn")
    assert ctx.manufacturer is None
    assert ctx.model is None
    assert ctx.fault_code is None
    assert ctx.confidence == 0.0


def test_pure_fault_no_vendor():
    """F0004 alone — fault code identified, no vendor."""
    ctx = resolve_uns_path("seeing F0004 on the display")
    assert ctx.fault_code == "F0004"
    assert ctx.manufacturer is None
    assert ctx.confidence == 0.3


def test_multi_vendor_first_wins():
    """When two vendors appear, the resolver picks one. Document which."""
    ctx = resolve_uns_path("PowerFlex 525 not a Yaskawa")
    assert ctx.manufacturer == "Rockwell Automation"


def test_no_vendor_numeric_token_alone():
    """'525 fault' alone — 525 is ambiguous without a vendor anchor."""
    ctx = resolve_uns_path("525 fault on motor")
    # No vendor → no path. Model may be None because no vendor anchor.
    assert ctx.manufacturer is None
    assert ctx.uns_path is None


# ---------------------------------------------------------------------------
# Carry-over across turns
# ---------------------------------------------------------------------------


def test_carryover_action_request():
    """Turn 1 establishes equipment. Turn 2 'make a work order' inherits."""
    turn1 = resolve_uns_path("PowerFlex 525 F0004")
    turn2 = resolve_uns_path("make a work order", prior_ctx=turn1)
    assert turn2.manufacturer == "Rockwell Automation"
    assert turn2.model == "525"
    assert turn2.fault_code == "F0004"


def test_carryover_dict_form():
    """prior_ctx can be a dict (engine state round-trip via SQLite)."""
    turn1 = resolve_uns_path("PowerFlex 525 F0004")
    turn2 = resolve_uns_path("rephrase that", prior_ctx=turn1.as_dict())
    assert turn2.manufacturer == "Rockwell Automation"
    assert turn2.model == "525"


def test_carryover_decays():
    """Confidence decays each turn when prior is reused without new info."""
    turn1 = resolve_uns_path("PowerFlex 525 F0004")
    turn2 = resolve_uns_path("rephrase", prior_ctx=turn1)
    turn3 = resolve_uns_path("hmm", prior_ctx=turn2)
    # Each carry-over multiplies prior confidence by 0.9
    assert turn2.confidence == pytest.approx(turn1.confidence * 0.9, rel=1e-3)
    assert turn3.confidence < turn2.confidence


def test_carryover_new_fault_overrides():
    """A new fault in the current turn replaces the prior fault."""
    turn1 = resolve_uns_path("PowerFlex 525 F0004")
    turn2 = resolve_uns_path("now I see F0023", prior_ctx=turn1)
    assert turn2.fault_code == "F0023"
    assert turn2.manufacturer == "Rockwell Automation"
    assert turn2.model == "525"


# ---------------------------------------------------------------------------
# Fault patterns
# ---------------------------------------------------------------------------


def test_fault_pattern_F2_digits():
    ctx = resolve_uns_path("PowerFlex 525 F04")
    assert ctx.fault_code == "F0004"


def test_fault_pattern_F6_digits():
    ctx = resolve_uns_path("PowerFlex 525 F30004")
    assert ctx.fault_code == "F30004"


def test_fault_pattern_E_code():
    ctx = resolve_uns_path("Drive shows E5")
    assert ctx.fault_code == "E0005"


def test_fault_pattern_oC_variants():
    for variant in ("oC", "OC", "ocA"):
        ctx = resolve_uns_path(f"GS10 fault: {variant}")
        assert ctx.fault_code is not None, f"expected fault for {variant}"


def test_fault_pattern_A_alarm():
    ctx = resolve_uns_path("Yaskawa A1000 alarm A0023")
    assert ctx.fault_code == "A0023"


def test_fault_pattern_OL_overload():
    """OL bare code (overload). Previously only matched by dialogue_acts'
    inline regex; now in resolver for parity."""
    ctx = resolve_uns_path("PowerFlex 525 shows OL")
    assert ctx.fault_code is not None
    assert ctx.fault_code.upper() == "OL"


def test_fault_pattern_UL_underload():
    ctx = resolve_uns_path("Drive throws UL")
    assert ctx.fault_code is not None
    assert ctx.fault_code.upper() == "UL"


def test_fault_pattern_AL_prefix():
    ctx = resolve_uns_path("Siemens drive AL003")
    # AL003 matches the AL-prefix pattern, not the bare A-pattern
    assert ctx.fault_code is not None
    assert "AL" in ctx.fault_code.upper() or ctx.fault_code == "AL003"


# ---------------------------------------------------------------------------
# Path-build correctness
# ---------------------------------------------------------------------------


def test_path_includes_fault_segment():
    ctx = resolve_uns_path("PowerFlex 525 F0004")
    assert ctx.uns_path is not None
    assert "fault_codes" in ctx.uns_path


def test_path_lowercase():
    ctx = resolve_uns_path("PowerFlex 525 F0004")
    assert ctx.uns_path is not None
    assert ctx.uns_path == ctx.uns_path.lower()


def test_path_no_path_without_vendor():
    ctx = resolve_uns_path("F0004 fault")
    assert ctx.uns_path is None  # no manufacturer → no path


def test_path_manuals_category():
    ctx = resolve_uns_path("Where is the PowerFlex 525 manual?")
    assert ctx.manufacturer == "Rockwell Automation"
    # category should detect manuals
    assert ctx.category in ("manuals", "fault_codes")
    # path may end in 'manuals' depending on category detection
    assert ctx.uns_path is not None


# ---------------------------------------------------------------------------
# Dataclass round-trip
# ---------------------------------------------------------------------------


def test_as_dict_round_trip():
    ctx = resolve_uns_path("PowerFlex 525 F0004")
    d = ctx.as_dict()
    assert isinstance(d, dict)
    restored = UNSContext.from_dict(d)
    assert restored is not None
    assert restored.manufacturer == ctx.manufacturer
    assert restored.model == ctx.model
    assert restored.fault_code == ctx.fault_code
    assert restored.uns_path == ctx.uns_path


def test_from_dict_none():
    assert UNSContext.from_dict(None) is None
    assert UNSContext.from_dict({}) is None


def test_from_dict_tolerates_extra_keys():
    """Forward-compat: extra keys are ignored, not crash."""
    obj = UNSContext.from_dict({
        "manufacturer": "Yaskawa",
        "unknown_future_field": "ignored",
        "model": "A1000",
    })
    assert obj is not None
    assert obj.manufacturer == "Yaskawa"
    assert obj.model == "A1000"


# ---------------------------------------------------------------------------
# Confidence bands
# ---------------------------------------------------------------------------


def test_confidence_mfr_model_fault():
    ctx = resolve_uns_path("PowerFlex 525 F0004")
    assert ctx.confidence == 0.9  # offline, no DB


def test_confidence_mfr_model():
    ctx = resolve_uns_path("PowerFlex 525 is humming")
    assert ctx.confidence == 0.7


def test_confidence_mfr_only():
    ctx = resolve_uns_path("Rockwell drive problem")
    # vendor-only confidence
    assert ctx.confidence in (0.5, 0.7)  # 0.7 if it picks up something as model


def test_confidence_fault_only():
    ctx = resolve_uns_path("F0004 on the display")
    assert ctx.confidence == 0.3


def test_confidence_zero():
    ctx = resolve_uns_path("just rambling about nothing")
    assert ctx.confidence == 0.0


# ---------------------------------------------------------------------------
# Alias table coverage
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("alias,canonical", list(VENDOR_ALIASES.items()))
def test_every_alias_resolves(alias, canonical):
    """Every entry in VENDOR_ALIASES must resolve to its canonical name."""
    ctx = resolve_uns_path(f"I have a {alias} drive")
    assert ctx.manufacturer == canonical, (
        f"alias {alias!r} should resolve to {canonical!r}, got {ctx.manufacturer!r}"
    )


def test_family_aliases_set_product_family():
    for alias, family in FAMILY_FROM_ALIAS.items():
        ctx = resolve_uns_path(f"my {alias} drive")
        assert ctx.product_family == family, (
            f"alias {alias!r} should set family to {family!r}"
        )


# ---------------------------------------------------------------------------
# #1572 cluster 1 — family-marker aliases must populate model + reach 0.7
# confidence so engine.py sets state["asset_identified"] and the UNS gate
# stops re-firing on every turn.
# ---------------------------------------------------------------------------


def test_family_marker_alias_populates_model():
    """gs10/gs20/powerflex etc. without a separate model token must still
    expose a model so confidence reaches the 0.7 asset_identified threshold."""
    for alias, family in FAMILY_FROM_ALIAS.items():
        ctx = resolve_uns_path(f"my {alias} drive")
        assert ctx.model == family, (
            f"alias {alias!r} (no separate model token) should fall back to "
            f"model={family!r}, got {ctx.model!r}"
        )
        assert ctx.confidence >= 0.7, (
            f"alias {alias!r} should yield confidence >= 0.7 once family-marker "
            f"falls back to model, got {ctx.confidence}"
        )


def test_gs20_oc_reaches_asset_identified_threshold():
    """Fixture vague_opener_stuck_state_05 turn 2 — gate must skip after
    this message resolves to manufacturer + family + fault."""
    ctx = resolve_uns_path("It's a GS20, showing OC fault on the display")
    assert ctx.manufacturer == "AutomationDirect"
    assert ctx.model == "GS20"
    assert ctx.fault_code == "OC"
    assert ctx.confidence == 0.9


def test_gs10_overcurrent_reaches_threshold():
    """Fixture asset_change_mid_session_08 / reset_new_session_09 / 01 — gate
    must skip even without a fault code pattern (word 'overcurrent' alone)."""
    ctx = resolve_uns_path("GS10 VFD overcurrent fault on startup")
    assert ctx.manufacturer == "AutomationDirect"
    assert ctx.model == "GS10"
    assert ctx.confidence == 0.7


def test_family_marker_path_does_not_double_segment():
    """When model fell back to family-token, _build_uns_path must not insert
    both as separate slots (would produce .../gs20/gs20/...).  The model
    field still reads GS20 for downstream consumers, but the path drops the
    duplicate slot."""
    ctx = resolve_uns_path("GS20 OC fault")
    assert ctx.model == "GS20"
    assert ctx.product_family == "GS20"
    assert ctx.uns_path is not None
    # No "gs20.gs20" doubled segment anywhere in the path
    assert "gs20.gs20" not in ctx.uns_path, ctx.uns_path
    # And the manufacturer + fault still appear (path is well-formed)
    assert "automationdirect" in ctx.uns_path
    assert "fault_codes" in ctx.uns_path
    assert "oc" in ctx.uns_path


# ---------------------------------------------------------------------------
# Offline guarantee — these must pass without a NeonDB connection
# ---------------------------------------------------------------------------


def test_state_roundtrip_via_session_manager(tmp_path):
    """The resolver result must survive SQLite save/load.

    `session_manager.save_state` only persists declared columns plus
    `state["context"]` (JSON). The resolver must live under
    `state["context"]["uns_context"]` — placing it at the top level would
    silently drop it and break carry-over across turns.
    """
    import sys
    from pathlib import Path

    bots_root = Path(__file__).resolve().parents[1] / "mira-bots"
    if str(bots_root) not in sys.path:
        sys.path.insert(0, str(bots_root))
    # session_manager is the production save/load path
    from shared.session_manager import ensure_table, load_state, save_state

    db_path = str(tmp_path / "uns_roundtrip.db")
    ensure_table(db_path)

    # Turn 1: write resolver result under state["context"]["uns_context"]
    state = load_state(db_path, "chat_xyz")
    state["state"] = "IDLE"
    state["asset_identified"] = "Rockwell Automation, 525"
    state["exchange_count"] = 1
    ctx = resolve_uns_path("I have a powerflex 525 and it has it called f0004")
    state["context"]["uns_context"] = ctx.as_dict()
    save_state(db_path, "chat_xyz", state)

    # Turn 2: reload and confirm uns_context survived
    state2 = load_state(db_path, "chat_xyz")
    uns2 = (state2.get("context") or {}).get("uns_context") or {}
    assert uns2.get("manufacturer") == "Rockwell Automation"
    assert uns2.get("model") == "525"
    assert uns2.get("fault_code") == "F0004"

    # Resolver can re-hydrate from the dict form and apply carry-over
    turn2_ctx = resolve_uns_path("make a work order", prior_ctx=uns2)
    assert turn2_ctx.manufacturer == "Rockwell Automation"
    assert turn2_ctx.model == "525"
    assert turn2_ctx.fault_code == "F0004"


def test_offline_no_db_calls_required():
    """The resolver must produce a useful result with no DB available."""
    # This whole test file is offline already. Sanity-check that the
    # core fields populate without any DB import succeeding.
    ctx = resolve_uns_path("PowerFlex 525 F0004")
    assert ctx.manufacturer == "Rockwell Automation"
    assert ctx.model == "525"
    assert ctx.fault_code == "F0004"
    assert ctx.matched_entities == []  # no DB → no entities
    assert ctx.matched_kb_count == 0
    assert ctx.site_path is None


def test_offline_unknown_vendor_unchanged():
    ctx = resolve_uns_path("Acme 9000 drive is broken")
    assert ctx.manufacturer is None
    assert ctx.uns_path is None


# ---------------------------------------------------------------------------
# FAULT_PATTERNS exposure
# ---------------------------------------------------------------------------


def test_fault_patterns_exposed():
    assert len(FAULT_PATTERNS) >= 4
    # F-pattern should match F0004
    assert FAULT_PATTERNS[0].search("F0004") is not None


def test_vendor_aliases_exposed():
    assert len(VENDOR_ALIASES) >= 25
    assert "powerflex" in VENDOR_ALIASES
    assert VENDOR_ALIASES["powerflex"] == "Rockwell Automation"
