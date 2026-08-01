"""Cross-process single-flight for the production recall gate (blocker 2).

Telegram and Slack are separate containers sharing the recall volume. An in-process
lock cannot stop both from paying for the same identical request. These are REAL
subprocess tests (not threading): two independent Python processes, the same
PRINT_RECALL_DIR, a filesystem call ledger, and a fake interpreter that blocks long
enough to overlap. Zero real model calls.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

pytest.importorskip("pydantic")

_WORKER = Path(__file__).resolve().parent / "_recall_worker.py"


def _spawn(recall_dir, counter, out, page_bytes: bytes, intervals=None):
    args = [
        sys.executable,
        str(_WORKER),
        str(recall_dir),
        str(counter),
        str(out),
        page_bytes.hex(),
    ]
    if intervals is not None:
        args.append(str(intervals))
    return subprocess.Popen(args)


def test_two_processes_pay_once(tmp_path):
    d = tmp_path / "pr"
    counter = tmp_path / "count.bin"
    o1, o2 = tmp_path / "o1.json", tmp_path / "o2.json"
    p1 = _spawn(d, counter, o1, b"page-A")
    p2 = _spawn(d, counter, o2, b"page-A")  # identical input -> same recall key
    assert p1.wait(90) == 0
    assert p2.wait(90) == 0
    assert counter.read_bytes() == b"x"  # exactly ONE paid call across both processes
    assert o1.read_text("utf-8") == o2.read_text("utf-8")  # both got the same graph
    json.loads((d / "registry.json").read_text("utf-8"))  # snapshot remained valid


def test_two_processes_different_keys_run_concurrently(tmp_path):
    d = tmp_path / "pr"
    counter = tmp_path / "count.bin"
    iv = tmp_path / "intervals.txt"
    o1, o2 = tmp_path / "o1.json", tmp_path / "o2.json"
    p1 = _spawn(d, counter, o1, b"page-A", iv)
    p2 = _spawn(d, counter, o2, b"page-B", iv)  # different bytes -> different key
    assert p1.wait(90) == 0
    assert p2.wait(90) == 0
    assert counter.read_bytes() == b"xx"  # both paid — distinct keys are not coalesced
    rows = [
        tuple(float(x) for x in ln.split(","))
        for ln in iv.read_text("utf-8").splitlines()
        if ln.strip()
    ]
    assert len(rows) == 2
    (a0, a1), (b0, b1) = rows
    assert max(a0, b0) < min(a1, b1)  # the two paid intervals OVERLAP -> not globally serialized


def test_print_recall_does_not_wrap_the_registry_in_a_second_snapshot_lock():
    """The cross-process guard lives in `FileRegistry`, not in a wrapper here.

    `print_recall` used to subclass `FileRegistry` to re-hydrate under an OS lock on
    `<snapshot>.lock`, because the base class did not. The base class now does — on the
    same path. Keeping both would deadlock the print path outright: `flock` is
    per-open-file-description, so a process taking that lock twice waits on itself
    forever. One implementation, in the class that owns the snapshot.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from materialized_evidence.backends import FileRegistry

    from shared import print_recall

    assert print_recall._xproc_registry_cls() is FileRegistry, (
        "print_recall must use FileRegistry directly — a subclass that re-takes the "
        "snapshot lock deadlocks against the lock FileRegistry now holds itself"
    )
    assert not hasattr(print_recall, "_snapshot_lock"), (
        "the outer snapshot lock was removed on purpose; re-adding it deadlocks"
    )
