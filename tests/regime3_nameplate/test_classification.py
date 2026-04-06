"""Regime 3 — Nameplate Classification Tests (offline).

Tests the classification boundary between ELECTRICAL_PRINT and EQUIPMENT_PHOTO.
No network required — uses mock vision results.
"""

from __future__ import annotations

import pytest


# ── Classification logic (extracted from VisionWorker) ──────────────────────

# OCR threshold: if OCR returns >= this many items, classify as ELECTRICAL_PRINT
OCR_CLASSIFICATION_THRESHOLD = 10

# Drawing keywords that also trigger ELECTRICAL_PRINT
DRAWING_KEYWORDS = [
    "schematic", "diagram", "drawing", "ladder",
    "one-line", "wiring", "p&id", "panel schedule",
]


def classify_photo(ocr_items: list[str], vision_text: str = "") -> str:
    """Classify a photo as ELECTRICAL_PRINT or EQUIPMENT_PHOTO.

    Replicates VisionWorker._classify_photo logic for offline testing.
    """
    # Count-based threshold
    if len(ocr_items) >= OCR_CLASSIFICATION_THRESHOLD:
        return "ELECTRICAL_PRINT"

    # Keyword-based override
    combined = " ".join(ocr_items).lower() + " " + vision_text.lower()
    if any(kw in combined for kw in DRAWING_KEYWORDS):
        return "ELECTRICAL_PRINT"

    return "EQUIPMENT_PHOTO"


def detect_drawing_type(ocr_items: list[str], vision_text: str = "") -> str | None:
    """Detect specific drawing type if classified as ELECTRICAL_PRINT."""
    combined = " ".join(ocr_items).lower() + " " + vision_text.lower()
    types = {
        "ladder": "ladder_logic",
        "one-line": "one_line",
        "p&id": "pid",
        "wiring": "wiring_diagram",
        "panel schedule": "panel_schedule",
        "schematic": "schematic",
    }
    for keyword, dtype in types.items():
        if keyword in combined:
            return dtype
    return None


# ── Tests ───────────────────────────────────────────────────────────────────

@pytest.mark.regime3
class TestClassification:
    """Test ELECTRICAL_PRINT vs EQUIPMENT_PHOTO classification boundary."""

    def test_equipment_photo_few_ocr_items(self):
        """Few OCR items + no drawing keywords = EQUIPMENT_PHOTO."""
        items = ["Allen-Bradley", "Micro820", "2080-LC20-20QWB"]
        assert classify_photo(items) == "EQUIPMENT_PHOTO"

    def test_electrical_print_many_ocr_items(self):
        """10+ OCR items triggers ELECTRICAL_PRINT."""
        items = [f"item_{i}" for i in range(12)]
        assert classify_photo(items) == "ELECTRICAL_PRINT"

    def test_electrical_print_exactly_threshold(self):
        """Exactly 10 items = ELECTRICAL_PRINT."""
        items = [f"item_{i}" for i in range(10)]
        assert classify_photo(items) == "ELECTRICAL_PRINT"

    def test_electrical_print_below_threshold(self):
        """9 items = EQUIPMENT_PHOTO (below threshold)."""
        items = [f"item_{i}" for i in range(9)]
        assert classify_photo(items) == "EQUIPMENT_PHOTO"

    def test_drawing_keyword_override(self):
        """Drawing keyword overrides even with few OCR items."""
        items = ["Motor Starter", "schematic"]
        assert classify_photo(items) == "ELECTRICAL_PRINT"

    def test_ladder_keyword(self):
        items = ["rung 1", "ladder logic"]
        assert classify_photo(items) == "ELECTRICAL_PRINT"

    def test_vision_text_keyword(self):
        """Drawing keyword in vision description (not OCR) also triggers."""
        items = ["some", "text"]
        assert classify_photo(items, vision_text="This is a wiring diagram") == "ELECTRICAL_PRINT"

    def test_no_keyword_no_threshold(self):
        """Generic text, few items = EQUIPMENT_PHOTO."""
        items = ["Motor", "15HP", "480V"]
        assert classify_photo(items) == "EQUIPMENT_PHOTO"

    def test_empty_ocr(self):
        """Empty OCR = EQUIPMENT_PHOTO."""
        assert classify_photo([]) == "EQUIPMENT_PHOTO"


@pytest.mark.regime3
class TestDrawingTypeDetection:
    def test_ladder_logic(self):
        assert detect_drawing_type(["ladder logic diagram"]) == "ladder_logic"

    def test_one_line(self):
        assert detect_drawing_type(["one-line diagram"]) == "one_line"

    def test_pid(self):
        assert detect_drawing_type(["P&ID piping"]) == "pid"

    def test_wiring(self):
        assert detect_drawing_type(["wiring diagram"]) == "wiring_diagram"

    def test_panel_schedule(self):
        assert detect_drawing_type(["panel schedule"]) == "panel_schedule"

    def test_none_for_equipment(self):
        assert detect_drawing_type(["Allen-Bradley Micro820"]) is None

    def test_vision_text(self):
        assert detect_drawing_type([], "This is a schematic") == "schematic"
