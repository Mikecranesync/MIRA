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


class _Snap:
    items, at, error = [], None, None

    def get(self):
        return self


class Handler:
    snapshot = _Snap()
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


# --- Codex round 2 (PR #5455) F1: the board is a candidate source with its own freshness ----

import datetime as dt  # noqa: E402

NOW = dt.datetime(2026, 11, 12, 23, 0, tzinfo=dt.timezone.utc)


class Snap:
    def __init__(self, items=(), at=None, error=None):
        self.items, self.at, self.error = list(items), at, error

    def get(self):
        return self


class H:
    def __init__(self, snap):
        self.snapshot = snap
        self.evidence = {"rows": [], "envs": {}, "at": None, "error": None}


class NoReports:
    def reports(self):
        return []


CARD = {"kind": "PR", "state": "OPEN", "status": "In progress", "number": 13}


def test_candidates_refuse_a_board_that_never_loaded_failed_or_expired():
    fresh = Snap([CARD], at=NOW - dt.timedelta(minutes=5))
    assert runtime.candidates(H(fresh), NoReports(), now=NOW, max_age=600) == [13]  # control
    for snap, why in (
        (Snap([], at=None), "never loaded"),
        (
            Snap([CARD], at=NOW - dt.timedelta(minutes=5), error="Refresh failed (x)"),
            "Refresh failed",
        ),
        (Snap([CARD], at=NOW - dt.timedelta(minutes=20)), "old"),
    ):
        try:
            runtime.candidates(H(snap), NoReports(), now=NOW, max_age=600)
        except RuntimeError as exc:
            assert "board" in str(exc) and why in str(exc)
        else:
            raise AssertionError(f"board {why} was accepted as a candidate source")


def test_a_good_refresh_stamps_the_board_time_it_was_built_from():
    class Ev:
        def gather(self, *a, **k):
            return {"rows": [], "envs": {}, "at": "2026-11-12T23:00:00Z", "error": None}

    h = H(Snap([CARD], at=NOW - dt.timedelta(minutes=5)))
    runtime.refresh_evidence(h, Ev(), None, None, [13], {}, (), {}, None)
    assert h.evidence["board_at"] == "2026-11-12T22:55:00Z"


# --- Codex round 3 (PR #5455) F11/F12 ------------------------------------------------------

import tempfile  # noqa: E402

store_mod = _load("mission_control_store_rt", MC / "store.py")
poll_mod = _load("mission_control_poll_rt", MC / "poll.py")

EVENTS_URL = f"https://api.github.com/repos/{runtime.REPO}/events?per_page=100"
COMMENTS_URL = (
    f"https://api.github.com/repos/{runtime.REPO}/issues/{runtime.COORD_ISSUE}/comments"
    "?per_page=100&page=1"
)
MAIN_URL = f"https://api.github.com/repos/{runtime.REPO}/commits/main"


class GoodEv:
    def gather(self, *a, **k):
        return {"rows": [{"number": 13, "cells": {}}], "envs": {}, "at": "x", "error": None}


def _handler(answers):
    class Hd:
        snapshot = Snap([CARD], at=dt.datetime.now(dt.timezone.utc))
        store = store_mod.Store(Path(tempfile.mkdtemp()) / "mc.sqlite")
        evidence = {"rows": [], "envs": {}, "at": None, "error": None}
        last_poll = None
        poll_mod, evidence_mod = poll_mod, GoodEv()
        trusted_authors = staticmethod(lambda: ("owner",))

    def get(url, headers=None):
        return answers.get(url, (404, {}, {}))

    return Hd, get


def test_a_failed_report_poll_marks_evidence_errored_every_iteration():  # F11
    answers = {
        EVENTS_URL: (200, {}, []),
        COMMENTS_URL: (502, {}, "bad gateway"),
        MAIN_URL: (200, {}, {"sha": "m" * 40}),
    }
    h, get = _handler(answers)
    for _ in range(2):
        runtime.poll_once(h, get, post=None, state={})
        assert "report" in h.evidence["error"] and "502" in h.evidence["error"]
        assert h.evidence["rows"] == []  # nothing fresh was published over the failed read
    answers[COMMENTS_URL] = (200, {}, [])  # control: a complete read clears it
    runtime.poll_once(h, get, post=None, state={})
    assert h.evidence["error"] is None and h.evidence["rows"][0]["number"] == 13


def test_candidates_are_never_silently_capped():  # F12
    class Reports:
        def reports(self):
            return [{"trusted": 1, "parsed": {"items": list(range(100, 126))}}]

    out = runtime.candidates(H(Snap([], at=NOW)), Reports(), now=NOW, max_age=600)
    assert len(out) == 26 and 125 in out
