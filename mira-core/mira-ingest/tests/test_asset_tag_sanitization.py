"""Tests for asset_tag path-traversal sanitization (issue #697)."""

import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from asset_tag import ASSET_TAG_RE, sanitize_asset_tag  # noqa: E402


def test_normal_value_passes_through():
    assert sanitize_asset_tag("PUMP-001") == "PUMP-001"
    assert sanitize_asset_tag("MOTOR_42") == "MOTOR_42"
    assert sanitize_asset_tag("a") == "a"


def test_trims_whitespace():
    assert sanitize_asset_tag("  PUMP-001  ") == "PUMP-001"


def test_traversal_attempts_are_neutralized():
    # The result of every traversal attempt must equal its own basename and
    # match the safe whitelist — so it can never escape PHOTOS_DIR.
    for hostile in [
        "../../etc",
        "../etc/passwd",
        "..\\..\\windows",
        "/etc/passwd",
        "C:\\Windows",
        "asset/with/slashes",
        "asset\\with\\back",
        "asset.with.dots",
        "asset with spaces",
        "asset;rm -rf /",
        "asset$(whoami)",
        "asset\x00null",
    ]:
        result = sanitize_asset_tag(hostile)
        assert os.path.basename(result) == result
        assert ASSET_TAG_RE.match(result), f"unsafe result: {result!r} from {hostile!r}"


def test_truncates_to_64():
    long = "A" * 200
    result = sanitize_asset_tag(long)
    assert len(result) == 64
    assert result == "A" * 64


def test_empty_or_unsanitizable_rejected():
    for bad in ["", "   ", "...", "///", "...///"]:
        with pytest.raises(HTTPException) as exc:
            sanitize_asset_tag(bad)
        assert exc.value.status_code == 400


def test_unicode_coerced_not_rejected():
    # Bot adapters may forward unicode captions — we coerce, not reject,
    # so ingest doesn't 400 a legitimate bot upload.
    result = sanitize_asset_tag("Pumpé-001")
    assert ASSET_TAG_RE.match(result)
    assert "_" in result  # the é became _


def test_unassigned_default_passes():
    # mira-hub's mira-ingest-client.ts sends "unassigned" when the user
    # didn't pick an asset. Make sure that still works.
    assert sanitize_asset_tag("unassigned") == "unassigned"
