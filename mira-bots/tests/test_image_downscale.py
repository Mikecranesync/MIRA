"""Tests for _resize_for_vision image downscaling."""

import io
import os
import sys

# Set dummy env vars for bot.py import
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL",
    os.environ.get("MIRA_SERVER_BASE_URL", "http://localhost") + ":8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

# Allow importing from telegram/ directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))

from bot import _resize_for_vision
from PIL import Image


def test_large_image_resized_to_vision_max_px():
    """1920x1080 image should be downscaled so max side <= MAX_VISION_PX.

    Value tracks the MAX_VISION_PX env var (default 1024, see
    mira-bots/telegram/bot.py:_resize_for_vision).
    """
    max_px = int(os.environ.get("MAX_VISION_PX", "1024"))
    img = Image.new("RGB", (1920, 1080), (128, 128, 128))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    result = _resize_for_vision(buf.getvalue())
    out = Image.open(io.BytesIO(result))
    assert max(out.size) <= max_px


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
