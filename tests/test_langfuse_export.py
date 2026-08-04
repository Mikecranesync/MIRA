"""Unit tests for the pure helpers in tools/langfuse_export.py (no network)."""

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "tools"))

import langfuse_export as le  # noqa: E402


def test_parse_machine():
    assert le.parse_machine("[MACHINE: GARAGE CONVEYOR] status...") == "GARAGE CONVEYOR"
    assert le.parse_machine("no machine block here") == ""
    assert le.parse_machine(None) == ""


def test_parse_question_picks_trailing_nl_line():
    q = "[MACHINE: GARAGE CONVEYOR]\nDC bus 320V, drive RUNNING\nWhy did the conveyor stop?"
    assert le.parse_question(q) == "Why did the conveyor stop?"


def test_parse_question_falls_back_to_whole_string():
    assert le.parse_question("just a question") == "just a question"
    assert le.parse_question(None) == ""


def test_slug():
    assert le.slug("GARAGE CONVEYOR") == "garage_conveyor"
    assert le.slug("Why did it STOP??") == "why_did_it_stop"
    assert le.slug("") == "item"


def test_flatten_row_joins_spans():
    trace = {
        "id": "t1",
        "timestamp": "2026-06-14T09:41:26Z",
        "input": {"query": "[MACHINE: GARAGE CONVEYOR]\nIs the VFD running?"},
        "metadata": {"fsm_state": "RESOLVED", "prompt_version": "1.2"},
    }
    spans = [
        {"name": "vector_search", "output": {"retrieved": [{"score": 0.9}, {"score": 0.7}], "count": 2}},
        {"name": "llm_inference", "output": {"response_preview": "No fault.", "latency_ms": 843}},
    ]
    row = le.flatten_row(trace, spans)
    assert row["machine"] == "GARAGE CONVEYOR"
    assert row["question"] == "Is the VFD running?"
    assert row["answer_preview"] == "No fault."
    assert row["latency_ms"] == 843
    assert row["fsm_state"] == "RESOLVED"
    assert row["n_chunks"] == 2
    assert row["top_score"] == 0.9


def test_eval_item_is_inactive_and_shaped():
    row = {"question": "Why did the conveyor stop?", "machine": "GARAGE CONVEYOR"}
    item = le.eval_item(row, 3)
    assert item["active"] is False
    assert item["question"] == "Why did the conveyor stop?"
    assert item["expected_asset"] == "garage_conveyor"
    assert item["severity"] == "production"
    assert item["id"].startswith("hist_0003_")
    for k in ("expected_tags", "expected_documents", "expected_answer_points", "required_citations"):
        assert item[k] == []
