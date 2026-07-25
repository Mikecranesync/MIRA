"""The interpreter prompt must carry BOTH designation conventions + homoglyph discipline.

Regression cover for the acceptance-corpus finding: the prompt taught DIN/IEC 81346 as an
authority ("obey exactly; a violation means you misread") and said nothing about
North American drawings, so a US print's PLC I/O wire numbers came back with a
letter dropped -- `P9DI900-0` read as `P9D900-0`, 16/16 affected designations
wrong. A designation missing a character is unsearchable for a technician.

These are prompt-content assertions (hermetic, no API call). They are deliberately
about MEANING, not wording: each checks a rule survives, not a sentence.
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import interpret  # noqa: E402

SYSTEM = interpret._SYSTEM


# --- the North American convention is taught -------------------------------


def test_north_american_convention_block_present():
    """A US/Rockwell grammar block exists alongside the IEC one."""
    assert "NORTH AMERICAN" in SYSTEM
    assert "Rockwell" in SYSTEM


def test_us_wire_numbers_are_not_forced_into_iec_form():
    """The prompt must forbid inventing a `-W` prefix on a US wire number."""
    assert "never add a `-W` prefix" in SYSTEM
    # and it must say so where the US forms are described
    assert "A US wire number is NOT `-W####`" in SYSTEM


def test_us_plc_address_forms_are_taught():
    """Allen-Bradley / ControlLogix address punctuation is part of the tag."""
    for form in ("I:1/0", "O:2/7", "B3:0/1", "N7:20", "T4:1.DN", "Local:1:I.Data[0]"):
        assert form in SYSTEM, f"missing PLC address form {form!r}"


def test_wire_colour_gauge_is_not_a_conductor_tag():
    """`BLU #18` describes a conductor; emitting it AS a conductor was observed."""
    flat = " ".join(SYSTEM.split())
    assert "never emit one as a conductor `tag`" in flat
    assert "GRN/YEL #10" in flat


# --- the DIN/IEC convention still stands -----------------------------------


def test_iec_grammar_retained():
    """Broadening must not cost the European rules (SCU2 is the gold package)."""
    assert "DIN/IEC 81346" in SYSTEM
    # the specific IEC forms the SCU2 package depends on
    for form in ("-W5497", "-21/A13", "+SCU2-BEL", "-X3.9"):
        assert form in SYSTEM, f"lost IEC form {form!r}"
    assert "There is NO `-WK...` form" in SYSTEM


def test_iec_class_letters_retained():
    assert "`A`=assembly/module" in SYSTEM
    assert "`F`=fuse/protection" in SYSTEM


def test_both_conventions_are_labelled_separately():
    """Two labelled blocks, so neither is read as the universal rule."""
    a = SYSTEM.index("(a) DIN/IEC 81346")
    b = SYSTEM.index("(b) NORTH AMERICAN")
    assert a < b, "IEC block must precede the North American block"


# --- the drawing outranks the convention -----------------------------------


def test_convention_is_a_prior_not_an_authority():
    """The bug's licence was 'obey exactly; a violation means you misread'."""
    assert "obey exactly; a violation means you misread" not in SYSTEM
    assert "the DRAWING is the authority" in SYSTEM
    assert "only a PRIOR" in SYSTEM


def test_visible_designation_wins_over_grammar():
    flat = " ".join(SYSTEM.split())
    assert "the designation wins" in flat
    assert "NEVER rewrite a character you can see" in flat


# --- homoglyph discipline ---------------------------------------------------


@pytest.mark.parametrize(
    "pair",
    [("`I`", "`1`"), ("`O`", "`0`"), ("`S`", "`5`"), ("`B`", "`8`"), ("`Z`", "`2`")],
)
def test_required_homoglyph_pairs_present(pair):
    """All five pairs from the directive are named explicitly."""
    flat = " ".join(SYSTEM.split())
    assert "HOMOGLYPHS" in flat
    joined = f"{pair[0]}/{pair[1]}"
    assert joined in flat, f"homoglyph pair {joined} not taught"


def test_homoglyphs_declared_non_interchangeable():
    flat = " ".join(SYSTEM.split())
    assert "letters and digits are NOT interchangeable" in flat
    assert "DIFFERENT characters" in flat


def test_letter_runs_must_not_be_dropped():
    """The measured failure mode, named exactly."""
    flat = " ".join(SYSTEM.split())
    assert "`P9DI900-0` is not `P9D900-0`" in flat
    assert "`P9-DI9-00` is not `P9-D9-00`" in flat
    for abbr in ("`DI`", "`DO`", "`AI`", "`AO`"):
        assert abbr in flat, f"PLC I/O abbreviation {abbr} not protected"


def test_digit_drift_protection_preserved():
    """The pre-existing rule must survive the homoglyph addition."""
    flat = " ".join(SYSTEM.split())
    assert "Copy every digit exactly" in flat
    assert "`15.7` is `15.7`, never `157` or `15.5`" in flat


def test_one_designation_may_hold_both_members_of_a_pair():
    """Guards against a naive 'letters XOR digits' reading of the new rule."""
    flat = " ".join(SYSTEM.split())
    assert "may legitimately contain both members of a pair" in flat


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
