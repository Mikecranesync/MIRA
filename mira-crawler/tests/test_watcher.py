"""Tests for folder watcher."""

from __future__ import annotations

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
