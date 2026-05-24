"""MiraDrop watcher — desktop drop-folder ingest daemon.

Watches ~/MiraDrop/inbox/ for new files and POSTs each one to mira-hub's
`/api/uploads/folder` route. Files move through `processing/ → done/`
(or `failed/`) with status sidecars and an SQLite ledger for SHA-256
dedup.

Best-practice details — see plan: ~/.claude/plans/optimized-tumbling-wilkes.md
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
import signal
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Event, Lock, Thread

import httpx
from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

logging.basicConfig(
    level=os.getenv("MIRA_DROP_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("mira-drop")

ROOT = Path(os.getenv("MIRA_DROP_ROOT", str(Path.home() / "MiraDrop"))).expanduser()
INBOX = ROOT / "inbox"
PROCESSING = ROOT / "processing"
DONE = ROOT / "done"
FAILED = ROOT / "failed"
STATE = ROOT / ".state"
LEDGER_PATH = STATE / "ledger.sqlite"

HUB_URL = os.getenv("HUB_URL", "http://127.0.0.1:3101").rstrip("/")
# mira-hub runs under basePath=/hub (next.config.ts:6) with trailingSlash=true.
HUB_BASE_PATH = os.getenv("HUB_BASE_PATH", "/hub").rstrip("/")
HUB_TOKEN = os.getenv("HUB_INGEST_TOKEN", "")
TENANT_ID = os.getenv("MIRA_TENANT_ID", "")

SUPPORTED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}

STABILITY_INTERVAL = float(os.getenv("MIRA_DROP_STABILITY_INTERVAL", "0.5"))
STABLE_ROUNDS = int(os.getenv("MIRA_DROP_STABLE_ROUNDS", "3"))
LOCK_TTL_SECS = int(os.getenv("MIRA_DROP_LOCK_TTL_SECS", "3600"))
POLL_FALLBACK_SECS = int(os.getenv("MIRA_DROP_POLL_FALLBACK_SECS", "30"))
POLL_MIN_FILE_AGE_SECS = int(os.getenv("MIRA_DROP_POLL_MIN_AGE_SECS", "60"))
INGEST_POLL_INTERVAL_SECS = float(os.getenv("MIRA_DROP_INGEST_POLL_INTERVAL", "2"))
INGEST_POLL_TIMEOUT_SECS = int(os.getenv("MIRA_DROP_INGEST_POLL_TIMEOUT", "180"))
RETRY_BACKOFF_SECS = [2, 8, 32]


@dataclass
class IngestResult:
    upload_id: str
    status: str
    kb_file_id: str | None
    kb_chunk_count: int | None
    error: str | None


# ---------------------------------------------------------------------------
# Ledger
# ---------------------------------------------------------------------------


def _ledger() -> sqlite3.Connection:
    STATE.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(LEDGER_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ingests (
            sha256        TEXT PRIMARY KEY,
            filename      TEXT NOT NULL,
            status        TEXT NOT NULL,
            attempts      INTEGER NOT NULL DEFAULT 0,
            upload_id     TEXT,
            kb_file_id    TEXT,
            kb_chunk_count INTEGER,
            error         TEXT,
            started_at    TEXT NOT NULL,
            finished_at   TEXT
        )
        """
    )
    return conn


def _ledger_get(sha: str) -> dict | None:
    with _ledger() as c:
        row = c.execute(
            "SELECT sha256, filename, status, attempts, upload_id, kb_file_id, kb_chunk_count, error, started_at, finished_at FROM ingests WHERE sha256=?",
            (sha,),
        ).fetchone()
    if not row:
        return None
    keys = [
        "sha256", "filename", "status", "attempts", "upload_id",
        "kb_file_id", "kb_chunk_count", "error", "started_at", "finished_at",
    ]
    return dict(zip(keys, row))


def _ledger_upsert(sha: str, **fields) -> None:
    with _ledger() as c:
        existing = c.execute("SELECT 1 FROM ingests WHERE sha256=?", (sha,)).fetchone()
        if existing:
            sets = ", ".join(f"{k}=?" for k in fields)
            c.execute(f"UPDATE ingests SET {sets} WHERE sha256=?", (*fields.values(), sha))
        else:
            fields.setdefault("started_at", _now())
            fields.setdefault("attempts", 0)
            cols = ", ".join(["sha256", *fields.keys()])
            placeholders = ", ".join("?" for _ in range(len(fields) + 1))
            c.execute(
                f"INSERT INTO ingests ({cols}) VALUES ({placeholders})",
                (sha, *fields.values()),
            )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_dirs() -> None:
    for p in (INBOX, PROCESSING, DONE, FAILED, STATE):
        p.mkdir(parents=True, exist_ok=True)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _wait_until_stable(path: Path) -> bool:
    """Return True once the file size has been unchanged for STABLE_ROUNDS
    consecutive checks. Caps the total wait to keep one stuck file from
    blocking the queue.
    """
    last = -1
    stable = 0
    deadline = time.time() + 60
    while time.time() < deadline:
        if not path.exists():
            return False
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return False
        if size == last and size > 0:
            stable += 1
            if stable >= STABLE_ROUNDS:
                return True
        else:
            stable = 0
            last = size
        time.sleep(STABILITY_INTERVAL)
    logger.warning("stability timeout for %s", path.name)
    return False


def _lock_path(processing_file: Path) -> Path:
    return processing_file.with_suffix(processing_file.suffix + ".lock")


def _acquire_lock(processing_file: Path) -> bool:
    lp = _lock_path(processing_file)
    if lp.exists():
        try:
            age = time.time() - lp.stat().st_mtime
        except FileNotFoundError:
            age = 0
        if age < LOCK_TTL_SECS:
            return False
        logger.warning("stale lock (%ds) for %s — reclaiming", int(age), processing_file.name)
        lp.unlink(missing_ok=True)
    lp.write_text(json.dumps({"pid": os.getpid(), "started_at": _now()}))
    return True


def _release_lock(processing_file: Path) -> None:
    _lock_path(processing_file).unlink(missing_ok=True)


def _supported(path: Path) -> bool:
    return path.suffix.lower() in SUPPORTED_EXT and not path.name.startswith(".")


def _stamped_name(sha: str, filename: str) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{ts}_{sha[:8]}_{filename}"


# ---------------------------------------------------------------------------
# Hub HTTP
# ---------------------------------------------------------------------------


def _post_to_hub(path: Path, mime: str, request_id: str) -> dict:
    url = f"{HUB_URL}{HUB_BASE_PATH}/api/uploads/folder/"
    with path.open("rb") as f:
        files = {"file": (path.name, f, mime)}
        headers = {
            "Authorization": f"Bearer {HUB_TOKEN}",
            "X-Mira-Tenant-Id": TENANT_ID,
            "X-Request-Id": request_id,
        }
        resp = httpx.post(url, headers=headers, files=files, timeout=180)
    resp.raise_for_status()
    return resp.json()


def _poll_hub(upload_id: str) -> dict:
    """Poll /api/uploads/:id until terminal status. Falls back to listing
    /api/uploads if no per-id GET exists (graceful)."""
    url = f"{HUB_URL}{HUB_BASE_PATH}/api/uploads/{upload_id}/"
    deadline = time.time() + INGEST_POLL_TIMEOUT_SECS
    last: dict = {}
    headers = {
        "Authorization": f"Bearer {HUB_TOKEN}",
        "X-Mira-Tenant-Id": TENANT_ID,
    }
    while time.time() < deadline:
        try:
            resp = httpx.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                last = resp.json()
                status = (last.get("status") or "").lower()
                if status in {"parsed", "failed", "cancelled"}:
                    return last
        except httpx.HTTPError as e:
            logger.debug("poll error: %s", e)
        time.sleep(INGEST_POLL_INTERVAL_SECS)
    last.setdefault("status", "timeout")
    return last


def _mime_for(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".pdf":  "application/pdf",
        ".jpg":  "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png":  "image/png",
        ".webp": "image/webp",
        ".heic": "image/heic",
        ".heif": "image/heif",
    }.get(ext, "application/octet-stream")


# ---------------------------------------------------------------------------
# Core ingest
# ---------------------------------------------------------------------------


_inflight_lock = Lock()
_inflight: set[str] = set()


def _process(src: Path, dry_run: bool = False) -> None:
    if not _supported(src):
        logger.debug("ignoring unsupported file: %s", src.name)
        return
    if not _wait_until_stable(src):
        logger.warning("skipping unstable file: %s", src.name)
        return

    try:
        sha = _sha256(src)
    except FileNotFoundError:
        return

    with _inflight_lock:
        if sha in _inflight:
            return
        _inflight.add(sha)
    try:
        _process_locked(src, sha, dry_run)
    finally:
        with _inflight_lock:
            _inflight.discard(sha)


def _process_locked(src: Path, sha: str, dry_run: bool) -> None:
    prior = _ledger_get(sha)
    if prior and prior["status"] == "parsed":
        target = DONE / _stamped_name(sha, src.name)
        try:
            shutil.move(str(src), str(target))
        except FileNotFoundError:
            return
        sidecar = target.with_suffix(target.suffix + ".duplicate.json")
        sidecar.write_text(json.dumps({
            "sha256": sha,
            "original_upload_id": prior["upload_id"],
            "original_filename": prior["filename"],
            "kb_file_id": prior["kb_file_id"],
            "kb_chunk_count": prior["kb_chunk_count"],
            "duplicate_detected_at": _now(),
        }, indent=2))
        logger.info("duplicate (already parsed): %s → done/", src.name)
        return

    proc_path = PROCESSING / src.name
    try:
        os.rename(src, proc_path)
    except FileNotFoundError:
        return
    except OSError as e:
        logger.error("move to processing failed for %s: %s", src.name, e)
        return

    if not _acquire_lock(proc_path):
        logger.info("another worker holds lock for %s, skipping", proc_path.name)
        return

    _ledger_upsert(sha, filename=src.name, status="processing",
                   attempts=(prior["attempts"] if prior else 0))

    if dry_run:
        logger.info("[dry-run] would POST %s (sha=%s)", src.name, sha[:8])
        _release_lock(proc_path)
        os.rename(proc_path, INBOX / src.name)
        return

    mime = _mime_for(proc_path)
    request_id = f"miradrop-{sha[:12]}"
    err_msg: str | None = None
    upload_id: str | None = None
    kb_file_id: str | None = None
    kb_chunk_count: int | None = None

    for attempt, backoff in enumerate([0, *RETRY_BACKOFF_SECS]):
        if backoff:
            time.sleep(backoff)
        try:
            row = _post_to_hub(proc_path, mime, request_id)
            upload_id = row.get("id")
            logger.info("uploaded %s → upload_id=%s (attempt %d)",
                        proc_path.name, upload_id, attempt + 1)
            poll = _poll_hub(upload_id) if upload_id else {"status": "unknown"}
            status = (poll.get("status") or "").lower()
            raw_kb_file_id = poll.get("kbFileId") or poll.get("kb_file_id")
            kb_file_id = str(raw_kb_file_id) if raw_kb_file_id else None
            raw_kb_chunks = poll.get("kbChunkCount") or poll.get("kb_chunk_count")
            kb_chunk_count = (
                int(raw_kb_chunks)
                if isinstance(raw_kb_chunks, (int, str)) and str(raw_kb_chunks).isdigit()
                else None
            )
            if status == "parsed":
                err_msg = None
                break
            err_msg = f"hub status={status} (poll body: {json.dumps(poll)[:200]})"
        except httpx.HTTPStatusError as e:
            err_msg = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
            logger.warning("hub upload failed for %s: %s", proc_path.name, err_msg)
            if e.response.status_code in (401, 403, 400, 413, 415):
                break  # auth/validation — no retry
        except httpx.HTTPError as e:
            err_msg = f"transport: {e}"
            logger.warning("hub transport error for %s: %s", proc_path.name, err_msg)
        _ledger_upsert(sha, attempts=attempt + 1, error=err_msg)

    if err_msg is None:
        target = DONE / _stamped_name(sha, src.name)
        os.rename(proc_path, target)
        _release_lock(proc_path)
        sidecar = target.with_suffix(target.suffix + ".ingest.json")
        sidecar.write_text(json.dumps({
            "sha256": sha,
            "upload_id": upload_id,
            "kb_file_id": kb_file_id,
            "kb_chunk_count": kb_chunk_count,
            "processed_at": _now(),
            "request_id": request_id,
        }, indent=2))
        _ledger_upsert(sha, status="parsed", upload_id=upload_id,
                       kb_file_id=kb_file_id, kb_chunk_count=kb_chunk_count,
                       finished_at=_now(), error=None)
        logger.info("✓ %s parsed (file_id=%s chunks=%s)",
                    src.name, kb_file_id, kb_chunk_count)
    else:
        target = FAILED / src.name
        os.rename(proc_path, target)
        _release_lock(proc_path)
        sidecar = target.with_suffix(target.suffix + ".error.json")
        sidecar.write_text(json.dumps({
            "sha256": sha,
            "upload_id": upload_id,
            "error": err_msg,
            "attempts": attempt + 1,
            "failed_at": _now(),
            "request_id": request_id,
        }, indent=2))
        _ledger_upsert(sha, status="failed", upload_id=upload_id,
                       error=err_msg, finished_at=_now())
        logger.error("✗ %s failed after %d attempt(s): %s",
                     src.name, attempt + 1, err_msg)


# ---------------------------------------------------------------------------
# Watchdog handler
# ---------------------------------------------------------------------------


class _InboxHandler(FileSystemEventHandler):
    def __init__(self, dry_run: bool = False) -> None:
        super().__init__()
        self.dry_run = dry_run

    def on_created(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        Thread(target=_process, args=(Path(event.src_path), self.dry_run),
               daemon=True).start()

    def on_moved(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        dest = getattr(event, "dest_path", "")
        if dest and dest.startswith(str(INBOX)):
            Thread(target=_process, args=(Path(dest), self.dry_run),
                   daemon=True).start()


# ---------------------------------------------------------------------------
# Startup sweep + polling fallback
# ---------------------------------------------------------------------------


def _sweep(dry_run: bool = False, min_age: int = 0) -> None:
    """Walk inbox/ for files (optionally older than min_age seconds)."""
    if not INBOX.exists():
        return
    now = time.time()
    for entry in INBOX.iterdir():
        if not entry.is_file():
            continue
        if min_age:
            try:
                age = now - entry.stat().st_mtime
            except FileNotFoundError:
                continue
            if age < min_age:
                continue
        Thread(target=_process, args=(entry, dry_run), daemon=True).start()


def _poll_loop(stop: Event, dry_run: bool) -> None:
    """FSEvents can miss multi-move bursts (watchdog#736). Periodically
    sweep for stragglers older than POLL_MIN_FILE_AGE_SECS."""
    while not stop.wait(POLL_FALLBACK_SECS):
        _sweep(dry_run=dry_run, min_age=POLL_MIN_FILE_AGE_SECS)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def _validate_config(dry_run: bool) -> None:
    if not HUB_TOKEN and not dry_run:
        logger.error("HUB_INGEST_TOKEN env var is required")
        sys.exit(2)
    if not TENANT_ID and not dry_run:
        logger.error("MIRA_TENANT_ID env var is required")
        sys.exit(2)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="MiraDrop watcher daemon")
    ap.add_argument("--dry-run", action="store_true",
                    help="log events but do not POST to Hub")
    ap.add_argument("--once", action="store_true",
                    help="process current inbox contents and exit (no watch)")
    args = ap.parse_args(argv)

    _ensure_dirs()
    _validate_config(args.dry_run)

    logger.info("MiraDrop watching %s  (HUB=%s tenant=%s%s)",
                INBOX, HUB_URL, TENANT_ID[:8] + "…" if TENANT_ID else "(unset)",
                " [DRY RUN]" if args.dry_run else "")

    if args.once:
        _sweep(dry_run=args.dry_run)
        # Let worker threads register themselves before we check for drain.
        time.sleep(2)
        deadline = time.time() + 240
        while time.time() < deadline:
            with _inflight_lock:
                if not _inflight:
                    return 0
            time.sleep(1)
        logger.warning("--once drain timeout with %d inflight", len(_inflight))
        return 1

    stop = Event()
    observer = Observer()
    observer.schedule(_InboxHandler(dry_run=args.dry_run), str(INBOX), recursive=False)
    observer.start()

    # Startup sweep — handle files dropped while daemon was down
    _sweep(dry_run=args.dry_run)

    # Polling fallback for FSEvents misses
    poller = Thread(target=_poll_loop, args=(stop, args.dry_run), daemon=True)
    poller.start()

    def _shutdown(_sig: int, _frame) -> None:
        logger.info("shutdown signal received")
        stop.set()
        observer.stop()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    try:
        observer.join()
    finally:
        stop.set()
    return 0


if __name__ == "__main__":
    sys.exit(main())
