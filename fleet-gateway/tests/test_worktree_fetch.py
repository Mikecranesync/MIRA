"""Fetch-if-missing regression tests for WorktreeProvisioner (#3566).

#3566: launch_worker failed with a generic "failed to create isolated worktree"
because the node's local repo had never fetched the base_commit (a fresh origin
tip) — `git worktree add … <commit>` hit `fatal: bad object` before any Claude/
Codex worker started. create() now fetches the commit if it's missing.

Hermetic: a stateful fake subprocess.run simulates the node's git over SSH, so the
REAL provisioner code (cat-file probe, fetch fallback, worktree add) is exercised
without a real host or network. Uses the SSH provisioner so every filesystem op
goes through _run (and thus the fake), never the local disk.
"""

from __future__ import annotations

import shlex
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from fleet_gateway.errors import ContractViolation
from fleet_gateway.worktree import WorktreeProvisioner

REPO = "/Users/charlienode/MIRA"
PARENT = "/Users/charlienode/MIRA-worktrees"


class _P:
    def __init__(self, rc: int = 0, out: str = "", err: str = "") -> None:
        self.returncode = rc
        self.stdout = out
        self.stderr = err


def _fake(existing: set[str], state: dict, seen: list[list[str]], *, fetchable: bool = True):
    """Simulate a remote git repo. `state['present']` flips True once a fetch runs
    (when fetchable). Records every dispatched command in `seen`."""

    def run(argv: list[str], **_kw: Any) -> _P:
        seen.append(list(argv))
        toks = shlex.split(argv[-1]) if argv and argv[0] == "ssh" else list(argv)
        if toks[:1] == ["git"]:
            sub = toks[3] if len(toks) > 3 else ""
            if sub == "cat-file":
                return _P(0 if state["present"] else 1)
            if sub == "fetch":
                if fetchable:
                    state["present"] = True
                    return _P(0)
                return _P(1, err="fatal: could not fetch")
            if sub == "worktree":
                path = toks[toks.index("--detach") + 1]
                existing.add(path)
                return _P(0)
        if toks[:1] == ["test"] and len(toks) >= 3 and toks[1] == "-d":
            return _P(0 if toks[2] in existing else 1)
        if toks[:1] == ["mkdir"]:
            existing.add(toks[-1])
            return _P(0)
        return _P(0)

    return run


def _prov() -> WorktreeProvisioner:
    return WorktreeProvisioner(repo=Path(REPO), parent=Path(PARENT), ssh_host="charlie")


def _fetches(seen: list[list[str]]) -> list[list[str]]:
    return [c for c in seen if c and c[0] == "ssh" and " fetch " in f" {c[-1]} "]


def test_create_fetches_a_missing_commit() -> None:
    existing, state, seen = {REPO}, {"present": False}, []
    with patch("fleet_gateway.worktree.subprocess.run", _fake(existing, state, seen)):
        path = _prov().create(task_id="t", session_id="s", base_commit="deadbeef")
    assert str(path).startswith(PARENT + "/")
    assert _fetches(seen), f"expected a git fetch when the commit was missing: {seen}"


def test_create_skips_fetch_when_commit_present() -> None:
    existing, state, seen = {REPO}, {"present": True}, []
    with patch("fleet_gateway.worktree.subprocess.run", _fake(existing, state, seen)):
        _prov().create(task_id="t", session_id="s", base_commit="cafef00d")
    assert not _fetches(seen), f"must not fetch when the commit is already present: {seen}"


def test_create_raises_clear_error_when_commit_unfetchable() -> None:
    existing, state, seen = {REPO}, {"present": False}, []
    with patch(
        "fleet_gateway.worktree.subprocess.run", _fake(existing, state, seen, fetchable=False)
    ):
        with pytest.raises(ContractViolation) as exc:
            _prov().create(task_id="t", session_id="s", base_commit="badc0ffee")
    msg = str(exc.value).lower()
    assert "not found" in msg and "badc0ffee" in msg
    # It must have TRIED to fetch (specific SHA then full origin) before giving up.
    assert len(_fetches(seen)) >= 2, f"expected specific + fallback fetch attempts: {seen}"
