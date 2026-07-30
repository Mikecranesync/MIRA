"""Durable JSON-snapshot registry (PR G).

The whole point of PR G is cross-run recall: the hermetic ``InMemoryRegistry``
dies with the process, so a durable backend must persist on write and hydrate on
construction. A "fresh" ``FileRegistry`` over the same snapshot models exactly
what the next process does.
"""

from __future__ import annotations

import multiprocessing as mp
import os
import sys
from pathlib import Path

import pytest

from materialized_evidence import (
    DatasetType,
    Environment,
    EvidenceManifest,
    EvidenceRecord,
    RecallOutcome,
    RecallQuery,
    StaleState,
    resolve_recall,
    with_hashes,
)
from materialized_evidence.backends import FileRegistry
from materialized_evidence.registry import RegistryError


def _manifest(
    dvid: str, *, tenant: str = "t1", sources: tuple[str, ...] = ("sha_a",)
) -> EvidenceManifest:
    rec = EvidenceRecord(
        record_id=f"rec:{dvid}", dataset_id="ds", source_locator="p", payload={"dvid": dvid}
    )
    m = EvidenceManifest(
        dataset_id="ds",
        dataset_version_id=dvid,
        dataset_type=DatasetType.OCR,
        schema_name="S",
        schema_version="1",
        tenant_id=tenant,
        environment=Environment.DEV,
        source_hashes=list(sources),
    )
    return with_hashes(m, [rec])


def test_register_survives_a_fresh_instance(tmp_path):
    snap = tmp_path / "reg.json"
    m = _manifest("ds@1")
    FileRegistry(snap).register(m)
    fresh = FileRegistry(snap)  # a new process would do exactly this
    assert fresh.get("ds@1", tenant_id="t1") == m
    assert fresh.find(tenant_id="t1", dataset_type=DatasetType.OCR) == [m]


def test_mark_stale_persists(tmp_path):
    snap = tmp_path / "reg.json"
    r1 = FileRegistry(snap)
    r1.register(_manifest("ds@1"))
    r1.mark_stale("ds@1", ["upstream changed"], tenant_id="t1", trigger="x")
    assert FileRegistry(snap).effective_stale_state("ds@1", tenant_id="t1") == StaleState.STALE


def test_resolve_recall_reuses_across_instances(tmp_path):
    snap = tmp_path / "reg.json"
    FileRegistry(snap).register(_manifest("ds@1", sources=("sha_a",)))
    # a fresh registry (i.e. a fresh process) still recalls it EXACT
    q = RecallQuery(
        tenant_id="t1",
        dataset_type=DatasetType.OCR,
        source_hashes=["sha_a"],
        required_schema=("S", "1"),
        environment=Environment.DEV,
    )
    res = resolve_recall(q, FileRegistry(snap))
    assert res.outcome == RecallOutcome.EXACT
    assert res.selected_versions == ["ds@1"]


def test_absent_snapshot_is_an_empty_registry(tmp_path):
    r = FileRegistry(tmp_path / "does_not_exist.json")
    assert r.find(tenant_id="t1") == []


def test_tenant_isolation_survives_persistence(tmp_path):
    snap = tmp_path / "reg.json"
    r = FileRegistry(snap)
    r.register(_manifest("ds@1", tenant="t1"))
    assert FileRegistry(snap).get("ds@1", tenant_id="t2") is None


def test_immutable_version_conflict_still_enforced(tmp_path):
    snap = tmp_path / "reg.json"
    r = FileRegistry(snap)
    r.register(_manifest("ds@1", sources=("sha_a",)))
    with pytest.raises(RegistryError):
        # same dataset_version_id, different content -> different manifest_hash
        r.register(_manifest("ds@1", sources=("sha_DIFFERENT",)))


# ── concurrent writers ───────────────────────────────────────────────────────
# The snapshot is rewritten whole, so every write is a load-modify-replace of one
# shared file. Atomic replace prevents a TORN file and does nothing about a LOST
# one: two processes that each hydrate, each add a manifest, and each write the
# whole thing back both report success while the last writer erases the other's
# rows. These tests run REAL processes — threads would share the interpreter and
# could pass against the broken code.

_WORKERS = 6


def _register_worker(repo_root: str, snapshot: str, index: int, barrier) -> None:
    """Child process: hydrate, wait at the barrier, then register one manifest.

    Hydrating BEFORE the barrier is the point — it gives every process the same
    construction-time view of the snapshot, which is exactly the state a
    lock-without-reload would write back over everyone else's commits.
    """
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)
    from materialized_evidence.backends import FileRegistry as FR

    registry = FR(snapshot)
    barrier.wait()
    registry.register(_manifest(f"ds@{index}"))


def _run_workers(snapshot: Path) -> None:
    repo_root = str(Path(__file__).resolve().parents[2])
    ctx = mp.get_context("spawn")  # macOS default; also the strictest (picklable target)
    barrier = ctx.Barrier(_WORKERS)
    procs = [
        ctx.Process(target=_register_worker, args=(repo_root, str(snapshot), i, barrier))
        for i in range(_WORKERS)
    ]
    for p in procs:
        p.start()
    for p in procs:
        p.join(timeout=60)
    for i, p in enumerate(procs):
        assert p.exitcode == 0, f"worker {i} exited {p.exitcode}"


def test_concurrent_writers_do_not_lose_receipts(tmp_path):
    """Every concurrently-written manifest survives — none is silently erased.

    Verified non-vacuous: with the reload-inside-the-lock removed from
    ``FileRegistry._transaction``, this fails (typically 1-2 of 6 survive).
    """
    snap = tmp_path / "reg.json"
    _run_workers(snap)

    fresh = FileRegistry(snap)
    survived = {m.dataset_version_id for m in fresh.find(tenant_id="t1")}
    assert survived == {f"ds@{i}" for i in range(_WORKERS)}, (
        f"lost {sorted({f'ds@{i}' for i in range(_WORKERS)} - survived)}"
    )


def test_concurrent_writers_leave_a_readable_snapshot(tmp_path):
    """Contention must not leave a half-written or non-JSON snapshot behind."""
    import json

    snap = tmp_path / "reg.json"
    _run_workers(snap)

    data = json.loads(snap.read_text("utf-8"))  # raises if torn
    assert len(data["manifests"]) == _WORKERS
    assert not list(tmp_path.glob("*.tmp"))  # no stray temp file left over


def test_refresh_picks_up_another_processs_writes(tmp_path):
    """A long-lived reader can opt into seeing concurrent commits."""
    snap = tmp_path / "reg.json"
    reader = FileRegistry(snap)
    assert reader.find(tenant_id="t1") == []

    FileRegistry(snap).register(_manifest("ds@later"))  # a second "process"
    assert reader.get("ds@later", tenant_id="t1") is None  # reads are not locked

    reader.refresh()
    assert reader.get("ds@later", tenant_id="t1") is not None


def _nested_lock_worker(repo_root: str, snapshot: str) -> None:
    """Take an external lock on `<snapshot>.lock`, then call register (which takes it
    again). Runs in a child so a deadlock is a join-timeout, not a hung test run."""
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)
    import fcntl

    from materialized_evidence.backends import FileRegistry as FR

    registry = FR(snapshot)
    fd = os.open(snapshot + ".lock", os.O_RDWR | os.O_CREAT, 0o644)
    fcntl.flock(fd, fcntl.LOCK_EX)
    registry.register(_manifest("ds@nested"))


def test_the_registry_owns_the_snapshot_lock_callers_must_not_take_it(tmp_path):
    """`FileRegistry` locks `<snapshot>.lock` itself — a caller must not wrap it.

    `mira-bots/shared/print_recall.py` used to, because the class didn't. Nesting the
    two now blocks forever (`flock` is per-open-file-description, so a process taking
    the same lock twice waits on itself), which is why that wrapper was deleted rather
    than kept alongside. This test pins the hazard so it is not reintroduced.
    """
    snap = tmp_path / "reg.json"
    FileRegistry(snap).register(_manifest("ds@1"))
    assert (tmp_path / "reg.json.lock").exists(), "the registry must own this lock path"

    ctx = mp.get_context("spawn")
    p = ctx.Process(
        target=_nested_lock_worker,
        args=(str(Path(__file__).resolve().parents[2]), str(snap)),
    )
    p.start()
    p.join(timeout=5)
    deadlocked = p.is_alive()
    if deadlocked:
        p.terminate()
        p.join(timeout=5)
    assert deadlocked, (
        "expected an externally-held snapshot lock to deadlock register(); if this "
        "stops being true the lock is no longer doing its job"
    )
