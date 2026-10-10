"""Regression for #4342: grade the stated load and hours, without a new duty cycle."""

import json
import re
from decimal import Decimal
from pathlib import Path

BENCHMARK = Path(__file__).resolve().parents[1] / "benchmark" / "mira_mcq_benchmark.json"


def test_q29_key_matches_energy_saved_at_the_stated_operating_load():
    """#4342: DOE equations 6-1/6-2 imply about 4,715 kWh/year and option D."""
    q = next(row for row in json.loads(BENCHMARK.read_text()) if row["id"] == 29)
    stem = q["stem"]
    hp = Decimal(re.search(r"(\d+) HP", stem)[1])
    premium, standard = (Decimal(value) / 100 for value in re.findall(r"η = ([\d.]+)%", stem))
    load = Decimal(re.search(r"(\d+)% load", stem)[1]) / 100
    hours = Decimal(re.search(r"([\d,]+) hours/year", stem)[1].replace(",", ""))
    saved_kwh = hp * Decimal("0.746") * load * hours * (1 / standard - 1 / premium)
    numerical_options = {
        key: Decimal(match[1].replace(",", ""))
        for key, text in q["options"].items()
        if (match := re.search(r"([\d,]+) kWh/year", text))
    }
    nearest = min(numerical_options, key=lambda key: abs(numerical_options[key] - saved_kwh))
    assert abs(saved_kwh - Decimal("4714.978355")) < Decimal("0.000001")
    assert q["key"] == nearest
    assert "efficiencies apply at 50% load" in stem


def test_disputed_q8_and_q30_keys_are_preserved_pending_evidence_and_review():
    """#4342: disagreement alone must not manufacture a higher benchmark score."""
    rows = {row["id"]: row for row in json.loads(BENCHMARK.read_text())}
    assert rows[8]["key"] == "A"
    assert rows[30]["key"] == "B"
