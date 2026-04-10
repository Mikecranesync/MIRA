"""Tests for _resize_for_vision image downscaling."""

import io
import sys
import os

# Set dummy env vars for bot.py import
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL",
    os.environ.get("MIRA_SERVER_BASE_URL", "http://localhost") + ":8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")
os.environ.setdefault("MAX_VISION_PX", "512")  # test was written against 512 default

# Allow importing from telegram/ directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))

from PIL import Image
from bot import _resize_for_vision


def test_large_image_resized_to_512():
    """1920x1080 image should be downscaled so max side <= 512."""
    img = Image.new("RGB", (1920, 1080), (128, 128, 128))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    result = _resize_for_vision(buf.getvalue())
    out = Image.open(io.BytesIO(result))
    assert max(out.size) <= 512


def test_small_image_unchanged():
    """256x256 image should pass through unchanged (same pixel dimensions)."""
    img = Image.new("RGB", (256, 256), (64, 64, 64))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    result = _resize_for_vision(buf.getvalue())
    out = Image.open(io.BytesIO(result))
    assert out.size == (256, 256)


def test_output_is_valid_jpeg():
    """Output bytes must be a valid JPEG (starts with JPEG magic bytes)."""
    img = Image.new("RGB", (800, 600))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    result = _resize_for_vision(buf.getvalue())
    assert result[:2] == b'\xff\xd8'  # JPEG magic bytes
