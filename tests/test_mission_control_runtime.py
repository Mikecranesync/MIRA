"""Mission control v2 (#4737): the evidence refresh step of the poll loop (Codex r1 F1)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

MC = Path(__file__).resolve().parents[1] / "tools" / "mission-control"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


runtime = _load("mission_control_runtime", MC / "runtime.py")


class Handler:
    evidence = {
        "rows": [{"number": 12, "cells": {}}],
        "envs": {},
        "at": "2026-11-12T22:00:00Z",
        "error": None,
    }


def test_a_failed_refresh_marks_the_kept_evidence_as_errored_not_current():
    class Ev:
        def gather(self, *a, **k):
            raise RuntimeError("compare 502")

    h = Handler()
    runtime.refresh_evidence(
        h, Ev(), post=None, get=None, cands=[12], envs={}, trusted=(), by_item={}, main_sha=None
    )
    assert h.evidence["rows"][0]["number"] == 12  # last good rows are kept for display
    assert h.evidence["at"] == "2026-11-12T22:00:00Z"  # but not re-dated
    assert "compare 502" in h.evidence["error"]


def test_a_good_refresh_replaces_evidence_and_clears_the_error():
    class Ev:
        def gather(self, *a, **k):
            return {"rows": [], "envs": {}, "at": "2026-11-12T23:00:00Z", "error": None}

    h = Handler()
    h.evidence = dict(h.evidence, error="old")
    runtime.refresh_evidence(h, Ev(), None, None, [], {}, (), {}, None)
    assert h.evidence["error"] is None and h.evidence["at"] == "2026-11-12T23:00:00Z"
