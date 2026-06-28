"""Phase 6 tests — mira-ingest photo pipeline."""

import io
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import main as ingest_main

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path):
    """Redirect DB and photos dir to a temp location for every test."""
    db_path = str(tmp_path / "test.db")
    photos_dir = tmp_path / "photos"
    photos_dir.mkdir()

    orig_db = ingest_main.DB_PATH
    orig_dir = ingest_main.PHOTOS_DIR
    ingest_main.DB_PATH = db_path
    ingest_main.PHOTOS_DIR = photos_dir
    ingest_main._ensure_table()

    yield db_path, photos_dir

    ingest_main.DB_PATH = orig_db
    ingest_main.PHOTOS_DIR = orig_dir


@pytest.fixture
def client():
    return TestClient(ingest_main.app)


def _make_jpeg(width: int = 100, height: int = 100, color=(128, 64, 32)) -> bytes:
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _make_jpeg_with_exif(width: int = 100, height: int = 100) -> bytes:
    img = Image.new("RGB", (width, height), color=(64, 128, 32))
    exif = img.getexif()
    exif[0x010F] = "TestManufacturer"  # ImageIFD.Make
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85, exif=exif.tobytes())
    return buf.getvalue()


def _mock_ollama():
    """Return a set of patches that make all Ollama calls return dummy data."""
    return (
        patch.object(
            ingest_main,
            "_describe_photo",
            new=AsyncMock(
                return_value="Allen-Bradley 1756 ControlLogix chassis, slot 0 occupied, green RUN LED."
            ),
        ),
        patch.object(ingest_main, "_embed_image", new=AsyncMock(return_value=[0.1, 0.2, 0.3])),
        patch.object(ingest_main, "_embed_text", new=AsyncMock(return_value=[0.1, 0.2, 0.3])),
        patch.object(ingest_main, "_push_to_kb", new=AsyncMock()),
    )


# ---------------------------------------------------------------------------
# 1. EXIF stripped from uploaded image
# ---------------------------------------------------------------------------


def test_exif_stripped_from_uploaded_image():
    jpeg_with_exif = _make_jpeg_with_exif()
    result = ingest_main._sanitize_image(jpeg_with_exif)
    result_img = Image.open(io.BytesIO(result))
    exif = result_img.getexif()
    assert exif.get(0x010F) is None, "Make tag should be stripped after sanitize"


# ---------------------------------------------------------------------------
# 2. Image resized to max 1024
# ---------------------------------------------------------------------------


def test_image_resized_to_max_1024():
    large = _make_jpeg(width=2048, height=1536)
    result = ingest_main._sanitize_image(large)
    out = Image.open(io.BytesIO(result))
    assert max(out.size) <= 1024


# ---------------------------------------------------------------------------
# 3. Malformed image returns 422
# ---------------------------------------------------------------------------


def test_malformed_image_returns_422(client):
    response = client.post(
        "/ingest/photo",
        data={"asset_tag": "PUMP-001"},
        files={"image": ("bad.jpg", b"this is not an image", "image/jpeg")},
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# 4. Missing asset_tag returns 422
# ---------------------------------------------------------------------------


def test_missing_asset_tag_returns_422(client):
    jpeg = _make_jpeg()
    response = client.post(
        "/ingest/photo",
        files={"image": ("test.jpg", jpeg, "image/jpeg")},
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# 5. Cosine similarity ranks correctly
# ---------------------------------------------------------------------------


def test_cosine_similarity_ranks_correctly():
    v1 = [1.0, 0.0, 0.0]
    v2 = [0.0, 1.0, 0.0]
    v3 = [0.0, 0.0, 1.0]
    query = [0.1, 0.9, 0.1]  # closest to v2

    scores = [
        ingest_main._cosine_similarity(query, v1),
        ingest_main._cosine_similarity(query, v2),
        ingest_main._cosine_similarity(query, v3),
    ]
    assert scores[1] > scores[0], "v2 should score higher than v1"
    assert scores[1] > scores[2], "v2 should score higher than v3"


# ---------------------------------------------------------------------------
# 6. Photo path written to disk
# ---------------------------------------------------------------------------


def test_photo_path_written_to_disk(client):
    jpeg = _make_jpeg()
    with _mock_ollama()[0], _mock_ollama()[1], _mock_ollama()[2], _mock_ollama()[3]:
        response = client.post(
            "/ingest/photo",
            data={"asset_tag": "MOTOR-001", "location": "Line 1"},
            files={"image": ("panel.jpg", jpeg, "image/jpeg")},
        )
    assert response.status_code == 200
    data = response.json()
    assert Path(data["photo_path"]).exists(), "Photo file should be on disk"


# ---------------------------------------------------------------------------
# 7. Health endpoint returns 200
# ---------------------------------------------------------------------------


def test_health_endpoint_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# document-kb upload size cap (MIRA_MAX_UPLOAD_MB, default 50)
# Locks the 2026-06-13 fix: the Telegram-era 20 MB cap is raised to 50 MB and
# made env-configurable, and MUST stay in sync with the Hub's
# NEXT_PUBLIC_MAX_UPLOAD_MB. The size gate rejects before any Open WebUI
# forward, so these need no OW mock.
# ---------------------------------------------------------------------------


def _post_pdf(client, size_bytes: int):
    data = b"%PDF-1.4\n" + b"0" * max(0, size_bytes - 9)
    return client.post(
        "/ingest/document-kb",
        files={"file": ("big.pdf", io.BytesIO(data), "application/pdf")},
    )


def test_document_kb_accepts_31mb_pdf_size_gate(client):
    # The 31.5 MB GS10 manual that the old 20 MB cap rejected now clears the
    # size gate (it then proceeds to the OW forward, which we don't exercise
    # here — a 200/500 both mean the size gate passed; only 413 means rejected).
    resp = _post_pdf(client, 31 * 1024 * 1024 + 512 * 1024)
    assert resp.status_code != 413, resp.text


def test_document_kb_rejects_over_default_50mb_cap(client):
    resp = _post_pdf(client, 51 * 1024 * 1024)
    assert resp.status_code == 413
    assert "50MB limit" in resp.json()["detail"]


def test_document_kb_cap_is_env_configurable(client, monkeypatch):
    monkeypatch.setenv("MIRA_MAX_UPLOAD_MB", "1")
    resp = _post_pdf(client, 2 * 1024 * 1024)
    assert resp.status_code == 413
    assert "1MB limit" in resp.json()["detail"]
