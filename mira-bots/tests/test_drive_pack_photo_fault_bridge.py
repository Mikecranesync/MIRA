"""The photo→fault→pack bridge: pack-aware fault-code extraction + exact lookup.

Proves the two new, pure, offline primitives that let a PHOTO of a drive
keypad (read to OCR text) reach the same pack intelligence a typed question
already does — WITHOUT ever guessing:

- ``extract_pack_fault_codes(pack, text)`` — returns ONLY tokens that are real
  fault codes in *this* pack. Bare integers are rejected (a fault number is
  only trusted when it carries a fault context like ``F005`` / "Fault 5"), so
  stray OCR numerals ("5 A", "45.0 Hz") can never become a code.
- ``answer_fault_code(pack_id, token)`` — exact numeric/mnemonic lookup against
  the pack, reusing the same cited, read-only card machinery as
  ``answer_question``.

The single most important test here is the NEGATIVE gate
(``test_bare_ocr_numerals_never_extracted``): a miss is acceptable, a confident
*wrong* cited hit is a grounding-contract violation. If that test fails, the
bridge does not ship.
"""

from __future__ import annotations

from shared.drive_packs.ask import answer_fault_code, extract_pack_fault_codes
from shared.drive_packs.loader import load_pack

_GS10 = "durapulse_gs10"
_PF525 = "powerflex_525"


# --------------------------------------------------------------------------
# The NEGATIVE gate — the ship/no-ship test.
# --------------------------------------------------------------------------
def test_bare_ocr_numerals_never_extracted():
    """Stray OCR numbers must NOT become fault codes even when the integer
    happens to be a real code in the pack. PowerFlex code 5 == 'OverVoltage',
    but 'Output 45.0 Hz  5 A  Ready' contains no *fault* — extraction is []."""
    pack = load_pack(_PF525)
    for line in (
        "Output 45.0 Hz",
        "5 A",
        "Ready",
        "Amps 5",
        "Motor current 5.0",
    ):
        assert extract_pack_fault_codes(pack, line) == [], line
    # the whole faceplate blob together — still nothing (no fault context)
    blob = "Output 45.0 Hz  5 A  Ready  60 Hz"
    assert extract_pack_fault_codes(pack, blob) == []


def test_bare_number_alone_is_not_a_code():
    pack = load_pack(_PF525)
    assert extract_pack_fault_codes(pack, "5") == []
    assert extract_pack_fault_codes(pack, "the number is 5") == []


# --------------------------------------------------------------------------
# POSITIVE extraction — a fault context IS present.
# --------------------------------------------------------------------------
def test_powerflex_numeric_with_fault_context_extracts():
    pack = load_pack(_PF525)
    assert extract_pack_fault_codes(pack, "F005") == ["5"]
    assert extract_pack_fault_codes(pack, "F5") == ["5"]
    assert extract_pack_fault_codes(pack, "Fault 5") == ["5"]
    assert extract_pack_fault_codes(pack, "FAULT F005 on display") == ["5"]
    # a real code number that is NOT in the pack, even with context, is dropped
    assert extract_pack_fault_codes(pack, "Fault 999") == []


def test_gs10_mnemonic_extracts_whole_word_only():
    pack = load_pack(_GS10)
    assert "CE10" in extract_pack_fault_codes(pack, "keypad shows CE10")
    # the mnemonic must be a standalone token — 'CE10' inside another token
    # or an English word must not match
    assert extract_pack_fault_codes(pack, "no fault, running normally") == []


def test_pure_letter_mnemonics_not_auto_extracted_but_still_answerable():
    """v1 safety trade: pure-letter mnemonics (GS10 'oL'/'EF'/'GFF'/'Lvd') are
    NOT auto-extracted from OCR — that same rule is what stops PowerFlex's
    word-leads ('Auto'/'Load'/'Net') from becoming false cited hits. They
    remain answerable when a caller passes them explicitly."""
    pack = load_pack(_GS10)
    # not auto-extracted from a photo (conservative)
    assert extract_pack_fault_codes(pack, "display reads oL") == []
    assert extract_pack_fault_codes(pack, "motor overloaded and stopped") == []
    # but an explicit lookup still answers, cited
    r = answer_fault_code(_GS10, "oL")
    assert r.matched is True and r.matched_kind == "fault"


def test_powerflex_word_leads_never_falsely_extracted():
    """The data-revealed hazard: PowerFlex fault NAMES start with common words
    ('Auto Rstrt', 'Load Loss', 'Net Loss', 'Comm Loss'). None may be pulled
    from OCR as a code — that would be a confident wrong cited hit."""
    pack = load_pack(_PF525)
    for line in ("Auto mode", "Load 50%", "Net OK", "Comm active", "SW rev 3", "Opt card"):
        assert extract_pack_fault_codes(pack, line) == [], line


# --------------------------------------------------------------------------
# answer_fault_code — exact, cited, read-only, never a guess.
# --------------------------------------------------------------------------
def test_powerflex_numeric_lookup_is_cited_and_family_correct():
    r = answer_fault_code(_PF525, "F005")
    assert r.resolved is True
    assert r.matched is True and r.matched_kind == "fault"
    assert r.answer_source == "drive_pack"
    assert r.fallback_used is False
    assert r.live_telemetry is False
    assert r.read_only is True
    assert "OverVoltage" in r.answer
    # the family label must be PowerFlex — NOT the old hardcoded 'GS10'
    assert "PowerFlex 525" in r.answer
    assert "GS10" not in r.answer
    assert r.citations


def test_powerflex_bare_number_lookup_matches_when_caller_is_explicit():
    """The extractor gates; the lookup trusts its input. A caller passing an
    explicit '5' (already decided it's a code) gets the answer."""
    r = answer_fault_code(_PF525, "5")
    assert r.matched is True and r.matched_kind == "fault"
    assert "OverVoltage" in r.answer


def test_no_active_fault_code_zero_is_not_a_fault():
    r = answer_fault_code(_PF525, "0")
    assert r.matched is False
    assert r.answer_source == "none"


def test_unknown_code_is_honest_never_a_guess():
    r = answer_fault_code(_PF525, "F999")
    assert r.matched is False
    assert r.answer_source == "none"
    assert r.fallback_used is False


def test_gs10_mnemonic_lookup_matches_and_cites():
    r = answer_fault_code(_GS10, "CE10")
    assert r.matched is True and r.matched_kind == "fault"
    assert "CE10" in r.answer
    assert "timeout" in r.answer.lower() or "time-out" in r.answer.lower()
    assert "DURApulse GS10" in r.answer
    assert r.citations


def test_unresolved_pack_reports_honestly():
    r = answer_fault_code("no_such_pack", "F005")
    assert r.resolved is False
    assert r.matched is False
    assert r.answer_source == "none"


# --------------------------------------------------------------------------
# The joined bridge as the engine uses it: extract → lookup.
# --------------------------------------------------------------------------
def test_bridge_end_to_end_powerflex():
    pack = load_pack(_PF525)
    ocr = "PowerFlex 525  F005  Fault"
    codes = extract_pack_fault_codes(pack, ocr)
    assert codes == ["5"]
    r = answer_fault_code(_PF525, codes[0])
    assert r.matched is True
    assert "OverVoltage" in r.answer


def test_bridge_end_to_end_negative_no_fault_visible():
    """A running-drive faceplate photo yields no code → no answer attempted."""
    pack = load_pack(_PF525)
    ocr = "PowerFlex 525  Output 45.0 Hz  5.0 A  Run"
    assert extract_pack_fault_codes(pack, ocr) == []
