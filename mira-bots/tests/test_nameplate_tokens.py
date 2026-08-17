"""Deterministic nameplate-token extraction — the plate overrides the guesser.

Zero-token by construction: every case here is a hand-typed OCR string. No
vision model, no network, no fixtures that need a binary.

The anchor case is the live prod defect of 2026-08-17: a Danfoss VLT AQUA
Drive plate that the vision model returned as manufacturer="VLT" (the family,
not the maker), serial="TC=20P72B2R2XCNXXXXXXXXD" (a mangled read of the T/C
*type* line) and no catalog code — while the plate printed the type code, the
P/N and the real serial in plain labelled text.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.drive_packs import build_asset_identity  # noqa: E402
from shared.workers.nameplate_tokens import (  # noqa: E402
    apply_plate_ocr,
    canonical_manufacturer,
    extract_plate_tokens,
    format_plate_read,
    has_anchored_identity,
    merge_plate_tokens,
    missing_identity_ask,
    plate_manufacturer,
    plate_ocr_text,
)

# The real plate, as Tesseract renders it (line order/spacing from the photo).
DANFOSS_PLATE_OCR = """DANFOSS
Danfoss A/S, DK-6430 Nordborg, Denmark
VLT AQUA Drive
T/C: FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX
P/N: 131H4017    S/N: 02334H073
15 kW / 20 HP
IN: 3X200-240V 50/60Hz 54A
OUT: 3x0-Vin 0-590Hz 59.4A
MADE IN DENMARK"""

DANFOSS_TYPE_CODE = "FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX"
DANFOSS_SERIAL = "02334H073"
DANFOSS_PART_NUMBER = "131H4017"

# Exactly what the vision model returned in prod for the plate above.
DANFOSS_VISION_FIELDS = {
    "manufacturer": "VLT",
    "model": "AQUA Drive",
    "serial": "TC=20P72B2R2XCNXXXXXXXXD",
    "catalog": None,
    "voltage": None,
    "fla": None,
    "hp": None,
    "kw": None,
    "frequency": None,
    "rpm": None,
}


# ── The regression: the Danfoss plate ────────────────────────────────────────


def test_danfoss_plate_tokens_are_read_off_the_printed_labels():
    tokens = extract_plate_tokens(DANFOSS_PLATE_OCR)

    assert tokens["catalog"] == DANFOSS_TYPE_CODE
    assert tokens["part_number"] == DANFOSS_PART_NUMBER
    assert tokens["serial"] == DANFOSS_SERIAL
    assert tokens["kw"] == "15 kW"
    assert tokens["hp"] == "20 HP"
    assert tokens["manufacturer"] == "Danfoss"
    # Electrical values come off the INPUT-anchored line, never the OUT line.
    assert tokens["voltage"] == "3X200-240V"
    assert tokens["fla"] == "54A"
    assert tokens["frequency"] == "50/60Hz"


def test_danfoss_plate_overrides_the_vision_models_wrong_answers():
    """The live defect, end to end: wrong maker + hallucinated serial + no
    catalog code, corrected from the printed plate."""
    merged, tokens, overrides = apply_plate_ocr(DANFOSS_VISION_FIELDS, DANFOSS_PLATE_OCR)

    # VLT is the product family; Danfoss is the maker.
    assert merged["manufacturer"] == "Danfoss"
    # The catalog/type code was never captured before — now it is.
    assert merged["catalog"] == DANFOSS_TYPE_CODE
    assert merged["part_number"] == DANFOSS_PART_NUMBER
    # The hallucinated serial is gone, replaced by the S/N-labelled value.
    assert merged["serial"] == DANFOSS_SERIAL
    assert merged["serial"] != "TC=20P72B2R2XCNXXXXXXXXD"
    assert merged["kw"] == "15 kW"
    assert merged["hp"] == "20 HP"

    # Every correction is reported (and logged) with its previous value.
    assert overrides["manufacturer"] == ("VLT", "Danfoss")
    assert overrides["serial"] == ("TC=20P72B2R2XCNXXXXXXXXD", DANFOSS_SERIAL)
    assert overrides["catalog"] == (None, DANFOSS_TYPE_CODE)

    assert has_anchored_identity(tokens) is True


def test_danfoss_catalog_code_reaches_the_asset_identity_packet():
    merged, _tokens, _overrides = apply_plate_ocr(DANFOSS_VISION_FIELDS, DANFOSS_PLATE_OCR)
    identity = build_asset_identity(nameplate=merged)

    assert identity.manufacturer == "Danfoss"
    assert identity.catalog_number == DANFOSS_TYPE_CODE
    assert identity.serial_number == DANFOSS_SERIAL
    assert identity.kw == "15 kW"


def test_danfoss_read_never_asks_for_a_field_we_already_have():
    merged, _tokens, _overrides = apply_plate_ocr(DANFOSS_VISION_FIELDS, DANFOSS_PLATE_OCR)

    assert missing_identity_ask(merged) is None

    read = format_plate_read(merged)
    assert "Danfoss" in read
    assert DANFOSS_TYPE_CODE in read
    assert DANFOSS_SERIAL in read


# ── Extraction: anchors, noise, and the refusal to invent ────────────────────


def test_no_ocr_text_changes_nothing():
    merged, tokens, overrides = apply_plate_ocr(DANFOSS_VISION_FIELDS, "")
    assert tokens == {}
    assert overrides == {}
    assert merged == DANFOSS_VISION_FIELDS
    assert merged is not DANFOSS_VISION_FIELDS  # never mutates the caller's dict


def test_prose_without_plate_anchors_yields_no_tokens():
    tokens = extract_plate_tokens(
        "A conveyor motor mounted under the guard, with a coupling and a gearbox."
    )
    assert tokens == {}
    assert has_anchored_identity(tokens) is False


def test_keyword_only_lines_are_not_values():
    tokens = extract_plate_tokens("CAT. NO.\nSERIAL NUMBER\nMODEL")
    assert "catalog" not in tokens
    assert "serial" not in tokens
    assert "model" not in tokens


def test_short_type_classifier_is_not_promoted_to_a_catalog_code():
    """TYPE also labels short classifier codes ("TYPE PTC") — too weak to
    override a model read."""
    assert "catalog" not in extract_plate_tokens("TYPE PTC")
    assert extract_plate_tokens("TYPE 5K444AK456")["catalog"] == "5K444AK456"


def test_part_number_becomes_the_catalog_when_no_type_code_is_printed():
    tokens = extract_plate_tokens("P/N: 131H4017")
    assert tokens["catalog"] == "131H4017"
    assert tokens["part_number"] == "131H4017"


def test_output_side_current_is_not_read_as_fla():
    """Only INPUT-anchored (or explicitly labelled) lines give up electrical
    values — an unanchored number could be the drive's OUTPUT rating."""
    tokens = extract_plate_tokens("OUT: 3x0-Vin 0-590Hz 59.4A")
    assert "fla" not in tokens
    assert "voltage" not in tokens
    assert "frequency" not in tokens


def test_labelled_amps_line_without_an_input_anchor_is_read():
    tokens = extract_plate_tokens("VOLTS 460  AMPS 12.5A")
    assert tokens["fla"] == "12.5A"


# ── Merge policy: override vs fill-only vs manufacturer ──────────────────────


def test_fill_only_fields_never_overwrite_a_vision_read():
    fields = {"manufacturer": "Danfoss", "voltage": "480V", "model": "FC-202"}
    merged, _tokens, overrides = apply_plate_ocr(fields, DANFOSS_PLATE_OCR)
    assert merged["voltage"] == "480V"
    assert merged["model"] == "FC-202"
    assert "voltage" not in overrides
    assert "model" not in overrides


def test_agreeing_values_are_not_reported_as_overrides():
    fields = {"manufacturer": "Danfoss", "serial": DANFOSS_SERIAL, "catalog": DANFOSS_TYPE_CODE}
    _merged, _tokens, overrides = apply_plate_ocr(fields, DANFOSS_PLATE_OCR)
    assert "serial" not in overrides
    assert "catalog" not in overrides
    assert "manufacturer" not in overrides


def test_manufacturer_is_not_overridden_when_it_already_canonicalizes_the_same():
    tokens = {"manufacturer": "AutomationDirect"}
    merged, overrides = merge_plate_tokens({"manufacturer": "automationdirect"}, tokens)
    assert merged["manufacturer"] == "automationdirect"
    assert "manufacturer" not in overrides


def test_ambiguous_short_vendor_aliases_are_never_matched_on_plate_text():
    """A plate reading DELTA names a winding connection, not Delta Electronics."""
    assert plate_manufacturer("CONN: DELTA\nVOLTS 460") is None
    assert plate_manufacturer("AB\n3 PH") is None


def test_known_vendor_name_is_canonicalized():
    assert plate_manufacturer("ALLEN-BRADLEY\nCAT NO 25B-D010N104") == "Rockwell Automation"
    assert canonical_manufacturer("danfoss") == "Danfoss"
    assert canonical_manufacturer("  ") is None


# ── Presentation: state what was read, ask only for what is missing ──────────


def test_ask_names_the_missing_identifier_when_only_a_maker_was_read():
    ask = missing_identity_ask({"manufacturer": "AutomationDirect"})
    assert ask is not None
    assert "model" in ask.lower()


def test_ask_requests_a_better_photo_when_nothing_was_read():
    ask = missing_identity_ask({})
    assert ask is not None
    assert "plate" in ask.lower()


def test_format_plate_read_is_empty_when_nothing_was_read():
    assert format_plate_read({}) == ""
    assert format_plate_read({"manufacturer": None, "model": ""}) == ""


# ── The OCR helper degrades honestly ─────────────────────────────────────────


def test_plate_ocr_text_never_raises_on_unreadable_bytes():
    assert plate_ocr_text(b"") == ""
    assert plate_ocr_text(b"not-an-image") == ""
