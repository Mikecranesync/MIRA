"""Offline tests for mira-crawler/agents/gdrive_photo_scanner.py.

No network. No Doppler. No real Drive credentials. Everything is mocked
or exercised via pure-function paths (filtering, state, summary formatting,
confidence coercion, scan-extract response shape parsing).
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

# The mira-crawler/ dir uses a hyphen so it isn't importable as a package.
# Load the agent module directly from its file path.
_AGENT_PATH = Path(__file__).resolve().parent.parent / "agents" / "gdrive_photo_scanner.py"
_spec = importlib.util.spec_from_file_location("gdrive_photo_scanner", _AGENT_PATH)
assert _spec and _spec.loader
gps = importlib.util.module_from_spec(_spec)
sys.modules["gdrive_photo_scanner"] = gps
_spec.loader.exec_module(gps)


# ── should_skip ───────────────────────────────────────────────────────────────

class TestShouldSkip:
    def _state(self):
        return gps.ScannerState()

    def test_already_processed_short_circuits(self):
        state = self._state()
        state.record("abc", filename="foo.jpg")
        meta = {"id": "abc", "name": "foo.jpg", "size": 200_000, "mimeType": "image/jpeg"}
        assert gps.should_skip(meta, state) == "already_processed"

    def test_too_small_skipped(self):
        meta = {"id": "x", "name": "tiny.jpg", "size": 50_000, "mimeType": "image/jpeg"}
        reason = gps.should_skip(meta, self._state())
        assert reason is not None and reason.startswith("too_small")

    def test_unsupported_mime_skipped(self):
        meta = {"id": "x", "name": "doc.pdf", "size": 500_000, "mimeType": "application/pdf"}
        reason = gps.should_skip(meta, self._state())
        assert reason is not None and reason.startswith("unsupported_mime")

    def test_screenshot_filename_skipped_case_insensitive(self):
        meta = {"id": "x", "name": "Screenshot 2026-04-19.png", "size": 500_000, "mimeType": "image/png"}
        assert gps.should_skip(meta, self._state()) == "screenshot"
        meta["name"] = "iPhone screenshot.png"
        assert gps.should_skip(meta, self._state()) == "screenshot"

    def test_valid_photo_passes(self):
        meta = {"id": "x", "name": "motor_nameplate.jpg", "size": 800_000, "mimeType": "image/jpeg"}
        assert gps.should_skip(meta, self._state()) is None

    def test_size_at_threshold_passes(self):
        meta = {
            "id": "x",
            "name": "edge.jpg",
            "size": gps.MIN_IMAGE_BYTES,
            "mimeType": "image/jpeg",
        }
        assert gps.should_skip(meta, self._state()) is None


# ── ScannerState ──────────────────────────────────────────────────────────────

class TestScannerState:
    def test_save_and_load_roundtrip(self, tmp_path: Path):
        state_file = tmp_path / "state.json"
        s = gps.ScannerState()
        s.record("file1", outcome="queued", make="Allen-Bradley", model="1336")
        s.save(state_file)

        reloaded = gps.ScannerState.load(state_file)
        assert reloaded.has("file1")
        assert reloaded.processed["file1"]["outcome"] == "queued"

    def test_load_missing_file_returns_empty(self, tmp_path: Path):
        s = gps.ScannerState.load(tmp_path / "does_not_exist.json")
        assert s.processed == {}

    def test_load_corrupt_file_recovers(self, tmp_path: Path):
        bad = tmp_path / "state.json"
        bad.write_text("not json")
        s = gps.ScannerState.load(bad)
        assert s.processed == {}

    def test_record_preserves_first_seen(self):
        s = gps.ScannerState()
        s.record("f", outcome="kb_hit")
        first_seen = s.processed["f"]["first_seen"]
        s.record("f", outcome="queued")  # second update
        assert s.processed["f"]["first_seen"] == first_seen
        assert s.processed["f"]["outcome"] == "queued"


# ── Confidence coercion ───────────────────────────────────────────────────────

class TestConfidenceCoercion:
    def test_float_pass_through(self):
        assert gps._coerce_confidence(0.85) == pytest.approx(0.85)

    def test_int_percent_normalized(self):
        assert gps._coerce_confidence(72) == pytest.approx(0.72)

    def test_string_buckets(self):
        assert gps._coerce_confidence("high") == 0.9
        assert gps._coerce_confidence("medium") == 0.7
        assert gps._coerce_confidence("low") == 0.3
        assert gps._coerce_confidence("HIGH") == 0.9
        assert gps._coerce_confidence("nonsense") == 0.0

    def test_other_returns_zero(self):
        assert gps._coerce_confidence(None) == 0.0
        assert gps._coerce_confidence([0.9]) == 0.0


# ── ScanExtract.is_valid ──────────────────────────────────────────────────────

class TestScanExtractIsValid:
    def test_valid_when_make_model_and_high_conf(self):
        e = gps.ScanExtract(make="ABB", model="ACS580", confidence=0.8, raw={})
        assert e.is_valid is True

    def test_invalid_when_low_conf(self):
        e = gps.ScanExtract(make="ABB", model="ACS580", confidence=0.3, raw={})
        assert e.is_valid is False

    def test_invalid_when_missing_make(self):
        e = gps.ScanExtract(make="", model="ACS580", confidence=0.9, raw={})
        assert e.is_valid is False


# ── RunSummary ────────────────────────────────────────────────────────────────

class TestRunSummary:
    def test_bump_skip_buckets_subreasons(self):
        s = gps.RunSummary()
        s.bump_skip("too_small:50000b")
        s.bump_skip("too_small:80000b")
        s.bump_skip("screenshot")
        assert s.skipped == {"too_small": 2, "screenshot": 1}

    def test_format_summary_mentions_queued(self):
        s = gps.RunSummary(listed=10, extracted=8, nameplates_found=5, kb_hits=2, queued=3)
        out = gps._format_summary(s)
        assert "3 new equipment queued" in out
        assert "10 Drive image" in out


# ── End-to-end orchestration (all I/O mocked) ─────────────────────────────────

class _FakeScanClient:
    def __init__(self, *, kb_known: set[tuple[str, str]] | None = None) -> None:
        self.kb_known = kb_known or set()
        self.queued: list[dict[str, Any]] = []

    async def extract(self, image_bytes: bytes, mime_type: str, filename: str):
        del image_bytes, mime_type
        # Filename drives the fake response so tests can be deterministic.
        # Match most-specific labels first ("blurry" before "abb").
        n = filename.lower()
        if "blurry" in n:
            return gps.ScanExtract(make="ABB", model="ACS580", confidence=0.2, raw={})
        if "powerflex" in n:
            return gps.ScanExtract(make="Allen-Bradley", model="PowerFlex-525", confidence=0.92, raw={})
        if "abb" in n:
            return gps.ScanExtract(make="ABB", model="ACS580", confidence=0.81, raw={})
        return gps.ScanExtract(make="", model="", confidence=0.1, raw={})

    async def kb_lookup(self, make: str, model: str) -> bool:
        return (make, model) in self.kb_known

    async def queue_manual_request(self, **kwargs: Any) -> bool:
        self.queued.append(kwargs)
        return True


class _FakeAuth:
    async def get_token(self) -> str:
        return "fake-token"


@pytest.fixture
def isolated_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    state_file = tmp_path / "state.json"
    monkeypatch.setattr(gps, "STATE_PATH", state_file)
    return state_file


def _drive_files() -> list[dict[str, Any]]:
    return [
        # New PowerFlex photo — should be extracted, KB hit, no queue.
        {"id": "f1", "name": "powerflex_525.jpg", "size": 800_000, "mimeType": "image/jpeg"},
        # New ABB photo — should be extracted, KB miss, queued.
        {"id": "f2", "name": "abb_drive.jpg", "size": 600_000, "mimeType": "image/jpeg"},
        # Screenshot — should be skipped before download.
        {"id": "f3", "name": "Screenshot 2026.png", "size": 700_000, "mimeType": "image/png"},
        # Tiny thumbnail — should be skipped.
        {"id": "f4", "name": "thumb.jpg", "size": 20_000, "mimeType": "image/jpeg"},
        # Blurry — extracts but low confidence; not queued.
        {"id": "f5", "name": "blurry_abb.jpg", "size": 500_000, "mimeType": "image/jpeg"},
    ]


def test_run_orchestration_happy_path(isolated_state: Path):
    fake_scan = _FakeScanClient(kb_known={("Allen-Bradley", "PowerFlex-525")})

    async def fake_list(_auth, *, query: str, max_files: int | None) -> list[dict[str, Any]]:
        del _auth, query, max_files
        return _drive_files()

    async def fake_download(_auth, _fid):
        del _auth, _fid
        return b"fake-image-bytes"

    with (
        patch.object(gps, "_DriveAuth", return_value=_FakeAuth()),
        patch.object(gps, "_ScanClient", return_value=fake_scan),
        patch.object(gps, "list_image_files", new=fake_list),
        patch.object(gps, "download_file", new=fake_download),
    ):
        summary = asyncio.run(gps.run())

    assert summary.listed == 5
    assert summary.extracted == 3              # f1, f2, f5 (f3/f4 skipped pre-download)
    assert summary.nameplates_found == 2       # f1, f2 — f5 is low-confidence
    assert summary.kb_hits == 1                # f1 (PowerFlex)
    assert summary.queued == 1                 # f2 (ABB)
    assert summary.skipped.get("screenshot") == 1
    assert summary.skipped.get("too_small") == 1
    assert len(fake_scan.queued) == 1
    assert fake_scan.queued[0]["make"] == "ABB"
    assert fake_scan.queued[0]["model"] == "ACS580"
    assert fake_scan.queued[0]["source_file_id"] == "f2"

    # State must be persisted with all 3 extracted files.
    saved = json.loads(isolated_state.read_text())
    assert set(saved["processed"].keys()) == {"f1", "f2", "f5"}


def test_run_is_idempotent_second_pass_does_no_work(isolated_state: Path):
    del isolated_state  # used only for its monkeypatch side effect
    fake_scan = _FakeScanClient(kb_known={("Allen-Bradley", "PowerFlex-525")})

    async def fake_list(_auth, *, query: str, max_files: int | None) -> list[dict[str, Any]]:
        del _auth, query, max_files
        return _drive_files()

    async def fake_download(_auth, _fid):
        del _auth, _fid
        return b"fake-image-bytes"

    with (
        patch.object(gps, "_DriveAuth", return_value=_FakeAuth()),
        patch.object(gps, "_ScanClient", return_value=fake_scan),
        patch.object(gps, "list_image_files", new=fake_list),
        patch.object(gps, "download_file", new=fake_download),
    ):
        first = asyncio.run(gps.run())
        second = asyncio.run(gps.run())

    assert first.queued == 1
    # Second run — every previously-extracted file is now in state, so they
    # all return "already_processed" without ever hitting the scan backend.
    assert second.extracted == 0
    assert second.queued == 0
    assert second.skipped.get("already_processed", 0) >= 3


def test_run_dry_run_does_not_queue_or_persist(isolated_state: Path):
    fake_scan = _FakeScanClient(kb_known=set())

    async def fake_list(_auth, *, query: str, max_files: int | None) -> list[dict[str, Any]]:
        del _auth, query, max_files
        return [
            {"id": "f2", "name": "abb_drive.jpg", "size": 600_000, "mimeType": "image/jpeg"},
        ]

    async def fake_download(_auth, _fid):
        del _auth, _fid
        return b"fake-image-bytes"

    with (
        patch.object(gps, "_DriveAuth", return_value=_FakeAuth()),
        patch.object(gps, "_ScanClient", return_value=fake_scan),
        patch.object(gps, "list_image_files", new=fake_list),
        patch.object(gps, "download_file", new=fake_download),
    ):
        summary = asyncio.run(gps.run(dry_run=True))

    assert summary.nameplates_found == 1
    assert summary.queued == 0                 # dry-run never queues
    assert fake_scan.queued == []
    assert not isolated_state.exists()         # dry-run never writes state
