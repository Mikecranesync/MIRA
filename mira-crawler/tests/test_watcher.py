"""Tests for folder watcher."""

from __future__ import annotations

import os
import time

from watcher.folder_watcher import FolderWatcher


class TestFolderWatcher:
    def test_detects_new_pdf(self, tmp_path):
        """New PDF in watched dir triggers callback."""
        received = []
        watcher = FolderWatcher(
            watch_dir=tmp_path,
            on_file=lambda p: received.append(p),
        )
        watcher.start()
        try:
            # Drop a file
            test_file = tmp_path / "test_manual.pdf"
            test_file.write_bytes(b"%PDF-1.4 fake content")
            time.sleep(1.0)  # give watcher time to fire

            assert len(received) == 1
            assert received[0].name == "test_manual.pdf"
        finally:
            watcher.stop()

    def test_ignores_non_pdf(self, tmp_path):
        """Non-supported file types are ignored."""
        received = []
        watcher = FolderWatcher(
            watch_dir=tmp_path,
            on_file=lambda p: received.append(p),
        )
        watcher.start()
        try:
            (tmp_path / "image.jpg").write_bytes(b"fake jpg")
            (tmp_path / "data.csv").write_text("a,b,c")
            time.sleep(1.0)
            assert len(received) == 0
        finally:
            watcher.stop()

    def test_start_stop(self, tmp_path):
        """Watcher starts and stops cleanly."""
        watcher = FolderWatcher(watch_dir=tmp_path, on_file=lambda p: None)
        assert not watcher.is_running
        watcher.start()
        assert watcher.is_running
        watcher.stop()
        assert not watcher.is_running

    def test_creates_directory(self, tmp_path):
        """Watcher creates the watch directory if it doesn't exist."""
        watch_dir = tmp_path / "nonexistent" / "incoming"
        FolderWatcher(watch_dir=watch_dir, on_file=lambda p: None)
        assert watch_dir.exists()

    def test_processes_existing_files_at_startup(self, tmp_path):
        """Files already present when start() runs must be processed.

        Regression: 16 PDFs sat in mira-crawler/data/incoming/ for 6 weeks
        because the launchd-managed watcher only listened for on_created
        events and never scanned what was already there. Backdate mtime so
        the test simulates that scenario rather than relying on watchdog's
        FSEvents quirk of picking up recent creations.
        """
        old_a = tmp_path / "preexisting_a.pdf"
        old_b = tmp_path / "preexisting_b.pdf"
        old_a.write_bytes(b"%PDF-1.4 a")
        old_b.write_bytes(b"%PDF-1.4 b")
        (tmp_path / "ignore_me.csv").write_text("a,b,c")

        # 7 days ago — well beyond any FSEvents replay window
        backdate = time.time() - 7 * 86400
        os.utime(old_a, (backdate, backdate))
        os.utime(old_b, (backdate, backdate))

        received = []
        watcher = FolderWatcher(
            watch_dir=tmp_path,
            on_file=lambda p: received.append(p),
        )
        watcher.start()
        try:
            time.sleep(0.5)
            names = sorted(p.name for p in received)
            assert names == ["preexisting_a.pdf", "preexisting_b.pdf"]
        finally:
            watcher.stop()

    def test_existing_scan_does_not_double_process_new_files(self, tmp_path):
        """A file present at startup AND a file dropped after must each fire once."""
        old_pdf = tmp_path / "old.pdf"
        old_pdf.write_bytes(b"%PDF-1.4 old")
        backdate = time.time() - 7 * 86400
        os.utime(old_pdf, (backdate, backdate))

        received = []
        watcher = FolderWatcher(
            watch_dir=tmp_path,
            on_file=lambda p: received.append(p.name),
        )
        watcher.start()
        try:
            time.sleep(0.5)
            (tmp_path / "new.pdf").write_bytes(b"%PDF-1.4 new")
            time.sleep(1.0)
            counts = {n: received.count(n) for n in set(received)}
            assert counts == {"old.pdf": 1, "new.pdf": 1}
        finally:
            watcher.stop()
