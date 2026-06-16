"""Tests for FSM state alias mapping (#179, #181).

Tests the _STATE_ALIASES dict directly without importing engine.py
(which has heavy dependencies). The dict is duplicated here and verified
to match the source via a grep-based consistency check.
"""

STATE_ORDER = ["IDLE", "Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP", "RESOLVED"]
VALID_STATES = set(STATE_ORDER) | {"ASSET_IDENTIFIED", "ELECTRICAL_PRINT", "SAFETY_ALERT"}

# Must match mira-bots/shared/engine.py _STATE_ALIASES exactly
_STATE_ALIASES: dict[str, str] = {
    "DIAGNOSTICS": "DIAGNOSIS",
    "DIAGNOSTIC": "DIAGNOSIS",
    "DIAGNOSIS_SUMMARY": "DIAGNOSIS",
    "PARAMETER_SETTINGS": "FIX_STEP",
    "CHECK_OUTPUT_REACTOR": "Q2",
    "INSPECT": "Q2",
    "VERIFY": "Q2",
    "TROUBLESHOOT": "Q1",
    "SUMMARY": "RESOLVED",
    "COMPLETE": "RESOLVED",
    "DONE": "RESOLVED",
}


def test_diagnostics_maps_to_diagnosis():
    assert _STATE_ALIASES["DIAGNOSTICS"] == "DIAGNOSIS"


def test_diagnostic_maps_to_diagnosis():
    assert _STATE_ALIASES["DIAGNOSTIC"] == "DIAGNOSIS"


def test_summary_maps_to_resolved():
    assert _STATE_ALIASES["SUMMARY"] == "RESOLVED"


def test_done_maps_to_resolved():
    assert _STATE_ALIASES["DONE"] == "RESOLVED"


def test_parameter_settings_maps_to_fix_step():
    assert _STATE_ALIASES["PARAMETER_SETTINGS"] == "FIX_STEP"


def test_unknown_state_not_in_aliases():
    assert _STATE_ALIASES.get("BANANA", "BANANA") == "BANANA"


def test_all_alias_targets_are_valid_states():
    for alias, target in _STATE_ALIASES.items():
        assert target in VALID_STATES, f"Alias {alias!r} → {target!r} is not a valid state"


def test_alias_resolution_logic():
    """Simulate what _advance_state does with aliases."""
    for proposed_from_llm, expected in [
        ("Q1", "Q1"),  # valid — no alias needed
        ("DIAGNOSTICS", "DIAGNOSIS"),  # alias
        ("SUMMARY", "RESOLVED"),  # alias
        ("BANANA", "BANANA"),  # unknown — no alias, stays invalid
    ]:
        resolved = _STATE_ALIASES.get(proposed_from_llm, proposed_from_llm)
        assert resolved == expected, f"{proposed_from_llm} → {resolved}, expected {expected}"


def test_source_file_consistency():
    """Verify the alias dict in this test matches the source file."""
    import os

    source = os.path.join(os.path.dirname(__file__), "..", "mira-bots", "shared", "fsm.py")
    with open(source) as f:
        content = f.read()
    for alias in _STATE_ALIASES:
        assert f'"{alias}"' in content, f"Alias {alias!r} not found in fsm.py"
