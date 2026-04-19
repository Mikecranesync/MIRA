"""Unit tests for the QR->pipeline cookie bridge."""
from __future__ import annotations

from qr_bridge import parse_cookie_header, read_pending_scan_id


def test_parse_cookie_header_empty():
    assert parse_cookie_header("") == {}
    assert parse_cookie_header(None) == {}


def test_parse_cookie_header_single():
    assert parse_cookie_header("mira_pending_scan=abc") == {"mira_pending_scan": "abc"}


def test_parse_cookie_header_multiple():
    h = "mira_session=jwt; mira_pending_scan=01920000-1234-7000-8000-000000000000"
    r = parse_cookie_header(h)
    assert r["mira_pending_scan"] == "01920000-1234-7000-8000-000000000000"
    assert r["mira_session"] == "jwt"


def test_read_pending_scan_id_none():
    assert read_pending_scan_id("") is None
    assert read_pending_scan_id("mira_session=abc") is None


def test_read_pending_scan_id_valid_uuid():
    h = "mira_pending_scan=01920000-1234-7000-8000-000000000000"
    assert read_pending_scan_id(h) == "01920000-1234-7000-8000-000000000000"


def test_read_pending_scan_id_rejects_non_uuid():
    # Defend against malformed cookie values -- don't pass junk to the DB
    h = "mira_pending_scan=not-a-uuid"
    assert read_pending_scan_id(h) is None
