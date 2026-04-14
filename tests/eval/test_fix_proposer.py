"""Tests for fix_proposer — eval failure clustering + patch proposal.

Offline tests covering scorecard parsing, cluster grouping, reason
signatures, and the orchestrator flow with mocked Claude calls.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

from tools.fix_proposer import (
    FailureCluster,
    FailureRecord,
    FixProposer,
    FixProposerConfig,
    _reason_signature,
    cluster_failures,
    find_latest_scorecard,
    parse_scorecard,
)


# ── Parsing tests ──────────────────────────────────────────────────────────


SAMPLE_SCORECARD = """\
# MIRA Eval Scorecard — 2026-04-14

**Pass rate:** 6/10 scenarios (60%)

## Results
| Scenario | ... |
|---|---|
| `gs10_overcurrent_01` | ... |

## Failures

### gs20_cross_vendor_03
- **cp_keyword_match** FAILED: Forbidden keyword 'PowerFlex 525' found in response
- Last response: `PF525 parameter...`

### yaskawa_out_of_kb_04
- **cp_keyword_match** FAILED: No honesty signal detected in response
- Last response: `Check the motor...`

### gs1_undervoltage_12
- **cp_keyword_match** FAILED: No match from ['undervoltage', 'voltage']
- Last response: `Something vague...`

### pf523_heatsink_18
- **cp_reached_state** FAILED: State='Q1' expected Q2
- Last response: `Question...`

## Judge Summary
..."""


def test_parse_scorecard_extracts_failures(tmp_path):
    """Scorecard parser pulls scenario, checkpoint, and reason."""
    p = tmp_path / "scorecard.md"
    p.write_text(SAMPLE_SCORECARD)

    failures = parse_scorecard(p)
    assert len(failures) == 4

    by_scenario = {f.scenario_id: f for f in failures}
    assert "gs20_cross_vendor_03" in by_scenario
    assert by_scenario["gs20_cross_vendor_03"].checkpoint == "cp_keyword_match"
    assert "PowerFlex 525" in by_scenario["gs20_cross_vendor_03"].reason


def test_parse_scorecard_ignores_non_failures_section(tmp_path):
    """Content outside ## Failures is not picked up."""
    p = tmp_path / "scorecard.md"
    p.write_text(
        "# Scorecard\n## Results\n### fake_scenario\n- **cp_x** FAILED: outside\n\n## Failures\n\n### real\n- **cp_y** FAILED: inside\n\n## Summary\n"
    )
    failures = parse_scorecard(p)
    assert len(failures) == 1
    assert failures[0].scenario_id == "real"


def test_parse_scorecard_missing_file(tmp_path):
    """Missing scorecard returns empty list, no exception."""
    failures = parse_scorecard(tmp_path / "does_not_exist.md")
    assert failures == []


def test_find_latest_scorecard_prefers_judge(tmp_path):
    """Judge-enabled scorecards are preferred over plain ones."""
    (tmp_path / "2026-04-13.md").write_text("")
    (tmp_path / "2026-04-14T0300-judge.md").write_text("")
    (tmp_path / "2026-04-14.md").write_text("")
    latest = find_latest_scorecard(tmp_path)
    assert latest is not None
    assert "judge" in latest.stem


def test_find_latest_scorecard_empty_dir(tmp_path):
    assert find_latest_scorecard(tmp_path) is None


# ── Signature + clustering tests ──────────────────────────────────────────


def test_reason_signature_strips_specifics():
    """Reason signatures normalize away scenario-specific details."""
    sig1 = _reason_signature("No match from ['foo', 'bar']")
    sig2 = _reason_signature("No match from ['baz', 'qux', 'quux']")
    assert sig1 == sig2  # Same signature despite different keyword lists


def test_reason_signature_strips_numbers():
    sig1 = _reason_signature("State='Q1' expected Q2")
    sig2 = _reason_signature("State='Q3' expected Q2")
    assert sig1 == sig2


def test_cluster_failures_groups_by_checkpoint_and_signature():
    """Failures with same checkpoint + reason signature cluster together."""
    failures = [
        FailureRecord("sc1", "cp_keyword_match", "No match from ['foo']"),
        FailureRecord("sc2", "cp_keyword_match", "No match from ['bar']"),
        FailureRecord("sc3", "cp_keyword_match", "No match from ['baz']"),
        FailureRecord("sc4", "cp_reached_state", "State='Q1' expected Q2"),
        FailureRecord("sc5", "cp_reached_state", "State='Q1' expected Q3"),
    ]
    clusters = cluster_failures(failures, min_size=3)
    assert len(clusters) == 1  # Only keyword_match cluster reaches size 3
    assert clusters[0].size == 3
    assert clusters[0].checkpoint == "cp_keyword_match"


def test_cluster_failures_respects_min_size():
    """Clusters below min_size are filtered out."""
    failures = [
        FailureRecord("sc1", "cp_x", "reason A"),
        FailureRecord("sc2", "cp_x", "reason A"),
    ]
    assert cluster_failures(failures, min_size=3) == []
    clusters = cluster_failures(failures, min_size=2)
    assert len(clusters) == 1


def test_cluster_failures_sorted_by_size():
    """Largest clusters come first."""
    failures = []
    for i in range(5):
        failures.append(FailureRecord(f"sc{i}", "cp_a", "reason A"))
    for i in range(3):
        failures.append(FailureRecord(f"sc_b{i}", "cp_b", "reason B"))
    clusters = cluster_failures(failures, min_size=2)
    assert len(clusters) == 2
    assert clusters[0].size == 5
    assert clusters[1].size == 3


def test_failure_cluster_id_is_slug_safe():
    """Cluster IDs are safe for git branch names."""
    cluster = FailureCluster(
        checkpoint="cp_keyword_match",
        reason_signature="no match from list / keywords!",
        failures=[],
    )
    cid = cluster.cluster_id
    assert "/" not in cid
    assert "!" not in cid
    assert " " not in cid


# ── Orchestrator tests ─────────────────────────────────────────────────────


def _make_proposer(tmp_path: Path) -> FixProposer:
    return FixProposer(FixProposerConfig(
        anthropic_api_key="test-key",
        gh_token="test-gh",
        repo_root=REPO_ROOT,
        state_path=tmp_path / "state.json",
        runs_dir=tmp_path / "runs",
        min_cluster_size=3,
        max_clusters_per_run=3,
    ))


def test_run_no_scorecard_returns_cleanly(tmp_path):
    """Empty runs dir returns ok + no_scorecard."""
    proposer = _make_proposer(tmp_path)
    result = asyncio.run(proposer.run(dry_run=True))
    assert result["status"] == "ok"
    assert result["reason"] == "no_scorecard"


def test_run_no_failures_returns_cleanly(tmp_path):
    """Scorecard with no failures returns ok + no_failures."""
    proposer = _make_proposer(tmp_path)
    proposer.cfg.runs_dir.mkdir()
    (proposer.cfg.runs_dir / "ok.md").write_text(
        "# Scorecard\n\n## Failures\n\n## Summary\nAll passed"
    )
    result = asyncio.run(proposer.run(dry_run=True))
    assert result["status"] == "ok"
    assert result["reason"] == "no_failures"


def test_run_no_clusters_below_threshold(tmp_path):
    """Failures below min_cluster_size return ok + no_clusters."""
    proposer = _make_proposer(tmp_path)
    proposer.cfg.runs_dir.mkdir()
    # Only 2 failures of the same type — below default threshold of 3
    (proposer.cfg.runs_dir / "x.md").write_text("""\
# Scorecard

## Failures

### sc1
- **cp_x** FAILED: some reason

### sc2
- **cp_x** FAILED: some reason

## Summary
""")
    result = asyncio.run(proposer.run(dry_run=True))
    assert result["status"] == "ok"
    assert result["reason"] == "no_clusters"


def test_run_dry_run_does_not_open_pr(tmp_path, monkeypatch):
    """Dry-run with a qualifying cluster generates proposal but no PR."""
    proposer = _make_proposer(tmp_path)
    proposer.cfg.runs_dir.mkdir()
    (proposer.cfg.runs_dir / "x.md").write_text(SAMPLE_SCORECARD.replace(
        "### yaskawa_out_of_kb_04\n- **cp_keyword_match** FAILED: No honesty signal detected in response",
        "### yaskawa_out_of_kb_04\n- **cp_keyword_match** FAILED: Forbidden keyword 'Foo' found in response\n\n### extra_cluster\n- **cp_keyword_match** FAILED: Forbidden keyword 'Bar' found in response"
    ))

    # Mock Claude to return a fake patch
    async def fake_claude_json(system, user):
        return {
            "hypothesis": "test hypothesis",
            "file_path": "test.yaml",
            "change_type": "edit",
            "rationale": "test rationale",
            "proposed_patch": "test patch",
            "projected_impact": "test impact",
            "confidence": 0.8,
        }
    monkeypatch.setattr(proposer, "_claude_json", fake_claude_json)

    result = asyncio.run(proposer.run(dry_run=True))
    assert result["status"] == "ok"
    # Dry-run: proposals generated but no PRs
    assert result.get("pr_urls") == []


def test_state_persistence(tmp_path):
    """State is saved and reloaded correctly."""
    proposer = _make_proposer(tmp_path)
    proposer._save_state({"last_run_ts": "2026-04-14T00:00:00Z", "proposals": []})

    state = proposer._load_state()
    assert state["last_run_ts"] == "2026-04-14T00:00:00Z"


def test_state_missing_returns_defaults(tmp_path):
    """Missing state file returns fresh defaults."""
    proposer = _make_proposer(tmp_path)
    state = proposer._load_state()
    assert state["last_run_ts"] is None
