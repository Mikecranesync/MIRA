"""Production recall gate for the paid PrintSense interpretation.

Wraps ``printsense.interpret.interpret_print`` (the one paid frontier-vision call,
~$0.36/turn) at the engine seam ``_interpret_print_anthropic_pages`` so an identical
print turn is interpreted ONCE and recalled thereafter with **no model call**. This
is the bot-runtime glue over the pure ``printsense.recall`` bridge (PR G): it owns
enablement, the durable store paths, per-key single-flight, cross-process snapshot
safety, corruption tolerance, and structured logging.

Behavior-preserving: the recall key folds the technician question + package context
(the inputs that shape the paid graph) via ``producer_extra``, so a recalled graph is
byte-for-byte what a fresh interpretation would have produced. An identical repeat turn
recalls; a changed question / context / print recomputes.

Fall-through: the gate is an optimization, never a new failure mode. A missing recall
package, an unreadable store, a corrupt snapshot, or a lookup error all degrade to a
plain paid interpretation. Only the paid interpreter's OWN failure propagates (exactly
as today) — and never a second model call. See ``.claude/rules/fast-path-optimization.md``.
"""

from __future__ import annotations

import contextlib
import logging
import os
import threading
from pathlib import Path

logger = logging.getLogger("mira.print_recall")

# One configurable identity for stored artifacts (spec: defined once, not scattered).
TENANT = os.getenv("PRINT_RECALL_TENANT", "printsense")

_ENABLED_ENV = "PRINT_RECALL_ENABLED"
_DIR_ENV = "PRINT_RECALL_DIR"
_ENV_ENV = "PRINT_RECALL_ENV"
_TRUTHY = {"1", "true", "yes", "on"}


# ── enablement ──────────────────────────────────────────────────────────────────

_imports_ok_cache: bool | None = None
_unavailable_warned = False


def _flag_on() -> bool:
    return os.getenv(_ENABLED_ENV, "").strip().lower() in _TRUTHY


def _warn_unavailable_once(reason: str) -> None:
    """Emit PRINT_RECALL_UNAVAILABLE at most once per process (never per-request)."""
    global _unavailable_warned
    if not _unavailable_warned:
        _unavailable_warned = True
        logger.warning("PRINT_RECALL_UNAVAILABLE reason=%s", reason)


def _imports_ok() -> bool:
    """True when the recall layer is importable (the image shipped materialized_evidence
    + printsense.recall). Cached; warns once on the first ImportError."""
    global _imports_ok_cache
    if _imports_ok_cache is None:
        try:
            import materialized_evidence  # noqa: F401,PLC0415
            import printsense.recall  # noqa: F401,PLC0415
        except Exception:  # noqa: BLE001 — any import failure disables recall cleanly
            _imports_ok_cache = False
            _warn_unavailable_once("import_error")
        else:
            _imports_ok_cache = True
    return _imports_ok_cache


def enabled() -> bool:
    """True when PRINT_RECALL_ENABLED is set AND the recall package is importable. The
    engine checks this before every print interpretation; default OFF."""
    return _flag_on() and _imports_ok()


# ── store location / identity ───────────────────────────────────────────────────


def _recall_dir() -> Path:
    """Durable store dir: ``PRINT_RECALL_DIR`` override, else
    ``<dir(MIRA_DB_PATH)>/print_recall`` — the mounted /mira-db volume, so recall
    survives redeploys."""
    override = os.getenv(_DIR_ENV)
    if override:
        return Path(override)
    db = os.getenv("MIRA_DB_PATH", "/data/mira.db")
    return Path(db).parent / "print_recall"


def _env():
    """Truthful deployment environment for stored manifests — never hardcode DEV in prod."""
    from materialized_evidence import Environment  # noqa: PLC0415

    val = os.getenv(_ENV_ENV, "dev").strip().lower()
    try:
        return Environment(val)
    except ValueError:
        return Environment.DEV


_cas_singleton = None


def _get_cas():
    """Process-singleton CAS (content-addressed + atomic writes -> inherently
    cross-process safe). Re-created only when the resolved root changes (tests)."""
    global _cas_singleton
    from printsense.cas import CAS  # noqa: PLC0415

    root = _recall_dir() / "cas"
    if _cas_singleton is None or str(getattr(_cas_singleton, "root", "")) != str(root):
        _cas_singleton = CAS(root)
    return _cas_singleton


# ── cross-process-safe registry ─────────────────────────────────────────────────

# Windows dev has no fcntl and is single-process there, so an in-process lock is a
# correct fallback. In the Linux container fcntl.flock gives true cross-process
# advisory locking, so telegram + slack (separate containers, shared /mira-db) never
# clobber each other's snapshot.
_WIN_SNAPSHOT_LOCK = threading.Lock()


@contextlib.contextmanager
def _snapshot_lock(snapshot_path: Path):
    lock_path = str(snapshot_path) + ".lock"
    Path(lock_path).parent.mkdir(parents=True, exist_ok=True)
    try:
        import fcntl  # noqa: PLC0415
    except ImportError:
        _WIN_SNAPSHOT_LOCK.acquire()
        try:
            yield
        finally:
            _WIN_SNAPSHOT_LOCK.release()
        return
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        with contextlib.suppress(Exception):
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


_xproc_cls = None


def _xproc_registry_cls():
    """A FileRegistry subclass whose ``register`` re-hydrates from disk under the OS
    file lock before persisting, so a concurrent writer's committed entries are never
    clobbered by the whole-snapshot rewrite. Cached (defined once)."""
    global _xproc_cls
    if _xproc_cls is None:
        from materialized_evidence.backends import FileRegistry  # noqa: PLC0415

        class _XProcFileRegistry(FileRegistry):
            def register(self, manifest):
                with _snapshot_lock(self._snapshot_path):
                    self._manifests.clear()
                    self._overlays.clear()
                    self._load()  # capture entries other processes committed since construction
                    super().register(manifest)  # InMemoryRegistry.register + atomic fsync persist

        _xproc_cls = _XProcFileRegistry
    return _xproc_cls


def _quarantine(path: Path) -> None:
    """Move a malformed snapshot aside (never clobber a prior quarantine) so recall
    starts clean instead of breaking every print reply."""
    try:
        i = 0
        bad = path.with_suffix(path.suffix + ".corrupt")
        while bad.exists():
            i += 1
            bad = path.with_suffix(path.suffix + f".corrupt{i}")
        os.replace(path, bad)
        logger.warning("PRINT_RECALL_CORRUPT_REGISTRY quarantined=%s", bad.name)
    except Exception:  # noqa: BLE001 — quarantine is best-effort; recall still degrades to a miss
        logger.warning("PRINT_RECALL_CORRUPT_REGISTRY quarantine_failed", exc_info=True)


def _open_registry_fresh():
    """A freshly-hydrated cross-process-safe registry (the snapshot file is the source
    of truth, so every op reads current state). Tolerates a corrupt snapshot by
    quarantining it and starting empty."""
    cls = _xproc_registry_cls()
    path = _recall_dir() / "registry.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        return cls(path)
    except Exception:  # noqa: BLE001 — malformed snapshot: quarantine + start empty
        _quarantine(path)
        return cls(path)


# ── the gate ────────────────────────────────────────────────────────────────────


class _KeyedLocks:
    """Per-key locks with refcounted cleanup, so concurrent identical requests make
    exactly one paid call while distinct keys never serialize behind each other."""

    def __init__(self) -> None:
        self._locks: dict[str, list] = {}
        self._meta = threading.Lock()

    @contextlib.contextmanager
    def acquire(self, key: str):
        with self._meta:
            entry = self._locks.get(key)
            if entry is None:
                entry = [threading.Lock(), 0]
                self._locks[key] = entry
            entry[1] += 1
        entry[0].acquire()
        try:
            yield
        finally:
            entry[0].release()
            with self._meta:
                entry[1] -= 1
                if entry[1] == 0:
                    self._locks.pop(key, None)


_KEYED = _KeyedLocks()


def _recall_key(page_hashes, model, preprocess, producer_extra) -> str:
    from printsense.cas import sha256_bytes  # noqa: PLC0415

    material = "|".join(
        [*page_hashes, str(model), str(int(bool(preprocess))), producer_extra or ""]
    )
    return sha256_bytes(material.encode("utf-8"))


def _log_hit(info, key, page_count) -> None:
    logger.info(
        "PRINT_RECALL_HIT key=%s page_count=%d avoided_compute_ms=%s dvid=%s",
        key[:12],
        page_count,
        info.avoided_compute_ms,
        info.dataset_version_id,
    )


def interpret_with_recall(*, pages, question, package_context, model, preprocess, interpret_fn):
    """Recall-gated production interpretation. Returns the graph (fresh or recalled).

    Two-phase single-flight: a lockless first lookup, then — on a miss — a per-key lock,
    a double-check lookup, and exactly one paid compute + materialize. Any recall error
    falls through to a plain paid interpretation (the interpreter's OWN failure
    propagates, but never a second model call). Callers gate on ``enabled()`` first.
    """
    from printsense.cas import sha256_bytes  # noqa: PLC0415
    from printsense.recall import (  # noqa: PLC0415
        canonical_json,
        interpret_print_with_recall,
        lookup_recall,
    )

    producer_extra = canonical_json({"question": question, "package_context": package_context})
    page_hashes = sorted(sha256_bytes(data) for data, _mt in pages)
    key = _recall_key(page_hashes, model, preprocess, producer_extra)
    cas = _get_cas()
    env = _env()

    def _bound(pgs, *, question, model, preprocess):
        # Reuse the exact production paid call verbatim (package_context bound in).
        return interpret_fn(
            pgs,
            package_context=package_context,
            question=question,
            model=model,
            preprocess=preprocess,
        )

    def _lookup():
        return lookup_recall(
            pages,
            registry=_open_registry_fresh(),
            cas=cas,
            tenant_id=TENANT,
            environment=env,
            model=model,
            preprocess=preprocess,
            producer_extra=producer_extra,
        )

    # phase 1 — lockless first lookup
    try:
        hit = _lookup()
    except Exception:  # noqa: BLE001 — a lookup error must fall through to compute
        logger.warning("PRINT_RECALL_LOOKUP_FAILED phase=1 key=%s", key[:12], exc_info=True)
        hit = None
    if hit is not None:
        graph, info = hit
        _log_hit(info, key, len(pages))
        return graph

    # phase 2 — per-key single-flight: one paid call per identical concurrent request
    with _KEYED.acquire(key):
        try:
            hit = _lookup()  # double-check under the lock (a peer may have just stored)
        except Exception:  # noqa: BLE001
            logger.warning("PRINT_RECALL_LOOKUP_FAILED phase=2 key=%s", key[:12], exc_info=True)
            hit = None
        if hit is not None:
            graph, info = hit
            _log_hit(info, key, len(pages))
            return graph
        graph, info = interpret_print_with_recall(
            pages,
            registry=_open_registry_fresh(),
            cas=cas,
            tenant_id=TENANT,
            environment=env,
            question=question,
            model=model,
            preprocess=preprocess,
            producer_extra=producer_extra,
            interpret_fn=_bound,
        )
    if info.recalled:
        _log_hit(info, key, len(pages))
    elif info.dataset_version_id:
        logger.info(
            "PRINT_RECALL_MISS key=%s page_count=%d stored=%s",
            key[:12],
            len(pages),
            info.dataset_version_id,
        )
    else:
        logger.warning("PRINT_RECALL_STORE_FAILED key=%s page_count=%d", key[:12], len(pages))
    return graph
