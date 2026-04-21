"""Per-tenant sender allowlist for inbound email.

Configured via environment variables:
    EMAIL_ALLOWLIST_{TENANT_ID}=pattern1,pattern2,...

Pattern forms:
    *              — allow all senders (open mode)
    @domain.com    — allow any address at that domain
    user@host.com  — exact address match

Example:
    EMAIL_ALLOWLIST_ACME=mike@acme.com,@acme.com,@contractor.net
    EMAIL_ALLOWLIST_DEFAULT=*

Tenant matching is case-insensitive. Missing tenant falls back to DEFAULT,
then to wildcard-allow if no rules exist at all.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("mira-email")


class AllowList:
    def __init__(self, rules: dict[str, list[str]] | None = None) -> None:
        # rules: {tenant_id_lower → [pattern, ...]}
        self._rules: dict[str, list[str]] = {
            k.lower(): [p.lower() for p in v] for k, v in (rules or {}).items()
        }

    @classmethod
    def from_env(cls) -> "AllowList":
        rules: dict[str, list[str]] = {}
        for key, val in os.environ.items():
            if key.startswith("EMAIL_ALLOWLIST_"):
                tenant = key[len("EMAIL_ALLOWLIST_"):].lower()
                patterns = [p.strip().lower() for p in val.split(",") if p.strip()]
                if patterns:
                    rules[tenant] = patterns
        return cls(rules)

    def is_allowed(self, sender_email: str, tenant_id: str) -> bool:
        sender = sender_email.lower().strip()
        key = tenant_id.lower()

        patterns = self._rules.get(key) or self._rules.get("default") or ["*"]

        for pattern in patterns:
            if pattern == "*":
                return True
            if pattern.startswith("@") and sender.endswith(pattern):
                return True
            if sender == pattern:
                return True

        logger.warning("EMAIL_ALLOWLIST_BLOCK sender=%s tenant=%s", sender, tenant_id)
        return False

    def add_rule(self, tenant_id: str, pattern: str) -> None:
        key = tenant_id.lower()
        if key not in self._rules:
            self._rules[key] = []
        self._rules[key].append(pattern.lower())
