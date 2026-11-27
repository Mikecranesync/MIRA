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


ORIGINAL_5998 = "What causes overcurrent faults on a PowerFlex 525?"


def test_legacy_metadata_is_valid_so_exclusion_never_masks_malformed_data():
    for p in _hub_files():
        fx = yaml.safe_load(p.read_text())
        if "turns" in fx or "max_turns" in fx:
            assert isinstance(fx["max_turns"], int) and not isinstance(fx["max_turns"], bool), p.name
            assert isinstance(fx["turns"], list) and fx["turns"], p.name
            assert all(isinstance(t, dict) and t["role"] in ("user", "assistant") and isinstance(t["content"], str) for t in fx["turns"]), p.name
            assert fx["turns"][0]["content"] == fx["hub_notebook"]["question"], f"{p.name}: legacy turn and Hub question diverge"
        if "expected_keywords" in fx:
            assert isinstance(fx["expected_keywords"], list) and all(isinstance(k, str) for k in fx["expected_keywords"]), p.name
        if "expected_final_state" in fx:
            assert isinstance(fx["expected_final_state"], str), p.name


def test_fixture_74_keeps_the_exact_original_question_everywhere():
    fx = yaml.safe_load((FIXTURES_DIR / "74_pf525_overcurrent_ranking.yaml").read_text())
    assert fx["id"] == "pf525_overcurrent_ranking_5998"
    assert fx["turns"] == [{"role": "user", "content": ORIGINAL_5998}]
    assert fx["hub_notebook"]["question"] == ORIGINAL_5998
    assert fx["max_turns"] == 4
