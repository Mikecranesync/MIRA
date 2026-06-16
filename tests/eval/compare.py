#!/usr/bin/env python3
"""Pairwise Elo comparison runner for MIRA eval.

Compares two eval runs (judge JSONL files) and updates Elo ratings to track
directional quality improvement across prompt/model changes.

This is the autoresearch pattern's ``results.tsv`` equivalent: every config
change gets a comparison run, and the Elo rating tells you whether it was
an improvement.

Usage:
    # Compare two judge JSONL files:
    python tests/eval/compare.py \\
      --config-a v0.5-claude-sonnet --file-a tests/eval/runs/2026-04-13-judge.jsonl \\
      --config-b v0.6-claude-sonnet --file-b tests/eval/runs/2026-04-14-judge.jsonl

    # Dry-run (no elo.json update):
    python tests/eval/compare.py --dry-run \\
      --config-a baseline --file-a run_a.jsonl \\
      --config-b candidate --file-b run_b.jsonl
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("mira-eval-compare")

DEFAULT_ELO_PATH = Path(__file__).parent / "elo.json"
DEFAULT_INITIAL_ELO = 1500.0
K_FACTOR = 32


# ── Data structures ─────────────────────────────────────────────────────────


@dataclass
class ScenarioOutcome:
    """Result of comparing two configs on a single scenario."""

    scenario_id: str
    avg_a: float
    avg_b: float
    winner: str  # "A", "B", or "tie"


@dataclass
class ComparisonResult:
    """Aggregate result of comparing two configs across all fixtures."""

    config_a: str
    config_b: str
    scenarios: list[ScenarioOutcome] = field(default_factory=list)
    a_wins: int = 0
    b_wins: int = 0
    ties: int = 0
    elo_delta_a: float = 0.0

    @property
    def total(self) -> int:
        return self.a_wins + self.b_wins + self.ties

    def summary(self) -> str:
        return (
            f"{self.config_a} vs {self.config_b}: "
            f"A={self.a_wins} B={self.b_wins} ties={self.ties} "
            f"(Elo delta A: {self.elo_delta_a:+.1f})"
        )

    def to_markdown(self) -> str:
        lines = [
            f"# Pairwise Comparison: {self.config_a} vs {self.config_b}",
            "",
            f"**Result:** A={self.a_wins} wins, B={self.b_wins} wins, {self.ties} ties",
            f"**Elo delta (A):** {self.elo_delta_a:+.1f}",
            "",
            "| Scenario | Avg A | Avg B | Winner |",
            "|----------|-------|-------|--------|",
        ]
        for s in self.scenarios:
            lines.append(
                f"| `{s.scenario_id}` | {s.avg_a:.2f} | {s.avg_b:.2f} | {s.winner} |"
            )
        return "\n".join(lines)


# ── Elo rating engine ────────────────────────────────────────────────────────


class EloRater:
    """Manages Elo ratings persisted in a JSON file.

    Standard Elo with K=32:
      expected = 1 / (1 + 10^((opponent - self) / 400))
      new_rating = old_rating + K * (result - expected)
    """

    def __init__(self, elo_path: Path = DEFAULT_ELO_PATH) -> None:
        self.path = elo_path
        self.ratings: dict[str, dict] = {}
        self.history: list[dict] = []
        self._load()

    def _load(self) -> None:
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text())
                self.ratings = data.get("ratings", {})
                self.history = data.get("history", [])
            except (json.JSONDecodeError, KeyError):
                log.warning("Corrupt elo.json — starting fresh")
                self.ratings = {}
                self.history = []

    def get_rating(self, config: str) -> float:
        """Return current Elo for a config (default 1500 for new entries)."""
        return self.ratings.get(config, {}).get("elo", DEFAULT_INITIAL_ELO)

    def _ensure_config(self, config: str) -> None:
        if config not in self.ratings:
            self.ratings[config] = {
                "elo": DEFAULT_INITIAL_ELO,
                "games": 0,
                "wins": 0,
                "losses": 0,
                "ties": 0,
            }

    def update(self, config_a: str, config_b: str, outcome: str) -> float:
        """Apply one Elo update. outcome is "A", "B", or "tie".

        Returns the Elo delta for config_a.
        """
        self._ensure_config(config_a)
        self._ensure_config(config_b)

        ra = self.ratings[config_a]["elo"]
        rb = self.ratings[config_b]["elo"]

        expected_a = 1.0 / (1.0 + math.pow(10, (rb - ra) / 400))
        expected_b = 1.0 - expected_a

        if outcome == "A":
            result_a, result_b = 1.0, 0.0
            self.ratings[config_a]["wins"] += 1
            self.ratings[config_b]["losses"] += 1
        elif outcome == "B":
            result_a, result_b = 0.0, 1.0
            self.ratings[config_a]["losses"] += 1
            self.ratings[config_b]["wins"] += 1
        else:  # tie
            result_a, result_b = 0.5, 0.5
            self.ratings[config_a]["ties"] += 1
            self.ratings[config_b]["ties"] += 1

        delta_a = K_FACTOR * (result_a - expected_a)
        delta_b = K_FACTOR * (result_b - expected_b)

        self.ratings[config_a]["elo"] = round(ra + delta_a, 1)
        self.ratings[config_b]["elo"] = round(rb + delta_b, 1)
        self.ratings[config_a]["games"] += 1
        self.ratings[config_b]["games"] += 1

        return delta_a

    def add_history(self, result: ComparisonResult) -> None:
        self.history.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "config_a": result.config_a,
            "config_b": result.config_b,
            "a_wins": result.a_wins,
            "b_wins": result.b_wins,
            "ties": result.ties,
            "elo_delta_a": round(result.elo_delta_a, 1),
        })

    def save(self) -> None:
        data = {"ratings": self.ratings, "history": self.history}
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2) + "\n")
        tmp.replace(self.path)
        log.info("Saved Elo ratings to %s", self.path)

    def to_dict(self) -> dict:
        return {"ratings": self.ratings, "history": self.history}


# ── JSONL loading ────────────────────────────────────────────────────────────


def load_judge_jsonl(path: Path) -> dict[str, dict]:
    """Load a judge JSONL file into {scenario_id: {scores: {...}, ...}}.

    Each line is a JSON object with at least ``scenario_id`` and ``scores``.
    """
    results: dict[str, dict] = {}
    with open(path) as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                sid = obj.get("scenario_id")
                if sid:
                    results[sid] = obj
            except json.JSONDecodeError:
                log.warning("Skipping malformed line %d in %s", line_num, path)
    return results


# ── Comparison logic ─────────────────────────────────────────────────────────

TIE_THRESHOLD = 0.5  # average score difference within this is a tie


def compare_configs(
    config_a: str,
    config_b: str,
    file_a: Path,
    file_b: Path,
    elo: EloRater | None = None,
) -> ComparisonResult:
    """Compare two eval runs and return pairwise results with Elo updates.

    Args:
        config_a: Name for config A (e.g. "v0.5-claude-sonnet")
        config_b: Name for config B (e.g. "v0.6-claude-sonnet")
        file_a: Path to judge JSONL from config A's eval run
        file_b: Path to judge JSONL from config B's eval run
        elo: Optional EloRater to update. If None, Elo is computed but not persisted.
    """
    scores_a = load_judge_jsonl(file_a)
    scores_b = load_judge_jsonl(file_b)

    # Only compare scenarios present in both runs
    common = sorted(set(scores_a.keys()) & set(scores_b.keys()))
    if not common:
        log.warning("No common scenarios between %s and %s", file_a, file_b)
        return ComparisonResult(config_a=config_a, config_b=config_b)

    only_a = set(scores_a.keys()) - set(scores_b.keys())
    only_b = set(scores_b.keys()) - set(scores_a.keys())
    if only_a:
        log.info("Scenarios only in A (%d): %s", len(only_a), ", ".join(sorted(only_a)[:5]))
    if only_b:
        log.info("Scenarios only in B (%d): %s", len(only_b), ", ".join(sorted(only_b)[:5]))

    result = ComparisonResult(config_a=config_a, config_b=config_b)

    for sid in common:
        sa = scores_a[sid].get("scores", {})
        sb = scores_b[sid].get("scores", {})

        avg_a = sum(sa.values()) / max(len(sa), 1)
        avg_b = sum(sb.values()) / max(len(sb), 1)

        diff = avg_a - avg_b
        if diff > TIE_THRESHOLD:
            winner = "A"
            result.a_wins += 1
        elif diff < -TIE_THRESHOLD:
            winner = "B"
            result.b_wins += 1
        else:
            winner = "tie"
            result.ties += 1

        result.scenarios.append(ScenarioOutcome(
            scenario_id=sid, avg_a=avg_a, avg_b=avg_b, winner=winner,
        ))

    # Elo update: one game per comparison run (aggregate outcome)
    if result.a_wins > result.b_wins:
        overall = "A"
    elif result.b_wins > result.a_wins:
        overall = "B"
    else:
        overall = "tie"

    if elo:
        result.elo_delta_a = elo.update(config_a, config_b, overall)
        elo.add_history(result)
    else:
        # Compute delta without persisting
        temp = EloRater.__new__(EloRater)
        temp.ratings = {}
        temp.history = []
        temp.path = Path("/dev/null")
        temp._ensure_config(config_a)
        temp._ensure_config(config_b)
        result.elo_delta_a = temp.update(config_a, config_b, overall)

    log.info(
        "Comparison: %s vs %s — A=%d B=%d ties=%d (overall: %s, Elo delta A: %+.1f)",
        config_a, config_b, result.a_wins, result.b_wins, result.ties,
        overall, result.elo_delta_a,
    )
    return result


# ── CLI ──────────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare two MIRA eval runs and update Elo ratings"
    )
    parser.add_argument("--config-a", required=True, help="Name for config A")
    parser.add_argument("--config-b", required=True, help="Name for config B")
    parser.add_argument("--file-a", required=True, type=Path, help="Judge JSONL for config A")
    parser.add_argument("--file-b", required=True, type=Path, help="Judge JSONL for config B")
    parser.add_argument("--elo-path", type=Path, default=DEFAULT_ELO_PATH,
                        help="Path to elo.json")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print results without updating elo.json")
    args = parser.parse_args()

    if not args.file_a.exists():
        sys.exit(f"File not found: {args.file_a}")
    if not args.file_b.exists():
        sys.exit(f"File not found: {args.file_b}")

    elo = None if args.dry_run else EloRater(args.elo_path)

    result = compare_configs(
        config_a=args.config_a,
        config_b=args.config_b,
        file_a=args.file_a,
        file_b=args.file_b,
        elo=elo,
    )

    print()
    print(result.to_markdown())

    if elo and not args.dry_run:
        elo.save()
        print(f"\nElo ratings updated in {args.elo_path}")
    else:
        print("\n[Dry run — elo.json not updated]")


if __name__ == "__main__":
    main()
