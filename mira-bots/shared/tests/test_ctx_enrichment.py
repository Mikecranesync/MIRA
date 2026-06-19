"""Tests for ctx_enrichment helpers — offline, no DB required."""
from __future__ import annotations

import sys
from pathlib import Path

# Add mira-bots to path so `shared` resolves without pip install
_MIRA_BOTS = Path(__file__).resolve().parent.parent.parent  # mira-bots/
if str(_MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(_MIRA_BOTS))

import os

import pytest

from shared.ctx_enrichment import fetch_ctx_approved_signals


class TestFetchCtxApprovedSignalsOffline:
    def test_returns_empty_when_db_url_unset(self, monkeypatch):
        monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
        result = fetch_ctx_approved_signals("fake-tenant", "enterprise.site")
        assert result == []

    def test_returns_empty_on_bad_url(self, monkeypatch):
        monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://invalid:5432/bad")
        result = fetch_ctx_approved_signals("fake-tenant", "enterprise.site")
        assert result == []


# Duplicate the formatting logic from Supervisor._format_ctx_signals so this
# test stays offline (no engine import needed) — same pattern as route.test.ts.
def _format_ctx_signals(signals: list[dict]) -> str:
    if not signals:
        return ""
    lines = ["\n--- APPROVED PLC SIGNALS ---"]
    for s in signals:
        roles = s.get("roles") or []
        roles_str = ", ".join(roles) if roles else "unknown"
        conf = s.get("confidence")
        try:
            conf_str = f" ({float(conf):.0%})" if conf is not None else ""
        except (TypeError, ValueError):
            conf_str = ""
        lines.append(f"  {s['name']}: {s['uns_path']} [{roles_str}]{conf_str}")
    lines.append("---\n")
    return "\n".join(lines)


class TestFormatCtxSignals:
    def test_empty_list_returns_empty_string(self):
        assert _format_ctx_signals([]) == ""

    def test_single_signal_produces_labeled_block(self):
        result = _format_ctx_signals(
            [{"name": "Conv_Run", "uns_path": "enterprise/site1/area1/run", "roles": ["output"], "confidence": "0.9"}]
        )
        assert "APPROVED PLC SIGNALS" in result
        assert "Conv_Run" in result
        assert "enterprise/site1/area1/run" in result
        assert "output" in result
        assert "90%" in result

    def test_no_roles_renders_unknown(self):
        result = _format_ctx_signals(
            [{"name": "X", "uns_path": "e/s/x", "roles": [], "confidence": None}]
        )
        assert "unknown" in result
        assert "%" not in result

    def test_block_starts_and_ends_with_delimiters(self):
        result = _format_ctx_signals(
            [{"name": "Y", "uns_path": "e/s/y", "roles": ["input"], "confidence": "0.5"}]
        )
        assert result.startswith("\n--- APPROVED PLC SIGNALS ---")
        assert result.rstrip().endswith("---")
