"""Folder watcher — auto-ingest PDFs dropped into incoming/ directory.

Uses Watchdog to monitor a directory for new PDF files. When a file is
detected, it's queued for the ingest pipeline.

Usage:
    watcher = FolderWatcher(config, on_file=my_callback)
    watcher.start()  # non-blocking
    watcher.stop()
"""

from __future__ import annotations

import logging
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

logger = logging.getLogger("mira-crawler.watcher")

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".html", ".htm", ".txt", ".md"}


class _IncomingHandler(FileSystemEventHandler):
    """Handle new files in the watched directory."""

    def __init__(self, on_file: callable, seen: set[str]) -> None:
        super().__init__()
        self.on_file = on_file
        # Shared with FolderWatcher so the startup scan and the FSEvents
        # observer don't double-fire on the same path. macOS replays recent
        # creates when the observer attaches, which would re-trigger ingest
        # for every file already handled by _scan_existing.
        self.seen = seen

    def on_created(self, event):
        if event.is_directory:
            return
        path = Path(event.src_path)
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            return
        key = str(path.resolve())
        if key in self.seen:
            return
        self.seen.add(key)
        logger.info("New file detected: %s", path.name)
        try:
            self.on_file(path)
        except Exception as e:
            logger.error("Error processing %s: %s", path.name, e)


class FolderWatcher:
    """Watch a directory for new documents and trigger ingest."""

    def __init__(
        self,
        watch_dir: Path,
        on_file: callable,
    ) -> None:
        self.watch_dir = watch_dir
        self.watch_dir.mkdir(parents=True, exist_ok=True)
        self.on_file = on_file
        self._observer: Observer | None = None
        self._seen: set[str] = set()

    def _scan_existing(self) -> None:
        """Process files already present in watch_dir before the observer attaches.

        Without this, files dropped while the watcher was offline are stranded
        until something modifies them — the bug that left 16 PDFs untouched in
        data/incoming/ for six weeks.
        """
        for path in sorted(self.watch_dir.iterdir()):
            if not path.is_file():
                continue
            if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            key = str(path.resolve())
            if key in self._seen:
                continue
            self._seen.add(key)
            logger.info("Existing file at startup: %s", path.name)
            try:
                self.on_file(path)
            except Exception as e:
                logger.error("Error processing %s: %s", path.name, e)

    def start(self) -> None:
        """Start watching (non-blocking — runs in background thread)."""
        if self._observer is not None:
            return
        self._scan_existing()
        handler = _IncomingHandler(on_file=self.on_file, seen=self._seen)
        self._observer = Observer()
        self._observer.schedule(handler, str(self.watch_dir), recursive=False)
        self._observer.start()
        logger.info("Watching %s for new documents", self.watch_dir)

    def stop(self) -> None:
        """Stop watching."""
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)
            self._observer = None
            logger.info("Folder watcher stopped")

    @property
    def is_running(self) -> bool:
        return self._observer is not None and self._observer.is_alive()
