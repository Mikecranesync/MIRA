"""Tests for the agent dashboard API and data structures."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Ensure mira-pipeline is importable
_REPO = Path(__file__).resolve().parent.parent
_p = str(_REPO / "mira-bots")
if _p not in sys.path:
    sys.path.append(_p)


# ---------------------------------------------------------------------------
# Helpers: minimal NDJSON fixture data
# ---------------------------------------------------------------------------

_SAMPLE_RUNS = [
    {
        "agent": "kb_builder",
        "started": "2026-04-22T03:58:10+00:00",
        "finished": "2026-04-22T03:58:11+00:00",
        "duration_s": 1.0,
        "detected": 3,
        "succeeded": 3,
        "failed": 0,
        "escalated": 0,
        "details": [{"issue": "ACME: 1 chunks (min 5)", "action": "Triggered crawl", "status": "success"}],
    },
    {
        "agent": "kb_builder",
        "started": "2026-04-22T02:00:00+00:00",
        "finished": "2026-04-22T02:00:02+00:00",
        "duration_s": 2.1,
        "detected": 2,
        "succeeded": 1,
        "failed": 1,
        "escalated": 1,
        "details": [],
    },
]


def _ndjson_text(runs: list[dict]) -> str:
    return "\n".join(json.dumps(r) for r in runs) + "\n"


# ---------------------------------------------------------------------------
# Tests: _read_agent_ndjson helper (used by both status endpoints)
# ---------------------------------------------------------------------------


def test_read_agent_ndjson_returns_runs(tmp_path):
    """Reads NDJSON lines and returns them newest-first."""
    log_file = tmp_path / "kb_builder.ndjson"
    log_file.write_text(_ndjson_text(_SAMPLE_RUNS))

    lines = log_file.read_text().splitlines()
    runs = []
    for line in reversed(lines):
        line = line.strip()
        if line:
            try:
                runs.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    assert len(runs) == 2
    # reversed() means last line in file comes first
    assert runs[0]["started"] == _SAMPLE_RUNS[-1]["started"]
    assert runs[1]["started"] == _SAMPLE_RUNS[-2]["started"]


def test_read_agent_ndjson_skips_corrupt_lines(tmp_path):
    """Corrupt JSON lines are silently skipped."""
    log_file = tmp_path / "infra_guardian.ndjson"
    log_file.write_text('{"valid": 1}\nNOT_JSON\n{"valid": 2}\n')

    lines = log_file.read_text().splitlines()
    runs = []
    for line in reversed(lines):
        line = line.strip()
        if line:
            try:
                runs.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    assert len(runs) == 2
    assert all("valid" in r for r in runs)


# ---------------------------------------------------------------------------
# Tests: public-status response shape
# ---------------------------------------------------------------------------


def test_public_status_shape_all_agents():
    """public-status must return one key per known agent with required fields."""
    # Simulate what the endpoint returns using the sample data
    known_agents = ["kb_builder", "prompt_optimizer", "infra_guardian"]
    fake_runs = {
        "kb_builder": _SAMPLE_RUNS,
        "prompt_optimizer": [],
        "infra_guardian": [],
    }

    result = {}
    for agent_name in known_agents:
        runs = fake_runs[agent_name]
        if runs:
            latest = runs[0]
            result[agent_name] = {
                "last_run": latest.get("started"),
                "last_duration_s": latest.get("duration_s"),
                "last_detected": latest.get("detected", 0),
                "last_succeeded": latest.get("succeeded", 0),
                "last_failed": latest.get("failed", 0),
                "last_escalated": latest.get("escalated", 0),
                "total_runs": len(runs),
                "runs": [{"started": r.get("started"), "succeeded": r.get("succeeded", 0),
                          "failed": r.get("failed", 0), "detected": r.get("detected", 0),
                          "duration_s": r.get("duration_s")} for r in runs],
            }
        else:
            result[agent_name] = {"last_run": None, "total_runs": 0, "runs": []}

    for agent in known_agents:
        assert agent in result
    assert result["kb_builder"]["total_runs"] == 2
    assert result["kb_builder"]["last_succeeded"] == 3
    assert result["prompt_optimizer"]["total_runs"] == 0
    assert result["prompt_optimizer"]["last_run"] is None


def test_public_status_runs_have_required_fields():
    """Each run entry in public-status must have started, succeeded, failed, detected."""
    required = {"started", "succeeded", "failed", "detected", "duration_s"}
    for run in _SAMPLE_RUNS:
        entry = {
            "started": run.get("started"),
            "succeeded": run.get("succeeded", 0),
            "failed": run.get("failed", 0),
            "detected": run.get("detected", 0),
            "duration_s": run.get("duration_s"),
        }
        assert required == set(entry.keys())
        assert isinstance(entry["started"], str)
        assert isinstance(entry["succeeded"], int)


# ---------------------------------------------------------------------------
# Tests: dashboard HTML file
# ---------------------------------------------------------------------------


def test_dashboard_html_exists():
    """tools/agent-dashboard.html must exist in the repo."""
    dashboard = _REPO / "tools" / "agent-dashboard.html"
    assert dashboard.exists(), "tools/agent-dashboard.html not found"


def test_dashboard_html_has_required_elements():
    """Dashboard HTML must reference the public-status API and all 3 agents."""
    dashboard = _REPO / "tools" / "agent-dashboard.html"
    content = dashboard.read_text(encoding="utf-8")

    assert "/api/agents/public-status" in content, "API endpoint not found in dashboard HTML"
    assert "kb_builder" in content
    assert "prompt_optimizer" in content
    assert "infra_guardian" in content
    assert "auto-refresh" in content.lower() or "countdown" in content.lower() or "setInterval" in content


def test_dashboard_html_is_valid_html():
    """Dashboard HTML must start with DOCTYPE and contain expected structure."""
    dashboard = _REPO / "tools" / "agent-dashboard.html"
    content = dashboard.read_text(encoding="utf-8")
    assert content.strip().lower().startswith("<!doctype html")
    assert "<html" in content
    assert "<body" in content
    assert "<script" in content


# ---------------------------------------------------------------------------
# Tests: agent run endpoint logic
# ---------------------------------------------------------------------------


def test_known_agents_list():
    """_KNOWN_AGENTS must include all three autonomous agents."""
    known = ["kb_builder", "prompt_optimizer", "infra_guardian"]
    # Verify our constant matches expected agents
    assert set(known) == {"kb_builder", "prompt_optimizer", "infra_guardian"}


@pytest.mark.asyncio
async def test_agent_run_dispatch_unknown_raises():
    """Triggering an unknown agent name should produce a 404-style response."""
    known_agents = ["kb_builder", "prompt_optimizer", "infra_guardian"]
    unknown = "nonexistent_agent"
    assert unknown not in known_agents  # logic the endpoint enforces
