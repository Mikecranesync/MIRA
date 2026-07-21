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
_env_warned = False


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
    """True when PRINT_RECALL_ENABLED is set, the recall package is importable, AND
    PRINT_RECALL_ENV is valid. The engine checks this before every print interpretation;
    default OFF. An invalid PRINT_RECALL_ENV disables recall (rather than mislabeling
    stored data) — see ``_resolve_env``."""
    return _flag_on() and _imports_ok() and _resolve_env() is not None


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


def _resolve_env():
    """The deployment `Environment`, or `None` if `PRINT_RECALL_ENV` is set to an
    invalid value. An invalid value is a config error we refuse to paper over: recall
    is disabled rather than silently recording (say) production materializations as
    development data. Unset -> DEV (the saas.yml compose supplies `prod` in-container).
    Warns once per process on an invalid value; the value is an env label, not a secret."""
    global _env_warned
    from materialized_evidence import Environment  # noqa: PLC0415

    raw = os.getenv(_ENV_ENV)
    if raw is None or not raw.strip():
        return Environment.DEV
    val = raw.strip().lower()
    try:
        return Environment(val)
    except ValueError:
        if not _env_warned:
            _env_warned = True
            logger.warning(
                "PRINT_RECALL_ENV_INVALID value=%r — recall disabled (refusing to mislabel "
                "stored data); valid values: dev|staging|prod",
                val,
            )
        return None


def _env():
    """A guaranteed `Environment` for materialization. `enabled()` has already rejected
    an invalid `PRINT_RECALL_ENV`, so this is reached only with a valid value; the
    `or DEV` is a defensive floor, never a silent prod->dev relabel on the live path."""
    from materialized_evidence import Environment  # noqa: PLC0415

    return _resolve_env() or Environment.DEV


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

# A kernel-backed exclusive file lock: fcntl.flock on POSIX (the Linux containers, where
# telegram + slack share /mira-db) and an msvcrt byte-range lock on Windows dev. Both are
# real cross-process locks that the kernel releases automatically if the holder crashes —
# so there is no stale lock file to reap. Used for BOTH the per-key single-flight lock and
# the short registry-snapshot lock.


def _lock_fd(fd: int) -> None:
    try:
        import fcntl  # noqa: PLC0415
    except ImportError:
        import msvcrt  # noqa: PLC0415
        import time as _t  # noqa: PLC0415

        while True:  # LK_NBLCK + poll == a blocking acquire (LK_LOCK gives up after ~10s)
            try:
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                return
            except OSError:
                _t.sleep(0.02)
    else:
        fcntl.flock(fd, fcntl.LOCK_EX)


def _unlock_fd(fd: int) -> None:
    try:
        import fcntl  # noqa: PLC0415
    except ImportError:
        import msvcrt  # noqa: PLC0415

        with contextlib.suppress(OSError):
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    else:
        with contextlib.suppress(OSError):
            fcntl.flock(fd, fcntl.LOCK_UN)


@contextlib.contextmanager
def _os_exclusive_lock(lock_path: Path):
    """Blocking, kernel-backed exclusive lock keyed on ``lock_path``. Auto-released by the
    kernel on holder crash. Distinct lock files never serialize each other."""
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(lock_path), os.O_RDWR | os.O_CREAT, 0o644)
    try:
        if os.fstat(fd).st_size == 0:
            os.write(fd, b"\0")  # msvcrt byte-range locking needs a byte present
        _lock_fd(fd)
        yield
    finally:
        _unlock_fd(fd)
        os.close(fd)


@contextlib.contextmanager
def _snapshot_lock(snapshot_path: Path):
    """The short registry-snapshot lock (INNER lock — held only for the ms-scale
    re-hydrate + persist, never across a paid call)."""
    with _os_exclusive_lock(Path(str(snapshot_path) + ".lock")):
        yield


def _key_lock_path(key: str) -> Path:
    """Per-recall-key cross-process single-flight lock file (one file per key, so distinct
    keys compute concurrently)."""
    return _recall_dir() / "locks" / f"{key}.lock"


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


def _ordered_pages(pages) -> list[dict]:
    """An ORDER- and media-type-sensitive page signature. Reversed pages or a changed
    media type are a different print — page order affects cross-references and context,
    and media type is passed to the interpreter, so both shape the graph."""
    from printsense.cas import sha256_bytes  # noqa: PLC0415

    return [{"sha256": sha256_bytes(data), "media_type": mt} for data, mt in pages]


def _build_producer_extra(question, package_context, pages) -> str:
    """The production producer identity folded into the recall key: question + package
    context + the ordered page signature. The resolver's ``source_hashes`` stays a sorted
    SET; the ORDERED sequence lives here, so ``[A,B]`` and ``[B,A]`` never recall each other."""
    from printsense.recall import canonical_json  # noqa: PLC0415

    return canonical_json(
        {
            "question": question,
            "package_context": package_context,
            "ordered_pages": _ordered_pages(pages),
        }
    )


def _recall_key(producer_extra, model, preprocess) -> str:
    """The per-key single-flight / logging key — the FULL recall identity (producer_extra
    already carries ordered pages + question + context), so it never coalesces reversed
    packages or different questions onto one paid call."""
    from printsense.cas import sha256_bytes  # noqa: PLC0415

    material = "|".join([str(model), str(int(bool(preprocess))), producer_extra])
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
    from printsense.recall import interpret_print_with_recall, lookup_recall  # noqa: PLC0415

    producer_extra = _build_producer_extra(question, package_context, pages)
    key = _recall_key(producer_extra, model, preprocess)
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

    # phase 2 — in-process per-key single-flight (double-check under the lock)
    with _KEYED.acquire(key):
        try:
            hit = _lookup()
        except Exception:  # noqa: BLE001
            logger.warning("PRINT_RECALL_LOOKUP_FAILED phase=2 key=%s", key[:12], exc_info=True)
            hit = None
        if hit is not None:
            graph, info = hit
            _log_hit(info, key, len(pages))
            return graph
        # phase 3 — CROSS-process per-key single-flight. This lock spans the final
        # lookup + paid compute + persist, so a peer container (telegram vs slack,
        # sharing /mira-db) never double-pays for the same key. Lock order: per-key
        # (in-process _KEYED, then this cross-process lock) OUTER, registry snapshot lock
        # INNER (taken during register) — never the reverse. The paid call is NOT held
        # under the snapshot lock, and distinct keys use distinct lock files, so different
        # prints still compute concurrently.
        with _os_exclusive_lock(_key_lock_path(key)):
            try:
                hit = _lookup()
            except Exception:  # noqa: BLE001
                logger.warning("PRINT_RECALL_LOOKUP_FAILED phase=3 key=%s", key[:12], exc_info=True)
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
