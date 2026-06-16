"""Tests for pairwise Elo comparison runner.

Offline tests covering Elo math, JSONL parsing, comparison logic, and edge cases.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from tests.eval.compare import (
    ComparisonResult,
    EloRater,
    compare_configs,
    load_judge_jsonl,
)


# ── EloRater tests ──────────────────────────────────────────────────────────


class TestEloRater:

    def test_initial_rating(self):
        """New configs start at 1500."""
        elo = EloRater.__new__(EloRater)
        elo.ratings = {}
        elo.history = []
        elo.path = Path("/dev/null")
        assert elo.get_rating("never-seen") == 1500.0

    def test_update_win(self):
        """Winner gains rating, loser drops, total preserved."""
        elo = EloRater.__new__(EloRater)
        elo.ratings = {}
        elo.history = []
        elo.path = Path("/dev/null")

        delta = elo.update("config_a", "config_b", "A")

        assert delta > 0
        assert elo.ratings["config_a"]["elo"] > 1500.0
        assert elo.ratings["config_b"]["elo"] < 1500.0
        # Total rating preserved (zero-sum)
        total = elo.ratings["config_a"]["elo"] + elo.ratings["config_b"]["elo"]
        assert abs(total - 3000.0) < 0.01
        # Game counts
        assert elo.ratings["config_a"]["wins"] == 1
        assert elo.ratings["config_b"]["losses"] == 1

    def test_update_tie(self):
        """Tie with equal ratings produces no change."""
        elo = EloRater.__new__(EloRater)
        elo.ratings = {}
        elo.history = []
        elo.path = Path("/dev/null")

        delta = elo.update("config_a", "config_b", "tie")

        assert abs(delta) < 0.01  # No movement when equal ratings tie
        assert elo.ratings["config_a"]["ties"] == 1
        assert elo.ratings["config_b"]["ties"] == 1

    def test_save_load_roundtrip(self, tmp_path):
        """Elo ratings survive save/load cycle."""
        elo_path = tmp_path / "elo.json"

        elo = EloRater(elo_path)
        elo.update("v1", "v2", "A")
        elo.add_history(ComparisonResult(
            config_a="v1", config_b="v2", a_wins=3, b_wins=1, ties=1,
        ))
        elo.save()

        elo2 = EloRater(elo_path)
        assert elo2.get_rating("v1") == elo.get_rating("v1")
        assert elo2.get_rating("v2") == elo.get_rating("v2")
        assert len(elo2.history) == 1
        assert elo2.history[0]["config_a"] == "v1"

    def test_unequal_ratings_expected_probability(self):
        """Higher-rated config winning gains less than an upset."""
        elo = EloRater.__new__(EloRater)
        elo.ratings = {}
        elo.history = []
        elo.path = Path("/dev/null")

        # First give A a big lead
        for _ in range(5):
            elo.update("strong", "weak", "A")

        ra_before = elo.ratings["strong"]["elo"]
        # Now strong wins again — should gain less than initial 16
        delta = elo.update("strong", "weak", "A")
        assert delta < 16.0  # Less than K/2 for expected wins


# ── JSONL loading tests ──────────────────────────────────────────────────────


class TestLoadJudgeJsonl:

    def test_load_valid(self, tmp_path):
        """Valid JSONL parses into scenario dict."""
        p = tmp_path / "judge.jsonl"
        p.write_text(
            '{"scenario_id": "sc1", "scores": {"groundedness": 5, "helpfulness": 4, "tone": 5, "instruction_following": 4}}\n'
            '{"scenario_id": "sc2", "scores": {"groundedness": 3, "helpfulness": 3, "tone": 4, "instruction_following": 3}}\n'
        )
        result = load_judge_jsonl(p)
        assert len(result) == 2
        assert result["sc1"]["scores"]["groundedness"] == 5
        assert result["sc2"]["scores"]["helpfulness"] == 3

    def test_load_empty_lines(self, tmp_path):
        """Empty lines are skipped."""
        p = tmp_path / "judge.jsonl"
        p.write_text(
            '\n'
            '{"scenario_id": "sc1", "scores": {"groundedness": 5}}\n'
            '\n'
        )
        result = load_judge_jsonl(p)
        assert len(result) == 1

    def test_load_malformed_line(self, tmp_path):
        """Malformed JSON lines are skipped with warning."""
        p = tmp_path / "judge.jsonl"
        p.write_text(
            '{"scenario_id": "sc1", "scores": {"groundedness": 5}}\n'
            'not valid json\n'
            '{"scenario_id": "sc2", "scores": {"groundedness": 4}}\n'
        )
        result = load_judge_jsonl(p)
        assert len(result) == 2


# ── compare_configs tests ────────────────────────────────────────────────────


def _write_jsonl(path: Path, scenarios: list[tuple[str, dict]]) -> None:
    """Helper: write [(scenario_id, scores), ...] as JSONL."""
    with open(path, "w") as f:
        for sid, scores in scenarios:
            json.dump({"scenario_id": sid, "scores": scores}, f)
            f.write("\n")


class TestCompareConfigs:

    def test_a_wins(self, tmp_path):
        """Config A has higher scores on most scenarios."""
        fa = tmp_path / "a.jsonl"
        fb = tmp_path / "b.jsonl"
        _write_jsonl(fa, [
            ("sc1", {"g": 5, "h": 5, "t": 5, "i": 5}),  # avg 5.0
            ("sc2", {"g": 4, "h": 4, "t": 4, "i": 4}),  # avg 4.0
            ("sc3", {"g": 5, "h": 4, "t": 5, "i": 4}),  # avg 4.5
        ])
        _write_jsonl(fb, [
            ("sc1", {"g": 3, "h": 3, "t": 3, "i": 3}),  # avg 3.0
            ("sc2", {"g": 3, "h": 3, "t": 3, "i": 3}),  # avg 3.0
            ("sc3", {"g": 2, "h": 2, "t": 2, "i": 2}),  # avg 2.0
        ])

        result = compare_configs("A", "B", fa, fb)
        assert result.a_wins == 3
        assert result.b_wins == 0
        assert result.elo_delta_a > 0

    def test_b_wins(self, tmp_path):
        """Config B has higher scores."""
        fa = tmp_path / "a.jsonl"
        fb = tmp_path / "b.jsonl"
        _write_jsonl(fa, [
            ("sc1", {"g": 2, "h": 2, "t": 2, "i": 2}),
            ("sc2", {"g": 2, "h": 2, "t": 2, "i": 2}),
        ])
        _write_jsonl(fb, [
            ("sc1", {"g": 5, "h": 5, "t": 5, "i": 5}),
            ("sc2", {"g": 4, "h": 4, "t": 4, "i": 4}),
        ])

        result = compare_configs("A", "B", fa, fb)
        assert result.b_wins == 2
        assert result.a_wins == 0
        assert result.elo_delta_a < 0

    def test_tie(self, tmp_path):
        """Equal scores produce ties."""
        fa = tmp_path / "a.jsonl"
        fb = tmp_path / "b.jsonl"
        _write_jsonl(fa, [
            ("sc1", {"g": 4, "h": 4, "t": 4, "i": 4}),
            ("sc2", {"g": 3, "h": 3, "t": 3, "i": 3}),
        ])
        _write_jsonl(fb, [
            ("sc1", {"g": 4, "h": 4, "t": 4, "i": 4}),
            ("sc2", {"g": 3, "h": 3, "t": 3, "i": 3}),
        ])

        result = compare_configs("A", "B", fa, fb)
        assert result.ties == 2
        assert result.a_wins == 0
        assert result.b_wins == 0

    def test_missing_scenario(self, tmp_path):
        """Scenarios present in only one file are excluded from comparison."""
        fa = tmp_path / "a.jsonl"
        fb = tmp_path / "b.jsonl"
        _write_jsonl(fa, [
            ("sc1", {"g": 5, "h": 5, "t": 5, "i": 5}),
            ("sc_only_a", {"g": 5, "h": 5, "t": 5, "i": 5}),
        ])
        _write_jsonl(fb, [
            ("sc1", {"g": 3, "h": 3, "t": 3, "i": 3}),
            ("sc_only_b", {"g": 5, "h": 5, "t": 5, "i": 5}),
        ])

        result = compare_configs("A", "B", fa, fb)
        assert result.total == 1  # Only sc1 compared
        assert result.a_wins == 1

    def test_markdown_output(self, tmp_path):
        """Markdown report renders without errors."""
        fa = tmp_path / "a.jsonl"
        fb = tmp_path / "b.jsonl"
        _write_jsonl(fa, [("sc1", {"g": 5, "h": 4, "t": 5, "i": 4})])
        _write_jsonl(fb, [("sc1", {"g": 3, "h": 3, "t": 3, "i": 3})])

        result = compare_configs("baseline", "candidate", fa, fb)
        md = result.to_markdown()
        assert "baseline" in md
        assert "candidate" in md
        assert "| `sc1`" in md
