"""#6030 F10: Hub-notebook-profile fixtures are excluded from (and disclosed by) the pipeline runner."""
from pathlib import Path

import yaml

from tests.eval.run_eval import FIXTURES_DIR, HUB_NOTEBOOK_RUNNER, _load_fixtures

HUB_IDS = {
    "pf525_f081_table_row",
    "s7_1200_yellow_led",
    "gs10_param_p06_53",
    "kinetix_sto_wiring",
    "pf525_overcurrent_ranking_5998",
    "f16_p047_p88",
    "panelview_expansion_44_45",
}


def _hub_files():
    return sorted(p for p in FIXTURES_DIR.glob("[0-9][0-9]_*.yaml") if yaml.safe_load(p.read_text()).get("runner") == HUB_NOTEBOOK_RUNNER)


def test_every_hub_fixture_is_tagged_and_carries_an_executable_hub_block():
    files = _hub_files()
    assert {yaml.safe_load(p.read_text())["id"] for p in files} == HUB_IDS
    for p in files:
        hub = yaml.safe_load(p.read_text())["hub_notebook"]
        assert hub["question"] and hub["retrieval"] and hub["provider_answer"] and hub["expect"]["provider_sees"]


def test_pipeline_runner_does_not_load_hub_profile_fixtures(caplog):
    caplog.set_level("INFO")
    loaded = {f["id"] for f in _load_fixtures(FIXTURES_DIR)}
    assert loaded.isdisjoint(HUB_IDS)
    assert "Excluding 70_pf525_f081_table_row.yaml" in caplog.text  # disclosed, not silent


def test_control_a_non_hub_fixture_still_loads():
    assert any(Path(f["_path"]).name.startswith("01_") for f in _load_fixtures(FIXTURES_DIR))
