"""Durable JSON-snapshot registry (PR G) — first concrete MaterializationRegistry backend.

Reuses the tested ``InMemoryRegistry`` query logic verbatim (find / get /
effective_stale_state / downstream_of / lineage / cost_summary) and adds exactly
two things: durability, and safety against concurrent writers.

**Durability.** It hydrates from a JSON snapshot on construction and atomically
rewrites the snapshot after every successful write (``register`` / ``mark_stale``),
so recall survives a process exit — the whole reason for wiring recall into a CLI.
Atomic tmp+fsync+replace mirrors ``printsense/cas.py``'s write idiom.

**Concurrency.** The snapshot is rewritten *whole*, which makes every write a
load-modify-replace of one shared file — the classic lost-update shape. Atomic
replace prevents a *torn* file; it does nothing about a *lost* one. Two ingest
processes could each read the same snapshot, each add their own manifests, and each
write the whole thing back: both report success, and the last writer erases the
other's receipts. Silently, since neither ever sees an error.

So each write runs as a transaction under an **exclusive interprocess lock**
(``flock`` on a sidecar ``.lock`` file), and — the part that actually fixes it —
**re-hydrates from disk inside the lock, before mutating**. Locking alone would
still lose updates: this object's in-memory state is a snapshot from construction
time, so without a reload the process writes back a view of the world that predates
every write another process committed since. Re-reading inside the lock also makes
ADR-A3's immutability check and ``mark_stale``'s per-trigger idempotence evaluate
against what is really on disk rather than a stale local copy.

Reads (``find`` / ``get`` / ``lineage`` / …) are served from memory as of
construction or the last write, and are NOT locked — a reader may miss a concurrent
writer's newest rows. That is a staleness bound, not a correctness bug (recall is an
optimization; a miss recomputes). Call ``refresh()`` for a read that must see other
processes' latest writes.

The lock is kernel-backed on every platform (``fcntl.flock`` on POSIX, an
``msvcrt`` byte-range lock on Windows) and is released automatically if the holder
crashes, so there is no stale lock file to reap. The platform branch is lifted from
``mira-bots/shared/print_recall.py``, which built the same guard *around*
``FileRegistry`` because the class did not provide it; that wrapper is now deleted
in favor of this one — a single implementation instead of two, and no risk of the
two nesting (``flock`` is per-open-file-description, so a process taking the same
lock twice would block on itself forever).

The concurrent-safe *shared* backend is still Neon (a later PR); this makes the file
backend safe for the concurrent processes that actually exist today — the KB-growth
cron's pipeline subprocesses, which inherit one ``MIRA_EVIDENCE_REGISTRY``, and the
Telegram/Slack containers sharing one print-recall snapshot.

Nothing here logs payload bytes.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from ..registry import InMemoryRegistry, StatusOverlay
from ..schema import EvidenceManifest
from .serialization import manifest_from_dict, overlay_from_dict, overlay_to_dict


def _lock_fd(fd: int) -> None:
    # sys.platform branching (not try/except) so a static type checker narrows to the
    # right stdlib module per platform — fcntl on POSIX, msvcrt on Windows — and never
    # flags the other's symbols.
    if sys.platform == "win32":  # pragma: no cover - platform-dependent
        import msvcrt
        import time as _t

        while True:  # LK_NBLCK + poll == a blocking acquire (LK_LOCK gives up after ~10s)
            try:
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                return
            except OSError:
                _t.sleep(0.02)
    else:
        import fcntl

        fcntl.flock(fd, fcntl.LOCK_EX)


def _unlock_fd(fd: int) -> None:
    if sys.platform == "win32":  # pragma: no cover - platform-dependent
        import msvcrt

        with contextlib.suppress(OSError):
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        with contextlib.suppress(OSError):
            fcntl.flock(fd, fcntl.LOCK_UN)


class FileRegistry(InMemoryRegistry):
    """An ``InMemoryRegistry`` that persists to / hydrates from a JSON snapshot,
    with interprocess-safe writes."""

    def __init__(self, snapshot_path: str | Path) -> None:
        super().__init__()
        self._snapshot_path = Path(snapshot_path)
        self._lock_path = self._snapshot_path.with_suffix(self._snapshot_path.suffix + ".lock")
        self._load()

    # -- persistence -----------------------------------------------------------

    def _load(self) -> None:
        """Hydrate in-memory state from the snapshot (additive; disk wins).

        Additive rather than replace-all is correct *because* every write persists
        under the lock: after any successful write, memory is a subset of disk, so
        there is never unpersisted local state for a reload to drop.
        """
        if not self._snapshot_path.exists():
            return
        # A malformed snapshot RAISES rather than starting empty: callers quarantine
        # it (`print_recall._open_registry_fresh`) so corruption is logged and moved
        # aside. Swallowing it here would silently overwrite the bad file on the next
        # persist and lose the evidence that anything went wrong.
        data = json.loads(self._snapshot_path.read_text("utf-8"))
        for md in data.get("manifests", []):
            m = manifest_from_dict(md)
            self._manifests[m.dataset_version_id] = m
        for dvid, overlays in data.get("overlays", {}).items():
            self._overlays[dvid] = [overlay_from_dict(o) for o in overlays]

    def refresh(self) -> None:
        """Re-read the snapshot so subsequent reads see other processes' writes."""
        self._load()

    @contextmanager
    def _transaction(self) -> Generator[None, None, None]:
        """Exclusive interprocess lock + a reload of disk state before mutating.

        The reload is the load-bearing half. Holding the lock only serializes the
        writes; without re-reading, a process still writes back its construction-time
        view and erases everything committed in between.
        """
        self._lock_path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(self._lock_path), os.O_RDWR | os.O_CREAT, 0o644)
        try:
            if os.fstat(fd).st_size == 0:
                os.write(fd, b"\0")  # msvcrt byte-range locking needs a byte present
            _lock_fd(fd)
            try:
                self._load()  # merge in everything committed since we last looked
                yield
            finally:
                _unlock_fd(fd)
        finally:
            os.close(fd)

    def _persist(self) -> None:
        data = {
            "manifests": [m.to_dict() for m in self._manifests.values()],
            "overlays": {
                dvid: [overlay_to_dict(o) for o in ovs] for dvid, ovs in self._overlays.items()
            },
        }
        self._snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._snapshot_path.with_suffix(self._snapshot_path.suffix + ".tmp")
        payload = json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")
        with open(tmp, "wb") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())  # durable before the atomic replace (survive a crash between the two)
        os.replace(tmp, self._snapshot_path)

    # -- writes (locked read-modify-write; persist only after the mutation succeeds) --

    def register(self, manifest: EvidenceManifest) -> None:
        with self._transaction():
            super().register(manifest)  # validates + enforces immutability; may raise
            self._persist()

    def mark_stale(
        self,
        dataset_version_id: str,
        reasons: list[str],
        *,
        tenant_id: str,
        at: str | None = None,
        trigger: str | None = None,
        origin_dataset_version_id: str | None = None,
        via_parent: str | None = None,
        propagation: str = "direct",
    ) -> StatusOverlay:
        with self._transaction():
            overlay = super().mark_stale(
                dataset_version_id,
                reasons,
                tenant_id=tenant_id,
                at=at,
                trigger=trigger,
                origin_dataset_version_id=origin_dataset_version_id,
                via_parent=via_parent,
                propagation=propagation,
            )
            self._persist()
            return overlay
