"""PR5 — the 12-point hermetic proof for the offline PrintSense grader gate.

No Anthropic, no Doppler, no internet, no production services. Reuses the REAL ``grade_case``
(``printsense.grade_case``) and the REAL runner (``tools/internet_print_test/runner.py``) with
``submit`` + ``run_judge`` mocked. Proves: the deterministic import gate holds, the LLM judge
cannot override it, a missing judge doesn't prevent grading, runner/report/email expose the same
verdict + blockers, results are repeatable, malformed graphs fail safely, and the frozen ATV340
truth-set is enforced against regression.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from printsense import grade_case as gc
from printsense import grader_gate

_ROOT = Path(__file__).resolve().parents[2]
# The PR4 runner lives under tools/ — put it on sys.path (as tools/internet_print_test/test_runner.py does).
_RUNNER_DIR = _ROOT / "tools" / "internet_print_test"
if str(_RUNNER_DIR) not in sys.path:
    sys.path.insert(0, str(_RUNNER_DIR))

_ATV340_GRAPH = _ROOT / "printsense" / "fixtures" / "atv340" / "graph.json"
_ATV340_RUBRIC = _ROOT / "printsense" / "benchmarks" / "atv340_vfd" / "rubric.json"
_ATV340_BLOCKERS = {
    "exact_label_mismatch", "confident_misread", "duplicate_identifier",
    "off_page_from_pagination", "incompatible_functional_path",
}
_PNG_1x1 = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
                         "890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082")


def _verdict(tmp_path, graph: dict, rubric: dict | None = None) -> dict:
    """Grade an in-memory graph (+ optional rubric) via the REAL grade_case (which takes paths)."""
    gp = tmp_path / "graph.json"
    gp.write_text(json.dumps(graph), encoding="utf-8")
    rp = None
    if rubric is not None:
        rp = tmp_path / "rubric.json"
        rp.write_text(json.dumps(rubric), encoding="utf-8")
    return gc.grade_case(gp, rp)


def _run_runner(tmp_path, monkeypatch, graph: dict, test_id: str, *, judge=None, no_judge=False):
    """Drive the REAL runner with submit + judge mocked (hermetic). Returns (row, td)."""
    import runner  # lazy: only the 3 runner tests need it (+ httpx via safety/mailer)
    import submit as submitmod

    fixture = tmp_path / "x.png"
    fixture.write_bytes(_PNG_1x1)
    src = {"test_id": test_id, "local_file": str(fixture), "title": "t", "publisher": "p",
           "source_url": "https://example.org/x.png", "category": "test", "caption": "Explain this print."}
    monkeypatch.setattr(runner, "TESTS_ROOT", tmp_path / "out")
    monkeypatch.setattr(submitmod, "submit_image_sync", lambda image_bytes, caption, **kw: {
        "handled": True, "classification": "ELECTRICAL_PRINT", "final_text": "R", "map_text": "m",
        "graph": graph, "interpreter_used": True, "model": "x", "latency_s": 0.1})
    monkeypatch.setattr("runner.run_judge",
                        judge or (lambda *a, **k: {"overall_score_provisional": 60, "hard_failure": False, "provisional": True}))
    args = runner.argparse.Namespace(page=0, dpi=200, caption="Explain this print.", no_judge=no_judge,
                                     send_email=False, recipient=None, regrade=False)
    row = runner.run_one(src, args)
    return row, tmp_path / "out" / test_id


# ── 1. Valid graph passes ─────────────────────────────────────────────────────
def test_1_valid_graph_passes(tmp_path):
    r = _verdict(tmp_path, {"devices": [{"tag": "M"}], "terminals": [{"tag": "CN10:U"}]}, {"categories": {}})
    assert r["import_verdict"] == "PASS"
    assert r["import_blocking_failures"] == []


# ── 2. Missing conductor fails (a safety-critical terminal absent → G12) ───────
def test_2_missing_conductor_fails(tmp_path):
    r = _verdict(tmp_path, {"terminals": [{"tag": "CN6:DI1"}]}, {"safety_critical": ["CN2:STO_A"]})
    assert r["import_verdict"] == "FAIL"
    assert "safety_critical_misread" in r["import_blocking_failures"]


# ── 3. Invented device fails ──────────────────────────────────────────────────
def test_3_invented_device_fails(tmp_path):
    r = _verdict(tmp_path, {"devices": [{"tag": "GHOSTDRIVE"}]},
                 {"categories": {"device": {"expected": ["ATV340"], "known_misreads": ["GHOSTDRIVE"]}}})
    assert r["import_verdict"] == "FAIL"
    assert {"exact_label_mismatch", "confident_misread"} & set(r["import_blocking_failures"])


# ── 4. Invented terminal fails ────────────────────────────────────────────────
def test_4_invented_terminal_fails(tmp_path):
    r = _verdict(tmp_path, {"terminals": [{"tag": "CN6:XX9"}]},
                 {"categories": {"xref": {"expected": ["CN6:DQ1"], "known_misreads": ["CN6:XX9"]}}})
    assert r["import_verdict"] == "FAIL"
    assert "exact_label_mismatch" in r["import_blocking_failures"]


# ── 5. Unsupported connection fails (target resolves to no entity → dangling) ──
def test_5_unsupported_connection_fails(tmp_path):
    g = {"devices": [{"tag": "ENC"}], "network_links": [{"tag": "L", "connects": ["ENC", "PHANTOM_CN"]}]}
    r = _verdict(tmp_path, g, {"require_refs_resolve": True})
    assert r["import_verdict"] == "FAIL"
    assert "dangling_reference" in r["import_blocking_failures"]


# ── 6. Valid +AI2/-AI2 sign variants do NOT false-fail ────────────────────────
def test_6_ai2_sign_variants_do_not_false_fail(tmp_path):
    g = {
        "terminals": [{"tag": "CN6:AI2+"}, {"tag": "CN6:AI2-"}],
        "plc_io_channels": [{"tag": "AI2", "connects": ["CN6:AI2+", "CN6:AI2-"]}],
    }
    rubric = {"categories": {"xref": {"expected": ["CN6:AI2+", "CN6:AI2-"], "known_misreads": []}},
              "require_refs_resolve": True}
    r = _verdict(tmp_path, g, rubric)
    assert r["import_verdict"] == "PASS"
    assert r["import_blocking_failures"] == []


# ── 7. Judge approval cannot clear a deterministic failure ────────────────────
def test_7_judge_approval_cannot_clear_deterministic_fail(tmp_path, monkeypatch):
    bad = {"package": {"sheet": "1/2"}, "devices": [{"tag": "M"}, {"tag": "M"}],
           "off_page_references": [{"tag": "2/2"}]}

    def glowing(*a, **k):
        return {"overall_score_provisional": 100, "letter": "A", "hard_failure": False, "provisional": True}

    row, _ = _run_runner(tmp_path, monkeypatch, bad, "judge-override", judge=glowing)
    assert row["import_verdict"] == "FAIL"   # the judge's A/100 did NOT clear the deterministic FAIL
    assert row["score"] == 100               # the judge's provisional score is a separate axis, untouched


# ── 8. Missing judge does not prevent deterministic grading ───────────────────
def test_8_missing_judge_still_grades(tmp_path, monkeypatch):
    row, _ = _run_runner(tmp_path, monkeypatch, {"devices": [{"tag": "M"}, {"tag": "M"}]}, "no-judge", no_judge=True)
    assert row["import_verdict"] == "FAIL"   # deterministic grading ran with no judge at all
    assert "duplicate_identifier" in row["import_blocking_failures"]


# ── 9. Malformed graphs fail safely (no crash) ────────────────────────────────
def test_9_malformed_graphs_fail_safely(tmp_path):
    for bad in ({"devices": "not-a-list"}, {"terminals": [123, None]}, {}, {"functional_paths": [None]}):
        r = _verdict(tmp_path, bad, {"categories": {}})
        assert r["import_verdict"] in ("PASS", "FAIL")          # returns a verdict — never raises
        assert isinstance(r["import_blocking_failures"], list)


# ── 10. Report AND email preserve identical verdicts + blockers ───────────────
def test_10_report_and_email_preserve_verdict_and_blockers(tmp_path, monkeypatch):
    import runner

    bad = {"package": {"sheet": "1/2"}, "devices": [{"tag": "M"}, {"tag": "M"}],
           "off_page_references": [{"tag": "2/2"}]}
    row, td = _run_runner(tmp_path, monkeypatch, bad, "parity")
    grade = gc.grade_case(td / "extraction.json", None)   # the deterministic verdict for this graph
    assert grade["import_verdict"] == "FAIL"

    report = (td / "report.md").read_text(encoding="utf-8")
    source_json = json.loads((td / "source.json").read_text(encoding="utf-8"))
    result = json.loads((td / "telegram_response.json").read_text(encoding="utf-8"))
    jr = json.loads((td / "judge_1.json").read_text(encoding="utf-8"))
    email = runner._email_summary_html(source_json, result, jr, grade)

    for surface in (report, email):
        assert "FAIL" in surface
        for blocker in grade["import_blocking_failures"]:
            assert blocker in surface, f"{blocker} missing from {'report' if surface is report else 'email'}"


# ── 11. Repeated executions produce identical results ─────────────────────────
def test_11_repeated_executions_identical(tmp_path):
    g = {"package": {"sheet": "1/2"}, "devices": [{"tag": "M"}, {"tag": "M"}],
         "off_page_references": [{"tag": "2/2"}]}
    rubric = {"categories": {"device": {"expected": ["ATV340"], "known_misreads": []}}}
    assert _verdict(tmp_path, g, rubric) == _verdict(tmp_path, g, rubric)


# ── 12. Frozen ATV340 truth-set regressions fail CI ───────────────────────────
def test_12_frozen_atv340_regression_fails(tmp_path):
    r = gc.grade_case(_ATV340_GRAPH, _ATV340_RUBRIC)
    assert r["import_verdict"] == "FAIL"
    assert set(r["import_blocking_failures"]) == _ATV340_BLOCKERS   # exactly the 5 frozen blockers
    # Canary: repair the off-page defect → that blocker must stop firing (the gate is not vacuous).
    graph = json.loads(_ATV340_GRAPH.read_text(encoding="utf-8"))
    graph["off_page_references"] = []
    r2 = _verdict(tmp_path, graph, json.loads(_ATV340_RUBRIC.read_text(encoding="utf-8")))
    assert "off_page_from_pagination" not in r2["import_blocking_failures"]


# ── bonus: the grader_gate module runs green on the frozen corpus + prints blockers ──
def test_grader_gate_module_passes_on_frozen_corpus(capsys):
    rc = grader_gate.main([])
    out = capsys.readouterr().out
    assert rc == 0
    assert "GATE PASS" in out
    assert "atv340" in out and "import_verdict=FAIL" in out          # ATV340 verdict + printed
    assert "incompatible_functional_path" in out                     # exact blockers printed
    assert "scu2" in out and "import_verdict=PASS" in out            # both directions represented
