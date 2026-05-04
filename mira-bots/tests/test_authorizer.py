"""Tests for Authorizer — gates admin commands by Telegram user ID."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from shared.tenant.authorizer import Authorizer


def test_empty_admin_list_blocks_everyone():
    auth = Authorizer(admin_telegram_ids="")
    assert not auth.is_admin("12345")


def test_single_admin_allowed():
    auth = Authorizer(admin_telegram_ids="12345")
    assert auth.is_admin("12345")
    assert not auth.is_admin("67890")


def test_multiple_admins_csv():
    auth = Authorizer(admin_telegram_ids="12345,67890,11111")
    assert auth.is_admin("12345")
    assert auth.is_admin("67890")
    assert auth.is_admin("11111")
    assert not auth.is_admin("99999")


def test_whitespace_tolerated():
    auth = Authorizer(admin_telegram_ids=" 12345 , 67890 ")
    assert auth.is_admin("12345")
    assert auth.is_admin("67890")


def test_int_input_normalized():
    """Telegram passes user IDs as int; auth must coerce both sides to str."""
    auth = Authorizer(admin_telegram_ids="12345")
    assert auth.is_admin(12345)
