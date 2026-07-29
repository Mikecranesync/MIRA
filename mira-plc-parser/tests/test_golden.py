"""Golden snapshot tests -- pin the full render_json() report (schema mira-plc-parser/report@1).

The JSON report is the contract downstream MIRA ingest consumes, so its exact shape is an asset:
any drift in fields, counts, ordering, or candidate sets must be a deliberate, reviewed change.
Each fixture has a committed golden under tests/fixtures/golden/; this test re-runs the pipeline
and asserts byte-for-structure equality.

To regenerate after an intentional change:  MIRA_REGEN_GOLDEN=1 python -m pytest tests/test_golden.py
(then review the git diff before committing).
"""
import json
import os

import pytest

from mira_plc_parser import render_json, run

GOLDEN_DIR = "golden"
# fixture filename -> golden filename
CASES = {
    "conveyor.L5X": "conveyor.l5x.report.json",
    "gs10_tags.csv": "gs10_tags.csv.report.json",
    "conveyor.st": "conveyor.st.report.json",
    "conveyor.plcopen.xml": "conveyor.plcopen.report.json",
}


@pytest.mark.parametrize("fixture_name,golden_name", sorted(CASES.items()))
def test_report_matches_golden(fixtures, fixture_name, golden_name):
    text = (fixtures / fixture_name).read_text(encoding="utf-8")
    actual = render_json(run(fixture_name, text))
    assert actual["schema"] == "mira-plc-parser/report@1"

    golden_path = fixtures / GOLDEN_DIR / golden_name
    if os.environ.get("MIRA_REGEN_GOLDEN"):
        golden_path.parent.mkdir(parents=True, exist_ok=True)
        golden_path.write_text(json.dumps(actual, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        pytest.skip("regenerated %s" % golden_name)

    expected = json.loads(golden_path.read_text(encoding="utf-8"))
    assert actual == expected, "report drift vs %s (regen with MIRA_REGEN_GOLDEN=1)" % golden_name
