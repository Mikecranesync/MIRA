"""Variance-study harness — repeated-run model×effort benchmark via the Batches API.

Implements the 2026-07-14 case-study §9/§12 requirement: the production default
(opus-4-8 xhigh) may only change to a cheaper effort after ≥5 independent runs
per config pass an explicit decision rule. Hermetic: NO anthropic SDK, NO
network — the batch client is injected and faked here; request-building,
aggregation, the decision rule, and reporting are pure functions.
"""

import json
import statistics
from types import SimpleNamespace

import pytest

pytest.importorskip("pydantic")

from printsense.benchmarks import variance_study as vs  # noqa: E402

FAKE_PAGES = [(b"fake-image-bytes", "image/jpeg")]


# ---------------------------------------------------------------- request building

def test_requests_vary_only_in_model_effort_thinking():
    reqs = vs.build_requests("caseA", FAKE_PAGES, vs.DEFAULT_CONFIGS, runs=2)
    assert len(reqs) == 2 * len(vs.DEFAULT_CONFIGS)
    msgs = {json.dumps(r["params"]["messages"], sort_keys=True) for r in reqs}
    systems = {json.dumps(r["params"]["system"], sort_keys=True) for r in reqs}
    assert len(msgs) == 1, "user content must be byte-identical across configs"
    assert len(systems) == 1, "system block must be byte-identical across configs"
    xhigh = next(
        r for r in reqs if vs.parse_custom_id(r["custom_id"])[1:] == ("opus-xhigh", 0)
    )
    assert xhigh["params"]["output_config"] == {"effort": "xhigh"}
    assert xhigh["params"]["thinking"] == {"type": "adaptive"}


def test_system_block_carries_cache_breakpoint():
    reqs = vs.build_requests("caseA", FAKE_PAGES, vs.DEFAULT_CONFIGS, runs=1)
    sys_block = reqs[0]["params"]["system"][0]
    assert sys_block["cache_control"] == {"type": "ephemeral"}
    assert sys_block["text"]  # the shipped _SYSTEM prompt rides every call


def test_custom_id_roundtrip_and_api_charset():
    """Live-API constraint (400 on violation): custom_id must match
    ^[a-zA-Z0-9_-]{1,64}$ — no '|', no '.', bounded length."""
    import re

    cid = vs.make_custom_id("sheet20_upright", "opus-high", 3)
    assert re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", cid), cid
    assert vs.parse_custom_id(cid) == ("sheet20_upright", "opus-high", 3)


def test_custom_id_rejects_unencodable_names():
    import pytest as _pytest

    with _pytest.raises(ValueError):
        vs.make_custom_id("bad--case", "opus-high", 0)  # separator collision
    with _pytest.raises(ValueError):
        vs.make_custom_id("has.dot", "opus-high", 0)  # illegal charset
    with _pytest.raises(ValueError):
        vs.make_custom_id("x" * 70, "opus-high", 0)  # over 64 chars total


# ---------------------------------------------------------------- aggregation

def _row(config, score, is_a, misreads=0, verdict="PASS", cost=0.23, xref=1.0, device=1.0):
    return {
        "case": "c", "config": config, "run": 0,
        "score": score, "letter": "A" if is_a else "B", "is_A": is_a,
        "import_verdict": verdict, "misreads": misreads,
        "device_f1": device, "wire_f1": 1.0, "xref_f1": xref,
        "in_tok": 11000, "out_tok": 7000, "cost_usd": cost,
    }


def test_summarize_per_config_stats():
    rows = [_row("opus-high", 96.0, True), _row("opus-high", 94.0, True),
            _row("opus-xhigh", 93.0, True)]
    s = vs.summarize(rows)
    assert s["opus-high"]["n"] == 2
    assert s["opus-high"]["score_mean"] == 95.0
    assert s["opus-high"]["score_stdev"] == round(statistics.stdev([96.0, 94.0]), 2)
    assert s["opus-high"]["all_A"] is True
    assert s["opus-xhigh"]["score_stdev"] == 0.0  # n=1 → no variance claim


def test_decision_rule_recommends_switch_when_candidate_holds():
    rows = ([_row("opus-high", 95.0, True)] * 5) + ([_row("opus-xhigh", 93.0, True, cost=0.42)] * 5)
    d = vs.decision(vs.summarize(rows), incumbent="opus-xhigh", candidate="opus-high")
    assert d["checks"]["candidate_all_A"] is True
    assert d["checks"]["cost_lower"] is True
    assert d["switch_recommended"] is True


def test_decision_rule_blocks_on_misreads_or_broken_A_band():
    rows = ([_row("opus-high", 95.0, True, misreads=1, verdict="FAIL")] * 5) + (
        [_row("opus-xhigh", 93.0, True, cost=0.42)] * 5)
    d = vs.decision(vs.summarize(rows), incumbent="opus-xhigh", candidate="opus-high")
    assert d["checks"]["misreads_not_increased"] is False
    assert d["switch_recommended"] is False

    rows2 = ([_row("opus-high", 88.0, False)] * 5) + ([_row("opus-xhigh", 93.0, True, cost=0.42)] * 5)
    d2 = vs.decision(vs.summarize(rows2), incumbent="opus-xhigh", candidate="opus-high")
    assert d2["checks"]["candidate_all_A"] is False
    assert d2["switch_recommended"] is False


def test_decision_rule_blocks_on_material_xref_regression():
    rows = ([_row("opus-high", 95.0, True, xref=0.7)] * 5) + (
        [_row("opus-xhigh", 93.0, True, cost=0.42, xref=0.9)] * 5)
    d = vs.decision(vs.summarize(rows), incumbent="opus-xhigh", candidate="opus-high")
    assert d["checks"]["xref_not_materially_regressed"] is False
    assert d["switch_recommended"] is False


def test_console_output_is_cp1252_safe():
    """The report + manifest print to a Windows console (cp1252) — no ✅/≈/×/−."""
    rows = ([_row("opus-high", 95.0, True)] * 5) + ([_row("opus-xhigh", 93.0, True, cost=0.42)] * 5)
    summary = vs.summarize(rows)
    report = vs.render_report(summary, vs.decision(summary, "opus-xhigh", "opus-high"))
    report.encode("cp1252")  # raises UnicodeEncodeError if a non-encodable char sneaks in
    vs.manifest_line("mini", 15, 3, 5).encode("cp1252")


def test_render_report_names_verdict_and_latency_caveat():
    rows = ([_row("opus-high", 95.0, True)] * 5) + ([_row("opus-xhigh", 93.0, True, cost=0.42)] * 5)
    summary = vs.summarize(rows)
    text = vs.render_report(summary, vs.decision(summary, "opus-xhigh", "opus-high"))
    assert "opus-high" in text and "opus-xhigh" in text
    assert "SWITCH" in text.upper()
    assert "latency" in text.lower()  # batch mode cannot measure wall time — must say so


# ---------------------------------------------------------------- end-to-end (fake client)

class _FakeBatches:
    def __init__(self, results):
        self._results = results
        self.created_requests = None

    def create(self, requests):
        self.created_requests = requests
        return SimpleNamespace(id="batch_1", processing_status="in_progress")

    def retrieve(self, batch_id):
        return SimpleNamespace(processing_status="ended")

    def results(self, batch_id):
        return iter(self._results)


def _fake_result(custom_id, graph_json, in_tok=11000, out_tok=7000):
    msg = SimpleNamespace(
        content=[SimpleNamespace(type="text", text=graph_json)],
        usage=SimpleNamespace(input_tokens=in_tok, output_tokens=out_tok),
    )
    return SimpleNamespace(custom_id=custom_id,
                           result=SimpleNamespace(type="succeeded", message=msg))


MINI_RUBRIC = {
    "case": "mini",
    "package": {"drawing_no": "AP1"},
    "categories": {
        "device": {"expected": ["-1/A1"], "known_misreads": []},
        "wire": {"expected": [], "known_misreads": []},
        "xref": {"expected": [], "known_misreads": []},
    },
    "structure": [],
    "should_be_unresolved": [],
}

MINI_GRAPH = {
    "package": {"drawing_no": "AP1"},
    "devices": [{"tag": "-1/A1", "trust": "proposed", "connects": []}],
    "unresolved": [],
}


def test_run_study_collects_and_grades_via_fake_client(tmp_path):
    rubric_path = tmp_path / "rubric.json"
    rubric_path.write_text(json.dumps(MINI_RUBRIC), encoding="utf-8")
    configs = [c for c in vs.DEFAULT_CONFIGS if c.label in ("opus-xhigh", "opus-high")]
    graph_json = json.dumps(MINI_GRAPH)
    results = [
        _fake_result(vs.make_custom_id("mini", c.label, run), graph_json)
        for c in configs for run in range(2)
    ]
    client = SimpleNamespace(messages=SimpleNamespace(batches=_FakeBatches(results)))

    rows = vs.run_study(
        client,
        case_name="mini",
        pages=FAKE_PAGES,
        rubric_path=rubric_path,
        configs=configs,
        runs=2,
        out_dir=tmp_path / "out",
        poll_s=0,
    )
    assert len(rows) == 4
    assert all(r["letter"] == "A" and r["import_verdict"] == "PASS" for r in rows)
    # opus rate: (11000*5 + 7000*25)/1e6
    assert rows[0]["cost_usd"] == round((11000 * 5 + 7000 * 25) / 1e6, 4)
    # graphs are persisted for audit
    assert len(list((tmp_path / "out").glob("*.graph.json"))) == 4


def test_module_imports_without_anthropic_sdk():
    """The harness must be import-safe in the hermetic CI (no anthropic installed);
    the SDK is only touched when a real client is constructed."""
    import importlib

    importlib.reload(vs)  # would raise at import time if anthropic were a top-level import
