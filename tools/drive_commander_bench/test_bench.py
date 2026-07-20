"""Self-tests for the Drive Commander Lane A benchmark harness.

Proves (a) the frozen corpus is intact, (b) the real deterministic pack layer
passes every case at $0, and (c) the grader has TEETH — it catches a fabricated
answer, a mutated code, and a missing decline. Run:

    PYTHONUTF8=1 python -m pytest tools/drive_commander_bench/test_bench.py -q
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from . import runner


@dataclass
class _FakeAns:
    matched: bool
    answer_source: str
    answer: str = ""
    citations: tuple = ()


def test_corpus_frozen():
    doc = json.loads(runner._CORPUS.read_text(encoding="utf-8"))
    assert runner._check_frozen(doc) == runner._FROZEN_SHA, "corpus changed without re-freezing"


def test_lane_a_all_pass_zero_gate_failures():
    doc = json.loads(runner._CORPUS.read_text(encoding="utf-8"))
    results = [runner._grade(c) for c in doc["cases"]]
    failures = [r for r in results if not r["ok"]]
    assert failures == [], f"deterministic Lane A regressed: {failures}"


def test_all_answerable_cases_are_zero_token():
    doc = json.loads(runner._CORPUS.read_text(encoding="utf-8"))
    results = [runner._grade(c) for c in doc["cases"]]
    answerable = [c for c in doc["cases"] if not c["expect_decline"]]
    zt = [r for r in results if r["route"] == "exact_lookup"]
    assert len(zt) == len(answerable), "Lane A must answer every in-corpus case at tier-1 (zero-token)"


# ── teeth: the grader must catch each hard-gate violation ────────────────────

def test_grader_catches_fabrication_on_decline_case(monkeypatch):
    # a case that MUST decline, but the pack (hypothetically) answers a bogus code
    monkeypatch.setattr(runner, "answer_fault_code",
                        lambda pid, tok: _FakeAns(matched=True, answer_source="drive_pack",
                                                  answer="Fault 99: totally made up", citations=({"doc": "x", "page": "1"},)))
    r = runner._grade({"id": "t", "kind": "fault", "family": "durapulse_gs10",
                       "input": "99", "expect_decline": True, "expect_meaning_substr": None})
    assert not r["ok"] and any("gate1_9" in g for g in r["gates"])


def test_grader_catches_code_mutation(monkeypatch):
    # asked about code 4 (UnderVoltage) but answer asserts a DIFFERENT F-code
    monkeypatch.setattr(runner, "answer_fault_code",
                        lambda pid, tok: _FakeAns(matched=True, answer_source="drive_pack",
                                                  answer="This is F008 OverVoltage", citations=({"doc": "x", "page": "1"},)))
    r = runner._grade({"id": "t", "kind": "fault", "family": "powerflex_525",
                       "input": "4", "expect_decline": False, "expect_meaning_substr": "UnderVoltage"})
    assert not r["ok"] and any("gate6" in g or "meaning_wrong" in g for g in r["gates"])


def test_grader_catches_uncited_answer(monkeypatch):
    monkeypatch.setattr(runner, "answer_fault_code",
                        lambda pid, tok: _FakeAns(matched=True, answer_source="drive_pack",
                                                  answer="OverVoltage", citations=()))
    r = runner._grade({"id": "t", "kind": "fault", "family": "powerflex_525",
                       "input": "5", "expect_decline": False, "expect_meaning_substr": "OverVoltage"})
    assert not r["ok"] and any("gate3_no_citation" in g for g in r["gates"])


def test_grader_catches_silent_family_guess(monkeypatch):
    # unsupported family MUST resolve to None; a silent pick is gate 4
    class _P:  # duck-typed DrivePack
        pack_id = "durapulse_gs10"
    monkeypatch.setattr(runner, "resolve_pack", lambda text: _P())
    r = runner._grade({"id": "t", "kind": "family_resolve", "family": None,
                       "input": "siemens g120", "expect_decline": True, "expect_meaning_substr": None})
    assert not r["ok"] and any("gate4" in g for g in r["gates"])
