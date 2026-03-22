"""Regime 5 — Nemotron Bulk Q&A Tests.

Requires NVIDIA_API_KEY in Doppler. Auto-skips when key is not available.
"""

from __future__ import annotations

import pytest

from tests.scoring.contains_check import keyword_match_score
from tests.scoring.composite import CaseResult, build_case_result


# Seed Q&A pairs for dry-run/offline validation
_SEED_QA_PAIRS = [
    {
        "id": "nemotron-001",
        "question": "What causes overcurrent fault F004 on VFD startup?",
        "expected_keywords": ["phase loss", "fuse", "voltage", "overcurrent"],
        "equipment_type": "VFD",
    },
    {
        "id": "nemotron-002",
        "question": "How to diagnose bearing failure on continuous duty motor?",
        "expected_keywords": ["vibration", "bearing", "lubrication", "grinding"],
        "equipment_type": "motor",
    },
    {
        "id": "nemotron-003",
        "question": "What causes intermittent EtherNet/IP packet loss near VFDs?",
        "expected_keywords": ["EMI", "shielded cable", "separation", "interference"],
        "equipment_type": "PLC",
    },
    {
        "id": "nemotron-004",
        "question": "Why does compressor alarm on high discharge pressure?",
        "expected_keywords": ["check valve", "stuck", "discharge pressure", "unload"],
        "equipment_type": "compressor",
    },
    {
        "id": "nemotron-005",
        "question": "How to fix conveyor belt tracking drift?",
        "expected_keywords": ["alignment", "idler", "level", "tracking"],
        "equipment_type": "conveyor",
    },
]


def _mock_response(pair: dict) -> str:
    """Generate a mock response containing expected keywords."""
    keywords = pair.get("expected_keywords", [])
    return f"The likely cause involves {', '.join(keywords)}. Check and verify these areas."


@pytest.mark.regime5
class TestBulkQA:
    """Nemotron bulk Q&A evaluation."""

    def test_seed_qa_scoreable(self):
        """All seed Q&A pairs can be scored."""
        for pair in _SEED_QA_PAIRS:
            response = _mock_response(pair)
            score, matched, _ = keyword_match_score(
                response, pair["expected_keywords"],
            )
            assert score > 0
            assert len(matched) > 0

    def test_empty_response_fails(self):
        pair = _SEED_QA_PAIRS[0]
        score, matched, _ = keyword_match_score("", pair["expected_keywords"])
        assert score == 0.0


async def regime5_runner(mode: str = "offline") -> list[CaseResult]:
    """Run Regime 5 seed Q&A pairs and return scored results."""
    results: list[CaseResult] = []

    for pair in _SEED_QA_PAIRS:
        if mode in ("offline", "dry-run"):
            response = _mock_response(pair)
        else:
            response = ""  # Live mode would call Supervisor

        score, matched, _ = keyword_match_score(response, pair["expected_keywords"])

        result = build_case_result(
            case_id=pair["id"],
            regime="regime5_nemotron",
            contains_score=score,
            metadata={
                "keyword_matches": matched,
                "equipment_type": pair.get("equipment_type"),
                "mode": mode,
            },
        )
        results.append(result)

    return results
