"""TenantScopedSession — refuses queries that touch tenant tables without
filtering on tenant_id. Defense in depth alongside the ast-grep CI rule.

Usage:
    sess = TenantScopedSession(engine, tenant_id="acme")
    rows = sess.execute(text("SELECT id FROM mira_users WHERE tenant_id = :tid"),
                        {"tid": "acme"}).fetchall()
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import Engine

# Tenant-scoped tables — every read/write must filter on tenant_id.
TENANT_TABLES: frozenset[str] = frozenset(
    {
        "mira_users",
        "identity_links",
        "tenant_invites",
        "conversation_state",
        "feedback_log",
        "api_usage",
        "asset_qr_tags",
    }
)

# Match a table name as a whole word (avoids false positives on substrings).
_TABLE_RE = re.compile(r"\b(" + "|".join(re.escape(t) for t in TENANT_TABLES) + r")\b")
_TENANT_FILTER_RE = re.compile(r"\btenant_id\b")


class UnscopedQueryError(RuntimeError):
    """Raised when a query touches a tenant table without filtering on tenant_id."""


class TenantScopedSession:
    """Thin wrapper over a SQLAlchemy Connection that gates queries by tenant.

    Not a true SQLAlchemy Session — just exposes execute(). Workers that need
    full ORM features can subclass; this primitive is sufficient for MIRA's
    text()-driven query pattern.
    """

    def __init__(self, engine: Engine, tenant_id: str) -> None:
        if not tenant_id:
            raise ValueError("tenant_id is required for TenantScopedSession")
        self._engine = engine
        self.tenant_id = tenant_id

    def _check(self, sql: str) -> None:
        # Strip trailing semicolons and lowercase for matching
        body = sql.lower()
        tables_hit = set(_TABLE_RE.findall(body))
        if tables_hit and not _TENANT_FILTER_RE.search(body):
            raise UnscopedQueryError(
                f"Query touches tenant table(s) {sorted(tables_hit)} "
                "without filtering on tenant_id. Add `WHERE tenant_id = :tid` "
                "or use a non-tenant table."
            )

    def execute(self, statement: Any, params: dict[str, Any] | None = None) -> Any:
        sql_text = str(statement.compile(compile_kwargs={"literal_binds": False}))
        self._check(sql_text)
        with self._engine.connect() as conn:
            result = conn.execute(statement, params or {})
            conn.commit()
            return result
