"""Tests for factorylm_ai.proofpack -- the Together experiments CLI.

Hermetic: no network, ever. Every test either exercises pure functions
(scoring.py, report.py against synthetic result dicts) or runs against the
mock provider, which costs $0.00 and is fully deterministic by construction.
Env is read via ``monkeypatch`` only; ``FACTORYLM_AI_DATA_DIR`` is always
pointed at a ``tmp_path`` subdirectory so nothing here ever touches the real
``factorylm_ai/data/``.

Unlike ``factorylm_ai.telemetry`` (which fakes ``factorylm_ai.schemas.validate``
via ``sys.modules`` injection to stay independent of a same-stage build
race), the experiments in this file import ``factorylm_ai.tasks`` for real --
proofpack's whole job is to run real tasks against a real provider (mock in
CI, together with ``--live``), so a fake task registry would not test
anything meaningful. ``factorylm_ai/tasks/`` is expected to exist in this
checkout by the time this file runs.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

from factorylm_ai.budget import BudgetExceeded, BudgetGuard
from factorylm_ai.proofpack import experiments, report, run, scoring
from factorylm_ai.providers.base import ModelRequest
from factorylm_ai.providers.mock import MockProvider

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = REPO_ROOT / "factorylm_ai" / "proofpack" / "fixtures"

_M09_TOOL_NAMES = {
    "search_print_pages",
    "trace_wire",
    "resolve_device",
    "lookup_fault_code",
    "retrieve_page_crop",
    "ask_for_closeup",
}


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [
        json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()
    ]


# ---------------------------------------------------------------------------
# scoring.py -- pure, deterministic, no model calls
# ---------------------------------------------------------------------------


def test_route_accuracy_exact_match() -> None:
    assert scoring.route_accuracy(["a", "b", "c"], ["a", "b", "c"]) == 1.0


def test_route_accuracy_partial_match() -> None:
    assert scoring.route_accuracy(["a", "x", "c"], ["a", "b", "c"]) == pytest.approx(2 / 3)


def test_route_accuracy_empty_is_zero() -> None:
    assert scoring.route_accuracy([], []) == 0.0


def test_route_accuracy_length_mismatch_raises() -> None:
    with pytest.raises(ValueError):
        scoring.route_accuracy(["a"], ["a", "b"])


def test_tool_choice_accuracy_matches_route_accuracy_mechanics() -> None:
    assert scoring.tool_choice_accuracy(["x", "y"], ["x", "z"]) == 0.5


def test_json_validity_rate() -> None:
    assert scoring.json_validity_rate([True, True, False, True]) == pytest.approx(0.75)
    assert scoring.json_validity_rate([]) == 0.0


def test_keyword_overlap_score_toy_chunks() -> None:
    assert scoring.keyword_overlap_score("relay K1 coil", "relay K1 coil terminals") > 0.0
    assert scoring.keyword_overlap_score("relay K1", "unrelated text about pumps") == 0.0


def test_keyword_overlap_topk_ranks_best_match_first() -> None:
    docs = [
        "this document is about pumps and valves",
        "relay K1 coil terminals A1 A2",
        "totally unrelated content about paint",
    ]
    top = scoring.keyword_overlap_topk("relay K1 coil", docs, 2)
    assert top[0] == 1  # docs[1] shares the most tokens with the query
    assert len(top) == 2


def test_keyword_overlap_topk_k_zero_is_empty() -> None:
    assert scoring.keyword_overlap_topk("q", ["a", "b"], 0) == []


def test_cosine_similarity_identical_vectors_is_one() -> None:
    assert scoring.cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)


def test_cosine_similarity_orthogonal_vectors_is_zero() -> None:
    assert scoring.cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_cosine_similarity_opposite_vectors_is_negative_one() -> None:
    assert scoring.cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)


def test_cosine_similarity_zero_vector_is_zero_not_error() -> None:
    assert scoring.cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_cosine_similarity_length_mismatch_raises() -> None:
    with pytest.raises(ValueError):
        scoring.cosine_similarity([1.0], [1.0, 2.0])


def test_cosine_topk_ranks_closest_vectors_first() -> None:
    vectors = [[0.0, 1.0], [1.0, 0.0], [0.9, 0.1]]
    top = scoring.cosine_topk([1.0, 0.0], vectors, 2)
    assert top[0] == 1  # exact match
    assert top[1] == 2  # closest remaining


def test_hit_at_k_true_and_false() -> None:
    assert scoring.hit_at_k([3, 1, 2], {2}) is True
    assert scoring.hit_at_k([3, 1], {2}) is False


def test_mean_hit_rate() -> None:
    assert scoring.mean_hit_rate([True, False, True, True]) == pytest.approx(0.75)
    assert scoring.mean_hit_rate([]) == 0.0


# ---------------------------------------------------------------------------
# fixtures -- parse cleanly and satisfy the build-contract shape/coverage
# ---------------------------------------------------------------------------


def test_m01_fixture_shape_and_count() -> None:
    cases = _load_jsonl(FIXTURES_DIR / "m01_cases.jsonl")
    assert len(cases) >= 8
    for case in cases:
        assert set(case) == {
            "case_id",
            "description",
            "expected_image_type",
            "expected_readability",
        }
        assert case["description"]
        assert case["expected_image_type"]
        assert case["expected_readability"]
    assert len({c["case_id"] for c in cases}) == len(cases)  # unique ids


def test_m05_fixture_shape_and_count() -> None:
    cases = _load_jsonl(FIXTURES_DIR / "m05_cases.jsonl")
    assert len(cases) >= 15
    for case in cases:
        assert set(case) == {"case_id", "text", "expected_route"}
    assert len({c["case_id"] for c in cases}) == len(cases)


def test_m05_fixture_includes_the_contract_messy_english_examples() -> None:
    texts = [c["text"] for c in _load_jsonl(FIXTURES_DIR / "m05_cases.jsonl")]
    assert "wat does this do" in texts
    assert any("faultin agian" in t for t in texts)


def test_m07_fixture_shape_and_count() -> None:
    records = _load_jsonl(FIXTURES_DIR / "m07_corpus.jsonl")
    chunks = [r for r in records if r["kind"] == "chunk"]
    questions = [r for r in records if r["kind"] == "question"]
    assert len(chunks) == 25
    assert len(questions) == 10
    for chunk in chunks:
        assert chunk["text"]
        assert len(chunk["text"]) <= 400
    chunk_ids = {c["chunk_id"] for c in chunks}
    assert len(chunk_ids) == len(chunks)  # unique ids
    for question in questions:
        assert question["text"]
        assert question["known_correct_chunk_ids"]
        assert set(question["known_correct_chunk_ids"]) <= chunk_ids


def test_m09_fixture_shape_and_count() -> None:
    cases = _load_jsonl(FIXTURES_DIR / "m09_cases.jsonl")
    assert len(cases) >= 10
    for case in cases:
        assert set(case) == {"case_id", "question", "expected_tool"}
        assert case["expected_tool"] in _M09_TOOL_NAMES
    covered = {c["expected_tool"] for c in cases}
    assert covered == _M09_TOOL_NAMES  # all six tools exercised at least once


async def test_m05_fixture_scores_at_least_0_8_against_mock_keyword_map() -> None:
    """Tasks-independent proof of the contract's dry-run accuracy requirement.

    Calls the mock provider directly (no factorylm_ai.tasks involved) so
    this specific check never depends on the tasks/ build race -- it proves
    the fixture's expected_route values genuinely agree with the mock's
    keyword map, which is the property run_e02's own accuracy metric relies
    on.
    """
    provider = MockProvider()
    predicted: list[str] = []
    expected: list[str] = []
    for case in _load_jsonl(FIXTURES_DIR / "m05_cases.jsonl"):
        resp = await provider.complete(
            ModelRequest(task_id="M05", messages=[{"role": "user", "content": case["text"]}])
        )
        assert resp.parsed is not None
        predicted.append(str(resp.parsed["route"]))
        expected.append(str(case["expected_route"]))
    assert scoring.route_accuracy(predicted, expected) >= 0.8


# ---------------------------------------------------------------------------
# report.py -- pure rendering over synthetic ExperimentResult dicts
# ---------------------------------------------------------------------------


def _fake_result(experiment: str, **overrides: Any) -> experiments.ExperimentResult:
    base: dict[str, Any] = {
        "experiment": experiment,
        "cases": 5,
        "scored": 5,
        "metrics": {"route_accuracy": 1.0, "latency_ms_total": 5, "model": "mock/m05"},
        "cost_usd": 0.0,
        "notes": [],
    }
    base.update(overrides)
    return base  # type: ignore[return-value]


def test_render_report_dry_run_includes_honesty_banner() -> None:
    text = report.render_report(
        [_fake_result("e02")],
        live=False,
        provider_name="mock",
        budget_cap_usd=1.0,
        budget_spent_usd=0.0,
    )
    assert "DRY-RUN" in text
    assert "fixture-determinism check" in text


def test_render_report_live_omits_dry_run_banner() -> None:
    text = report.render_report(
        [_fake_result("e02")],
        live=True,
        provider_name="together",
        budget_cap_usd=1.0,
        budget_spent_usd=0.02,
    )
    assert "DRY-RUN on the mock provider" not in text
    assert "**Mode:** LIVE" in text


def test_render_report_includes_promotion_evidence_block() -> None:
    text = report.render_report(
        [_fake_result("e02")],
        live=False,
        provider_name="mock",
        budget_cap_usd=1.0,
        budget_spent_usd=0.0,
    )
    assert "PROMOTION-EVIDENCE" in text
    assert "frozen_benchmark_pass" in text
    assert "rollback" in text


def test_render_report_summary_table_has_a_row_per_experiment() -> None:
    text = report.render_report(
        [_fake_result("e01"), _fake_result("e02")],
        live=False,
        provider_name="mock",
        budget_cap_usd=1.0,
        budget_spent_usd=0.0,
    )
    assert "| e01 |" in text
    assert "| e02 |" in text
    assert "| **total** |" in text


def test_report_filename_format_is_windows_safe() -> None:
    dt = datetime(2026, 7, 19, 12, 13, 14, tzinfo=timezone.utc)
    name = report.report_filename(["e01", "e02"], now=dt)
    assert name == "20260719T121314Z_e01-e02.md"
    assert ":" not in name


def test_write_report_creates_dir_and_returns_path(tmp_path: Path) -> None:
    out_dir = tmp_path / "nested" / "reports"
    path = report.write_report(
        [_fake_result("e01")],
        out_dir,
        live=False,
        provider_name="mock",
        budget_cap_usd=1.0,
        budget_spent_usd=0.0,
    )
    assert path.exists()
    assert path.parent == out_dir
    assert path.read_text(encoding="utf-8").startswith("# factorylm_ai proofpack report")


# ---------------------------------------------------------------------------
# experiments.py -- real integration against the mock provider + real tasks/
# ---------------------------------------------------------------------------


def test_experiments_public_surface() -> None:
    assert set(experiments.EXPERIMENTS) == {"e01", "e02", "e03", "e04"}
    assert experiments.ALL_EXPERIMENT_IDS == ("e01", "e02", "e03", "e04")
    assert experiments.EXPERIMENTS["e01"] is experiments.run_e01
    assert experiments.EXPERIMENTS["e02"] is experiments.run_e02
    assert experiments.EXPERIMENTS["e03"] is experiments.run_e03
    assert experiments.EXPERIMENTS["e04"] is experiments.run_e04


async def test_run_e01_dry_run_is_deterministic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path))
    provider = MockProvider()
    result1 = await experiments.run_e01(
        provider,
        BudgetGuard(cap_usd=10.0),
        fixtures_dir=FIXTURES_DIR,
        live=False,
        images_dir=None,
    )
    result2 = await experiments.run_e01(
        provider,
        BudgetGuard(cap_usd=10.0),
        fixtures_dir=FIXTURES_DIR,
        live=False,
        images_dir=None,
    )
    assert result1["experiment"] == "e01"
    assert result1["cases"] == result2["cases"] == 10
    assert result1["scored"] == result2["scored"] == 10
    assert result1["metrics"] == result2["metrics"]
    assert result1["cost_usd"] == result2["cost_usd"] == 0.0


async def test_run_e01_live_without_images_dir_is_skipped_not_broken(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path))
    provider = MockProvider()
    result = await experiments.run_e01(
        provider,
        BudgetGuard(cap_usd=10.0),
        fixtures_dir=FIXTURES_DIR,
        live=True,
        images_dir=None,
    )
    assert result["scored"] == 0
    assert result["cost_usd"] == 0.0
    assert any("images-dir" in n for n in result["notes"])


async def test_run_e01_live_mode_loads_real_image_files_and_skips_missing_ones(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path / "data"))
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    first_case = _load_jsonl(FIXTURES_DIR / "m01_cases.jsonl")[0]
    (images_dir / f"{first_case['case_id']}.jpg").write_bytes(b"\xff\xd8\xff\xe0fake-jpeg-bytes")

    provider = MockProvider()
    result = await experiments.run_e01(
        provider,
        BudgetGuard(cap_usd=10.0),
        fixtures_dir=FIXTURES_DIR,
        live=True,
        images_dir=images_dir,
    )
    assert result["scored"] == 1
    assert any("no image file found" in n for n in result["notes"])


async def test_run_e02_dry_run_scores_at_least_0_8(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path))
    provider = MockProvider()
    result = await experiments.run_e02(
        provider,
        BudgetGuard(cap_usd=10.0),
        fixtures_dir=FIXTURES_DIR,
        live=False,
        images_dir=None,
    )
    assert result["cases"] == result["scored"]
    assert result["metrics"]["route_accuracy"] >= 0.8
    assert result["metrics"]["json_validity_rate"] == 1.0
    assert result["cost_usd"] == 0.0


async def test_run_e03_computes_baseline_and_dense_hit_rates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path))
    provider = MockProvider()
    result = await experiments.run_e03(
        provider,
        BudgetGuard(cap_usd=10.0),
        fixtures_dir=FIXTURES_DIR,
        live=False,
        images_dir=None,
    )
    assert result["cases"] == 10
    assert result["scored"] == 10
    for key in (
        "keyword_top1_hit_rate",
        "keyword_top5_hit_rate",
        "dense_top1_hit_rate",
        "dense_top5_hit_rate",
    ):
        assert 0.0 <= result["metrics"][key] <= 1.0
    assert str(result["metrics"]["rerank"]).startswith("skipped")
    assert result["cost_usd"] == 0.0


async def test_run_e03_missing_corpus_rows_skips_gracefully(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path))
    empty_fixtures = tmp_path / "empty_fixtures"
    empty_fixtures.mkdir()
    (empty_fixtures / "m07_corpus.jsonl").write_text("", encoding="utf-8")

    provider = MockProvider()
    result = await experiments.run_e03(
        provider,
        BudgetGuard(cap_usd=10.0),
        fixtures_dir=empty_fixtures,
        live=False,
        images_dir=None,
    )
    assert result["scored"] == 0
    assert result["cost_usd"] == 0.0
    assert any("skipped" in n for n in result["notes"])


async def test_run_e04_hard_check_never_violated_against_mock(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path))
    provider = MockProvider()
    result = await experiments.run_e04(
        provider,
        BudgetGuard(cap_usd=10.0),
        fixtures_dir=FIXTURES_DIR,
        live=False,
        images_dir=None,
    )
    assert result["metrics"]["answered_from_memory_pass_rate"] == 1.0
    assert result["metrics"]["tool_choice_accuracy"] == 1.0
    assert not any("HARD CHECK FAILED" in n for n in result["notes"])


async def test_budget_exceeded_propagates_from_an_experiment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path))
    provider = MockProvider()
    with pytest.raises(BudgetExceeded):
        await experiments.run_e02(
            provider,
            BudgetGuard(cap_usd=0.0),
            fixtures_dir=FIXTURES_DIR,
            live=False,
            images_dir=None,
        )


# ---------------------------------------------------------------------------
# run.py -- the CLI contract
# ---------------------------------------------------------------------------


def test_dunder_main_delegates_to_run_main() -> None:
    from factorylm_ai.proofpack import __main__ as dunder_main

    assert dunder_main.main is run.main


def test_live_without_any_env_exits_2(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("TOGETHERAI_API_KEY", raising=False)
    monkeypatch.delenv("FACTORYLM_AI_ALLOW_NETWORK", raising=False)
    code = run.main(["--experiment", "e01", "--live"])
    assert code == 2
    captured = capsys.readouterr()
    assert "TOGETHERAI_API_KEY" in captured.err


def test_live_with_key_but_network_flag_unset_exits_2(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TOGETHERAI_API_KEY", "fake-test-key-not-real")
    monkeypatch.delenv("FACTORYLM_AI_ALLOW_NETWORK", raising=False)
    assert run.main(["--experiment", "e01", "--live"]) == 2


def test_live_with_network_flag_but_key_unset_exits_2(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TOGETHERAI_API_KEY", raising=False)
    monkeypatch.setenv("FACTORYLM_AI_ALLOW_NETWORK", "true")
    assert run.main(["--experiment", "e01", "--live"]) == 2


def test_invalid_experiment_choice_raises_system_exit_2() -> None:
    with pytest.raises(SystemExit) as excinfo:
        run.main(["--experiment", "bogus"])
    assert excinfo.value.code == 2


def test_main_dry_run_all_writes_one_report_and_jsonl_at_zero_cost(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_dir = tmp_path / "data"
    report_dir = tmp_path / "reports"
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(data_dir))
    monkeypatch.delenv("FACTORYLM_AI_ALLOW_NETWORK", raising=False)
    monkeypatch.delenv("TOGETHERAI_API_KEY", raising=False)

    code = run.main(["--experiment", "all", "--report-dir", str(report_dir)])
    assert code == 0

    md_files = list(report_dir.glob("*.md"))
    assert len(md_files) == 1

    runs_path = data_dir / "runs" / "model_runs.jsonl"
    assert runs_path.exists()
    rows = _load_jsonl(runs_path)
    assert rows  # at least one call logged
    total_cost = sum(row["estimated_cost_usd"] for row in rows)
    assert total_cost == 0.0
    assert all(row["provider"] == "mock" for row in rows)


def test_main_dry_run_is_deterministic_across_invocations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("FACTORYLM_AI_ALLOW_NETWORK", raising=False)
    monkeypatch.delenv("TOGETHERAI_API_KEY", raising=False)

    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path / "data1"))
    report_dir_1 = tmp_path / "reports1"
    assert run.main(["--experiment", "all", "--report-dir", str(report_dir_1)]) == 0

    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path / "data2"))
    report_dir_2 = tmp_path / "reports2"
    assert run.main(["--experiment", "all", "--report-dir", str(report_dir_2)]) == 0

    text1 = next(report_dir_1.glob("*.md")).read_text(encoding="utf-8")
    text2 = next(report_dir_2.glob("*.md")).read_text(encoding="utf-8")

    # Only the very first line (the title) embeds a wall-clock timestamp;
    # everything else is a pure function of the (identical) fixtures + mock
    # provider, so the rest of the report must be byte-for-byte identical.
    body1 = text1.split("\n", 1)[1]
    body2 = text2.split("\n", 1)[1]
    assert body1 == body2


def test_main_single_experiment_report_is_named_for_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path / "data"))
    report_dir = tmp_path / "reports"
    assert run.main(["--experiment", "e02", "--report-dir", str(report_dir)]) == 0
    md_files = list(report_dir.glob("*.md"))
    assert len(md_files) == 1
    assert md_files[0].name.endswith("_e02.md")


def test_main_respects_explicit_budget_usd_flag(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FACTORYLM_AI_DATA_DIR", str(tmp_path / "data"))
    report_dir = tmp_path / "reports"
    # A generous explicit cap must not change dry-run behavior (still $0).
    code = run.main(
        ["--experiment", "e02", "--budget-usd", "5.00", "--report-dir", str(report_dir)]
    )
    assert code == 0
    text = next(report_dir.glob("*.md")).read_text(encoding="utf-8")
    assert "$0.0000 spent / $5.0000 cap" in text
