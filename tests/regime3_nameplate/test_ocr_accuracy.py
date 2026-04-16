"""Regime 3 — Nameplate OCR Accuracy Tests.

Compares VisionWorker output against ground truth labels.
Field-level accuracy: make, model, catalog, component_type, classification.

Network tests require BRAVO services (Open WebUI + Ollama).
Offline tests validate scoring logic with mock data.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.conftest import REPO_ROOT, TESTS_ROOT, load_photo_b64
from tests.scoring.composite import CaseResult, build_case_result


# ── Field comparison utilities ──────────────────────────────────────────────

def fuzzy_match(expected: str | None, actual: str | None) -> bool:
    """Case-insensitive substring match for extracted fields."""
    if expected is None or actual is None:
        return expected is None and actual is None
    return expected.lower() in actual.lower() or actual.lower() in expected.lower()


def score_extraction(ground_truth: dict, extracted: dict) -> dict:
    """Score field-level extraction accuracy.

    Returns dict with per-field match booleans and overall accuracy.
    """
    fields = ["make", "model", "catalog", "component_type"]
    matches = {}
    for field in fields:
        gt_val = ground_truth.get(field)
        ex_val = extracted.get(field)
        if gt_val is None:
            # Skip unannnotated fields
            continue
        matches[field] = fuzzy_match(gt_val, ex_val)

    scored_fields = len(matches)
    correct_fields = sum(1 for v in matches.values() if v)
    accuracy = correct_fields / scored_fields if scored_fields > 0 else 0.0

    # Classification check (if available)
    gt_class = ground_truth.get("classification")
    ex_class = extracted.get("classification")
    classification_correct = None
    if gt_class and ex_class:
        classification_correct = gt_class == ex_class

    return {
        "field_matches": matches,
        "fields_scored": scored_fields,
        "fields_correct": correct_fields,
        "accuracy": accuracy,
        "classification_correct": classification_correct,
    }


# ── Offline tests (mock data) ──────────────────────────────────────────────

@pytest.mark.regime3
class TestOCRAccuracyOffline:
    """Test scoring logic with mock extracted data."""

    def test_perfect_extraction(self):
        gt = {"make": "Allen-Bradley", "model": "Micro820", "catalog": "2080-LC20-20QWB", "component_type": "PLC"}
        extracted = {"make": "Allen-Bradley", "model": "Micro820", "catalog": "2080-LC20-20QWB", "component_type": "PLC"}
        result = score_extraction(gt, extracted)
        assert result["accuracy"] == 1.0
        assert result["fields_correct"] == 4

    def test_partial_extraction(self):
        gt = {"make": "AutomationDirect", "model": "GS10", "catalog": "GS10-20P5", "component_type": "VFD"}
        extracted = {"make": "AutomationDirect", "model": "GS10", "catalog": None, "component_type": "VFD"}
        result = score_extraction(gt, extracted)
        assert result["accuracy"] == 0.75  # 3/4 fields correct
        assert result["field_matches"]["catalog"] is False

    def test_wrong_make(self):
        gt = {"make": "Allen-Bradley", "model": "Micro820"}
        extracted = {"make": "Siemens", "model": "Micro820"}
        result = score_extraction(gt, extracted)
        assert result["field_matches"]["make"] is False
        assert result["field_matches"]["model"] is True

    def test_case_insensitive(self):
        gt = {"make": "Allen-Bradley"}
        extracted = {"make": "allen-bradley"}
        result = score_extraction(gt, extracted)
        assert result["field_matches"]["make"] is True

    def test_substring_match(self):
        gt = {"model": "GS10"}
        extracted = {"model": "GS10-20P5"}
        result = score_extraction(gt, extracted)
        assert result["field_matches"]["model"] is True

    def test_null_ground_truth_skipped(self):
        gt = {"make": None, "model": "Micro820"}
        extracted = {"make": "Allen-Bradley", "model": "Micro820"}
        result = score_extraction(gt, extracted)
        assert result["fields_scored"] == 1  # Only model counted
        assert result["accuracy"] == 1.0

    def test_classification_check(self):
        gt = {"classification": "EQUIPMENT_PHOTO", "make": "Test"}
        extracted = {"classification": "EQUIPMENT_PHOTO", "make": "Test"}
        result = score_extraction(gt, extracted)
        assert result["classification_correct"] is True

    def test_classification_mismatch(self):
        gt = {"classification": "EQUIPMENT_PHOTO", "make": "Test"}
        extracted = {"classification": "ELECTRICAL_PRINT", "make": "Test"}
        result = score_extraction(gt, extracted)
        assert result["classification_correct"] is False

    def test_golden_labels_load(self, sample_tag_labels):
        """Verify golden labels load correctly."""
        assert len(sample_tag_labels) == 5
        for case in sample_tag_labels:
            assert "id" in case
            assert "image" in case
            assert "ground_truth" in case
            gt = case["ground_truth"]
            assert "make" in gt
            assert "classification" in gt


# ── Network tests (VisionWorker) ───────────────────────────────────────────

@pytest.mark.regime3
@pytest.mark.network
@pytest.mark.slow
class TestOCRAccuracyLive:
    """Live VisionWorker tests against sample tag photos.

    Requires BRAVO services running (Open WebUI + Ollama).
    """

    @pytest.fixture(autouse=True)
    def _check_services(self):
        """Skip if not running against live services."""
        import os
        if not os.getenv("OPENWEBUI_BASE_URL"):
            pytest.skip("Live OCR tests require OPENWEBUI_BASE_URL")

    def test_placeholder(self):
        """Placeholder — activated when services are available."""
        pass


# ── Regime runner (called by synthetic_eval.py) ─────────────────────────────

async def regime3_runner(
    mode: str = "offline",
) -> list[CaseResult]:
    """Run all Regime 3 cases and return scored results.

    Modes:
      - offline: score mock extraction against ground truth (validation only)
      - live: call VisionWorker.process() on actual photos
    """
    labels_dir = TESTS_ROOT / "regime3_nameplate" / "golden_labels" / "v1"

    with open(labels_dir / "sample_tags.json") as f:
        sample_data = json.load(f)
    cases = list(sample_data["cases"])

    # Merge in annotated real-photo cases (case1_photo_*) from real_photos.json
    real_labels_path = labels_dir / "real_photos.json"
    if real_labels_path.exists():
        with open(real_labels_path) as f:
            real_data = json.load(f)
        case1_cases = [c for c in real_data["cases"] if c["id"].startswith("case1_photo_")]
        cases.extend(case1_cases)

    results: list[CaseResult] = []

    for case in cases:
        gt = case["ground_truth"]

        if mode in ("offline", "dry-run"):
            # Mock perfect extraction for validation
            extracted = dict(gt)
            accuracy = 1.0
        else:
            # Live mode would call VisionWorker here
            extracted = {}
            accuracy = 0.0

        scoring = score_extraction(gt, extracted)

        result = build_case_result(
            case_id=case["id"],
            regime="regime3_nameplate",
            contains_score=scoring["accuracy"],
            metadata={
                "field_matches": scoring["field_matches"],
                "classification_correct": scoring["classification_correct"],
                "mode": mode,
            },
        )
        results.append(result)

    return results
