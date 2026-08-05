"""The prompt the model receives IS prompts/diagnose/active.yaml.

Regression for the 2026-08-04 decoy-prompt defect: rag_worker read active.yaml
only for version METADATA while sending the hardcoded GSD_SYSTEM_PROMPT to the
model — so prompt revisions v1.3 and v1.4 shipped, version-bumped, passed the
Prompt Version Guard, and never changed a single model reply.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import yaml  # noqa: E402
from shared.workers import rag_worker  # noqa: E402


def _fresh():
    rag_worker._yaml_system_prompt.cache_clear()


def test_live_prompt_is_the_yaml_system_prompt(monkeypatch):
    monkeypatch.delenv("MIRA_DIRECT_ANSWER_MODE", raising=False)
    _fresh()
    with open(rag_worker._PROMPT_PATH, encoding="utf-8") as f:
        expected = yaml.safe_load(f)["system_prompt"]
    assert rag_worker._active_system_prompt() == expected


def test_live_prompt_carries_w2b_policy(monkeypatch):
    monkeypatch.delenv("MIRA_DIRECT_ANSWER_MODE", raising=False)
    _fresh()
    live = rag_worker._active_system_prompt()
    assert "MID-DIAGNOSIS ONLY" in live
    assert "NEVER ask the technician what the reference documents say" in live
    assert "You never give direct answers" not in live


def test_missing_yaml_falls_back_to_constant(monkeypatch, tmp_path):
    monkeypatch.delenv("MIRA_DIRECT_ANSWER_MODE", raising=False)
    monkeypatch.setattr(rag_worker, "_PROMPT_PATH", Path(tmp_path / "nope.yaml"))
    _fresh()
    try:
        assert rag_worker._active_system_prompt() == rag_worker.GSD_SYSTEM_PROMPT
    finally:
        _fresh()


def test_kiosk_mode_still_wins(monkeypatch):
    monkeypatch.setenv("MIRA_DIRECT_ANSWER_MODE", "1")
    _fresh()
    assert rag_worker._active_system_prompt() == rag_worker.DIRECT_ANSWER_SYSTEM_PROMPT
