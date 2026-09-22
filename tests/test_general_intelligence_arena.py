"""GI-1 arena harness — Tier 1 deterministic tests ($0, no network).

Pins: the corpus validates against its schema and the plan's coverage
requirements; the deterministic judge catches wrapper degradation and
unsupported asset claims without flagging honest hedges; the blind pair hides
the mapping; a live run is refused without a declared budget; the dry run is
reproducible and writes a report.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ARENA = Path(__file__).resolve().parents[1] / "evals" / "general-intelligence"
sys.path.insert(0, str(ARENA))
sys.path.insert(0, str(ARENA / "runners"))

import arena  # noqa: E402
from judges import rubric  # noqa: E402


def test_corpus_validates_and_meets_gi1_coverage():
    cases = arena.load_cases()
    assert arena.validate_cases(cases) == []
    assert len(cases) >= 20
    cats = {c["category"] for c in cases}
    assert {"industrial", "household", "electronics", "non_maintenance", "maker"} <= cats
    # plan §18: explicit wrapper-degradation controls with non-industrial images
    controls = [
        c
        for c in cases
        if c["category"] == "non_maintenance" and any(t.get("images") for t in c["turns"])
    ]
    assert len(controls) >= 3
    # plan §14: at least one multi-turn conversation case
    assert any(sum(1 for t in c["turns"] if t["role"] == "user") >= 2 for c in cases)
    # plan §20: the combined general + machine-history case exists and forbids a whole-turn refusal
    combo = next(c for c in cases if c["id"] == "gi-ind-combined-general-plus-machine")
    assert combo["expected"]["must_answer"] and combo["expected"]["must_not_claim_asset_evidence"]


def test_schema_rejects_bad_cases():
    good = arena.load_cases()[0]
    bad = json.loads(json.dumps(good))
    bad["category"] = "misc"
    bad["rubric"]["weights"]["correctness"] = 50
    errs = arena.validate_cases([bad])
    assert any("category" in e for e in errs) and any("sum" in e for e in errs)


def _case(**over):
    base = {
        "id": "gi-x",
        "category": "non_maintenance",
        "title": "x",
        "turns": [
            {"role": "user", "text": "What is this?", "images": ["fixtures/nonmaint/beetle.jpg"]}
        ],
        "private_context": None,
        "expected": {
            "must_answer": True,
            "tools_allowed": [],
            "must_not_claim_asset_evidence": True,
            "critical_facts": ["beetle"],
            "forbidden_phrases": ["no notebook"],
        },
        "rubric": {"weights": {d: 100 / 7 for d in rubric.RUBRIC_DIMENSIONS}},
    }
    base.update(over)
    return base


def test_deterministic_judge_flags_gate_refusals_as_degradation():
    for refusal in (
        "I couldn't find that in the selected sources.",
        "MIRA needs approved asset context before answering.",
        "Select a source first.",
        "No manual is loaded for this machine.",
    ):
        v = rubric.judge_deterministic(_case(), "mira", refusal)
        assert v.degraded and v.hard_fail, refusal


def test_deterministic_judge_accepts_an_honest_hedge_inside_a_real_answer():
    answer = (
        "This looks like a ground beetle (Carabidae) — the elytra and long legs are typical; I can't be certain of the species from one photo. "
        "They're harmless and useful in gardens. If you want the species, a top-down shot of the pronotum would help. "
        "I can't verify anything about a specific machine here because I don't have machine history, but that isn't needed for this question."
    )
    v = rubric.judge_deterministic(_case(), "mira", answer)
    assert not v.degraded and not v.hard_fail and v.missing_critical_facts == []


def test_deterministic_judge_flags_asset_claims_without_evidence():
    v = rubric.judge_deterministic(
        _case(),
        "mira",
        "It is a beetle. Also, CV-101 drew 8.1 A at 02:13 last night so the cable is suspect.",
    )
    assert v.asset_claim_without_evidence and v.hard_fail
    ok = rubric.judge_deterministic(
        _case(),
        "mira",
        "It is a beetle. I can't tell whether that occurred on CV-101 because I don't have machine history for that period.",
    )
    assert not ok.asset_claim_without_evidence


def test_forbidden_phrase_and_empty_answer_are_hard_fails():
    assert rubric.judge_deterministic(
        _case(), "mira", "beetle — but there is no notebook bound, so"
    ).forbidden_hits
    assert rubric.judge_deterministic(_case(), "mira", "").empty_answer


def test_blind_pair_hides_mapping_and_is_deterministic():
    c = _case()
    p1 = rubric.blind_pair(c, {"raw": "R", "mira": "M"}, seed=7)
    p2 = rubric.blind_pair(c, {"raw": "R", "mira": "M"}, seed=7)
    assert p1 == p2 and {p1["mapping"]["A"], p1["mapping"]["B"]} == {"raw", "mira"}
    # process-independent: sha256, not hash() (PYTHONHASHSEED would otherwise reshuffle pairs per run)
    assert (
        rubric.blind_pair({"id": "gi-x"}, {"raw": "R", "mira": "M"}, seed=7)["mapping"]
        == p1["mapping"]
    )
    flips = {
        rubric.blind_pair({"id": f"gi-{i}"}, {"raw": "R", "mira": "M"}, seed=7)["mapping"]["A"]
        for i in range(40)
    }
    assert flips == {"raw", "mira"}
    prompt = rubric.judge_prompt(c, p1)
    text = json.dumps(prompt)
    assert "mira" not in text.lower() and "Answer A" in text and "Answer B" in text


def test_weighted_score_and_verdict():
    w = {d: 100 / 7 for d in rubric.RUBRIC_DIMENSIONS}
    assert rubric.weighted_score({d: 10 for d in rubric.RUBRIC_DIMENSIONS}, w) == 10.0
    assert rubric.verdict_for(80, 70) == "MIRA wins"
    assert rubric.verdict_for(70, 80) == "Baseline wins"
    assert rubric.verdict_for(75, 74) == "Tie"


def test_live_run_refused_without_budget(tmp_path, capsys):
    rc = arena.main(["--out", str(tmp_path)], env={})
    assert rc == 2
    assert "budget" in capsys.readouterr().err.lower()


def test_budget_hard_stops():
    b = arena.Budget(0.01)
    b.charge(0.005)
    with pytest.raises(arena.BudgetExceeded):
        b.charge(0.006)
    # unknown models are priced at the maximum so they can only over-estimate
    assert arena.estimate_cost_usd("some-new-model", 1000, 1000) > arena.estimate_cost_usd(
        "gpt-oss-120b", 1000, 1000
    )


def test_dry_run_is_reproducible_and_reports_wrapper_degradation(tmp_path):
    rc = arena.main(["--dry-run", "--out", str(tmp_path / "a")], env={})
    assert rc == 0
    rc = arena.main(["--dry-run", "--out", str(tmp_path / "b")], env={})
    assert rc == 0
    a = [
        json.loads(line)
        for line in (tmp_path / "a" / "results.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    b = [
        json.loads(line)
        for line in (tmp_path / "b" / "results.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [(r["case_id"], r["system"], r["answer"]) for r in a] == [
        (r["case_id"], r["system"], r["answer"]) for r in b
    ]
    assert all(r["cost_usd"] == 0.0 for r in a)
    report = json.loads((tmp_path / "a" / "verdicts.json").read_text(encoding="utf-8"))
    # the canned MIRA mirrors today's engine: image-first cases degrade; text-only ones answer
    assert "gi-world-beetle" in report["wrapper_degradation"]
    assert "gi-world-text-only-general" not in report["wrapper_degradation"]
    assert report["spent_usd"] == 0.0 and report["parity_pct"] is None
    md = (tmp_path / "a" / "report.md").read_text(encoding="utf-8")
    assert "Wrapper degradation" in md and "| non_maintenance |" in md


def test_missing_fixtures_are_recorded_not_faked(tmp_path):
    arena.main(["--dry-run", "--out", str(tmp_path), "--case", "gi-world-beetle"], env={})
    rows = [
        json.loads(line)
        for line in (tmp_path / "results.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert rows and rows[0]["fixture_missing"] == ["fixtures/nonmaint/beetle.jpg"]
