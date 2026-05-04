"""Authorizer — admin gate for invite/team/revoke commands.

Source of truth is the ADMIN_TELEGRAM_IDS env var (CSV of Telegram user IDs).
Stored in Doppler. Add a single ID to bootstrap; add more later as the team
grows.
"""

from __future__ import annotations


class Authorizer:
    def __init__(self, admin_telegram_ids: str) -> None:
        self._admins: frozenset[str] = frozenset(
            tok.strip() for tok in admin_telegram_ids.split(",") if tok.strip()
        )

    def is_admin(self, telegram_user_id: str | int) -> bool:
        return str(telegram_user_id) in self._admins

    def admin_count(self) -> int:
        return len(self._admins)
