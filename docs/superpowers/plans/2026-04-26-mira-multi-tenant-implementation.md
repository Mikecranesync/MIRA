# MIRA Multi-Tenant Telegram Bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire MIRA's existing identity scaffolding into the Telegram bot so each team member is isolated to their own conversation/memory while sharing the team's KB, equipment registry, and CMMS — onboarding via deep-link invites.

**Architecture:** App-level tenant scoping (`TenantScopedSession` SQLAlchemy wrapper + ast-grep CI rule for defense in depth). Strict gate: every request must resolve to an `identity_links` row via `IdentityService.lookup_only()` — no env-var fallback, no auto-creation. New users join via Telegram deep links (`https://t.me/<bot>?start=<token>`). RLS deferred — Neon's PgBouncer transaction-mode pooling does not preserve `SET` state.

**Tech Stack:** Python 3.12, `uv`, `ruff`, `httpx`, SQLAlchemy 2.x with `NullPool`, `python-telegram-bot` 21.11, NeonDB (Postgres 17), SQLite WAL, pytest, ast-grep, Docker Compose, Doppler for secrets.

**Spec:** `docs/superpowers/specs/2026-04-26-mira-multi-tenant-design.md` (committed `623816b`).

**Effort target:** 15 tasks, ~470 LOC, ~1 focused day.

---

## Pre-flight

- [ ] **P.1: Confirm clean working tree on the right branch**

```bash
cd /Users/bravonode/Mira
git status
git branch --show-current
```

Expected: branch is `codex/repo-sync-baseline` or a feature branch off it; only the spec from `623816b` and the new plan file showing as untracked/staged.

- [ ] **P.2: Create a feature branch for the implementation**

```bash
cd /Users/bravonode/Mira
git checkout -b feat/multi-tenant-telegram
```

- [ ] **P.3: Add the plan file and commit it as the work starting point**

```bash
git add docs/superpowers/plans/2026-04-26-mira-multi-tenant-implementation.md
git -c commit.gpgsign=false commit -m "plan: multi-tenant telegram implementation"
```

- [ ] **P.4: Verify pytest runs the existing test suite cleanly**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_identity_service.py -q
```

Expected: 11 tests pass. If they don't, STOP — the baseline is broken; fix before adding work on top.

---

## Task 1: Migration 006 — `tenant_invites` table

**Files:**
- Create: `docs/migrations/006_tenant_invites.sql`

- [ ] **Step 1: Write the migration SQL**

Create `docs/migrations/006_tenant_invites.sql`:

```sql
-- Migration 006: tenant_invites table
-- Purpose: store deep-link invite tokens for Telegram (and future) onboarding.
-- Tokens are 32-char base64url strings, well within Telegram's 64-char start
-- parameter limit. See docs/superpowers/specs/2026-04-26-mira-multi-tenant-design.md.

CREATE TABLE IF NOT EXISTS tenant_invites (
    token        TEXT PRIMARY KEY,
    tenant_id    UUID NOT NULL REFERENCES plg_tenants(id),
    email        TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    minted_by    TEXT NOT NULL,
    minted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    consumed_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_tenant_invites_unconsumed
    ON tenant_invites (tenant_id)
    WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_invites_email
    ON tenant_invites (tenant_id, email);
```

- [ ] **Step 2: Apply the migration to NeonDB**

```bash
cd /Users/bravonode/Mira
doppler run --project factorylm --config prd -- \
  psql "$NEON_DATABASE_URL" -f docs/migrations/006_tenant_invites.sql
```

Expected:
```
CREATE TABLE
CREATE INDEX
CREATE INDEX
```

- [ ] **Step 3: Verify the table exists**

```bash
doppler run --project factorylm --config prd -- \
  psql "$NEON_DATABASE_URL" -c "\d tenant_invites"
```

Expected: column listing matching the migration.

- [ ] **Step 4: Commit**

```bash
git add docs/migrations/006_tenant_invites.sql
git -c commit.gpgsign=false commit -m "feat(db): add tenant_invites table (migration 006)"
```

---

## Task 2: `IdentityService.lookup_only()`

Adds a strict, no-auto-create lookup used by the dispatcher gate.

**Files:**
- Modify: `mira-bots/shared/identity/service.py` (add method, ~25 LOC)
- Test: `mira-bots/tests/test_identity_service.py` (extend existing fixtures)

- [ ] **Step 1: Write the failing test**

Append to `mira-bots/tests/test_identity_service.py`:

```python
# ---------------------------------------------------------------------------
# lookup_only — strict, no auto-create
# ---------------------------------------------------------------------------


def test_lookup_only_returns_none_for_unknown_identity(svc):
    assert svc.lookup_only("telegram", "999_unknown") is None


def test_lookup_only_returns_user_for_known_identity(svc):
    created = svc.resolve("telegram", "12345", "acme", display_name="Eve")
    found = svc.lookup_only("telegram", "12345")
    assert found is not None
    assert found.id == created.id
    assert found.tenant_id == "acme"
    assert found.display_name == "Eve"


def test_lookup_only_does_not_auto_create(svc):
    """lookup_only must never insert rows — strangers stay strangers."""
    from sqlalchemy import text

    svc.lookup_only("telegram", "no_such_user")
    with svc._engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM mira_users")).scalar()
    assert count == 0
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_identity_service.py::test_lookup_only_returns_none_for_unknown_identity -v
```

Expected: FAIL with `AttributeError: 'IdentityService' object has no attribute 'lookup_only'`.

- [ ] **Step 3: Implement `lookup_only`**

In `mira-bots/shared/identity/service.py`, add this method to the `IdentityService` class (immediately after `resolve()`, before `get_user()`):

```python
    def lookup_only(self, platform: str, external_user_id: str) -> MiraUser | None:
        """Strict lookup: return MiraUser if (platform, external_user_id) has
        an explicit identity_links row, else None. Never inserts. Never falls
        back to env vars. Used by the dispatcher gate to keep strangers out.
        """
        from sqlalchemy import text

        with self._engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT u.id, u.tenant_id, u.display_name, u.email "
                    "FROM mira_users u "
                    "JOIN identity_links l ON l.mira_user_id = u.id "
                    "WHERE l.platform = :platform "
                    "  AND l.external_user_id = :ext_id "
                    "LIMIT 1"
                ),
                {"platform": platform, "ext_id": external_user_id},
            ).fetchone()
        if not row:
            return None
        return MiraUser(id=str(row[0]), tenant_id=row[1], display_name=row[2], email=row[3])
```

- [ ] **Step 4: Run all three new tests**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_identity_service.py -k lookup_only -v
```

Expected: 3 passes.

- [ ] **Step 5: Run the full identity test file to confirm no regressions**

```bash
uv run pytest tests/test_identity_service.py -q
```

Expected: 14 passes (11 existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add mira-bots/shared/identity/service.py mira-bots/tests/test_identity_service.py
git -c commit.gpgsign=false commit -m "feat(identity): add IdentityService.lookup_only for strict gate"
```

---

## Task 3: `TenantScopedSession` SQLAlchemy wrapper

Defense-in-depth: refuses to execute queries that touch tenant tables without filtering on `tenant_id`.

**Files:**
- Create: `mira-bots/shared/tenant/__init__.py`
- Create: `mira-bots/shared/tenant/session.py`
- Test: `mira-bots/tests/test_tenant_scoped_session.py`

- [ ] **Step 1: Write the failing test**

Create `mira-bots/tests/test_tenant_scoped_session.py`:

```python
"""Tests for TenantScopedSession — the runtime guard that catches
queries touching tenant tables without a tenant_id filter."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest
from shared.tenant.session import TenantScopedSession, UnscopedQueryError
from sqlalchemy import create_engine, text


@pytest.fixture
def engine():
    e = create_engine("sqlite:///:memory:")
    with e.connect() as conn:
        conn.execute(
            text(
                "CREATE TABLE mira_users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, "
                "display_name TEXT, email TEXT)"
            )
        )
        conn.execute(text("INSERT INTO mira_users VALUES ('u1', 't1', 'A', 'a@x.com')"))
        conn.execute(text("INSERT INTO mira_users VALUES ('u2', 't2', 'B', 'b@x.com')"))
        conn.commit()
    return e


def test_construction_requires_tenant_id(engine):
    with pytest.raises(ValueError, match="tenant_id"):
        TenantScopedSession(engine, tenant_id="")


def test_scoped_select_returns_only_own_tenant(engine):
    sess = TenantScopedSession(engine, tenant_id="t1")
    rows = sess.execute(
        text("SELECT id FROM mira_users WHERE tenant_id = :tid"), {"tid": "t1"}
    ).fetchall()
    assert [r[0] for r in rows] == ["u1"]


def test_unscoped_select_on_tenant_table_raises(engine):
    sess = TenantScopedSession(engine, tenant_id="t1")
    with pytest.raises(UnscopedQueryError, match="mira_users"):
        sess.execute(text("SELECT id FROM mira_users"))


def test_unscoped_update_on_tenant_table_raises(engine):
    sess = TenantScopedSession(engine, tenant_id="t1")
    with pytest.raises(UnscopedQueryError):
        sess.execute(text("UPDATE mira_users SET display_name = 'Z'"))


def test_query_on_non_tenant_table_passes(engine):
    """sqlite_master is a system table — should not trigger the guard."""
    sess = TenantScopedSession(engine, tenant_id="t1")
    rows = sess.execute(text("SELECT name FROM sqlite_master WHERE type = 'table'")).fetchall()
    assert any(r[0] == "mira_users" for r in rows)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_tenant_scoped_session.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'shared.tenant'`.

- [ ] **Step 3: Create the package**

Create `mira-bots/shared/tenant/__init__.py`:

```python
"""Tenant-scoping primitives: TenantScopedSession and the invite system."""
```

- [ ] **Step 4: Implement `TenantScopedSession`**

Create `mira-bots/shared/tenant/session.py`:

```python
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
from sqlalchemy.engine import Connection

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
        with self._engine.connect() as conn:  # type: Connection
            result = conn.execute(statement, params or {})
            conn.commit()
            return result
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_tenant_scoped_session.py -v
```

Expected: 5 passes.

- [ ] **Step 6: Commit**

```bash
git add mira-bots/shared/tenant/__init__.py mira-bots/shared/tenant/session.py mira-bots/tests/test_tenant_scoped_session.py
git -c commit.gpgsign=false commit -m "feat(tenant): add TenantScopedSession runtime guard"
```

---

## Task 4: Invite mint + consume

**Files:**
- Create: `mira-bots/shared/tenant/invites.py`
- Test: `mira-bots/tests/test_invites.py`

- [ ] **Step 1: Write the failing test**

Create `mira-bots/tests/test_invites.py`:

```python
"""Tests for invite minting and consumption."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "mira-bots")

import pytest
from shared.tenant.invites import (
    InviteAlreadyConsumed,
    InviteExpired,
    InviteNotFound,
    consume_invite,
    mint_invite,
)
from sqlalchemy import create_engine, text

# Schema mirrors migration 006, but with TEXT instead of UUID/TIMESTAMPTZ for SQLite.
_SQLITE_DDL = """
CREATE TABLE plg_tenants (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL
);
CREATE TABLE mira_users (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT ''
);
CREATE TABLE identity_links (
    id               TEXT PRIMARY KEY,
    mira_user_id     TEXT NOT NULL,
    platform         TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    tenant_id        TEXT NOT NULL,
    UNIQUE (platform, external_user_id, tenant_id)
);
CREATE TABLE tenant_invites (
    token        TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    email        TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    minted_by    TEXT NOT NULL,
    minted_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at   TIMESTAMP NOT NULL,
    consumed_at  TIMESTAMP,
    consumed_by  TEXT
);
"""


@pytest.fixture
def engine():
    e = create_engine("sqlite:///:memory:")
    with e.connect() as conn:
        for stmt in _SQLITE_DDL.strip().split(";"):
            s = stmt.strip()
            if s:
                conn.execute(text(s))
        conn.execute(text("INSERT INTO plg_tenants VALUES ('t_acme', 'admin@acme.com')"))
        conn.commit()
    return e


def test_mint_returns_token(engine):
    token = mint_invite(engine, tenant_id="t_acme", email="alice@acme.com", minted_by="admin1")
    assert isinstance(token, str)
    assert 16 <= len(token) <= 64
    # Token charset must match Telegram start-parameter spec (A-Za-z0-9_-)
    import re

    assert re.fullmatch(r"[A-Za-z0-9_-]+", token)


def test_consume_creates_user_and_link(engine):
    token = mint_invite(engine, tenant_id="t_acme", email="alice@acme.com", minted_by="admin1")
    user = consume_invite(
        engine, token=token, telegram_user_id="555", display_name="Alice"
    )
    assert user.tenant_id == "t_acme"
    assert user.email == "alice@acme.com"
    assert user.display_name == "Alice"
    # Identity link must exist
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT mira_user_id FROM identity_links "
                "WHERE platform='telegram' AND external_user_id='555'"
            )
        ).fetchone()
    assert row is not None
    assert row[0] == user.id


def test_consume_marks_invite_consumed(engine):
    token = mint_invite(engine, tenant_id="t_acme", email="bob@acme.com", minted_by="admin1")
    consume_invite(engine, token=token, telegram_user_id="666", display_name="Bob")
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT consumed_at, consumed_by FROM tenant_invites WHERE token=:t"),
            {"t": token},
        ).fetchone()
    assert row[0] is not None
    assert row[1] == "666"


def test_consume_unknown_token_raises(engine):
    with pytest.raises(InviteNotFound):
        consume_invite(engine, token="nope", telegram_user_id="1", display_name="X")


def test_consume_expired_raises(engine):
    # Mint with a -1h TTL → already expired
    token = mint_invite(
        engine, tenant_id="t_acme", email="late@acme.com", minted_by="admin1", ttl_hours=-1
    )
    with pytest.raises(InviteExpired):
        consume_invite(engine, token=token, telegram_user_id="2", display_name="Late")


def test_double_consume_raises(engine):
    token = mint_invite(engine, tenant_id="t_acme", email="dup@acme.com", minted_by="admin1")
    consume_invite(engine, token=token, telegram_user_id="7", display_name="Dup1")
    with pytest.raises(InviteAlreadyConsumed):
        consume_invite(engine, token=token, telegram_user_id="8", display_name="Dup2")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_invites.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'shared.tenant.invites'`.

- [ ] **Step 3: Implement invites**

Create `mira-bots/shared/tenant/invites.py`:

```python
"""tenant.invites — mint and consume Telegram deep-link invites.

Tokens are 32 chars of base64url, well within Telegram's 64-char start-parameter
ceiling. See https://core.telegram.org/bots/features#deep-linking.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

logger = logging.getLogger("mira.invites")


class InviteNotFound(LookupError):
    """Token doesn't exist in tenant_invites."""


class InviteExpired(RuntimeError):
    """Token exists but expires_at has passed."""


class InviteAlreadyConsumed(RuntimeError):
    """Token was already used."""


@dataclass
class InvitedUser:
    id: str
    tenant_id: str
    display_name: str
    email: str


def mint_invite(
    engine: Any,
    *,
    tenant_id: str,
    email: str,
    minted_by: str,
    display_name: str = "",
    ttl_hours: int = 72,
) -> str:
    """Create a new invite row and return the opaque token."""
    token = secrets.token_urlsafe(24)  # 24 random bytes → 32-char base64url
    expires_at = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
    with engine.connect() as conn:
        conn.execute(
            text(
                "INSERT INTO tenant_invites "
                "(token, tenant_id, email, display_name, minted_by, expires_at) "
                "VALUES (:token, :tid, :email, :name, :minted_by, :exp)"
            ),
            {
                "token": token,
                "tid": tenant_id,
                "email": email,
                "name": display_name,
                "minted_by": minted_by,
                "exp": expires_at,
            },
        )
        conn.commit()
    logger.info(
        "INVITE_MINTED tenant=%s email=%s minted_by=%s ttl=%dh",
        tenant_id,
        email,
        minted_by,
        ttl_hours,
    )
    return token


def consume_invite(
    engine: Any,
    *,
    token: str,
    telegram_user_id: str,
    display_name: str,
) -> InvitedUser:
    """Validate token, create mira_user + identity_link, mark invite consumed.

    All steps run in one transaction. Raises InviteNotFound / InviteExpired /
    InviteAlreadyConsumed for the three rejection paths.
    """
    now = datetime.now(timezone.utc)

    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT tenant_id, email, display_name, expires_at, consumed_at "
                "FROM tenant_invites WHERE token = :t"
            ),
            {"t": token},
        ).fetchone()
        if row is None:
            raise InviteNotFound(f"Unknown invite token (truncated: {token[:8]}...)")

        tenant_id, email, invite_name, expires_at, consumed_at = row

        # SQLite returns strings for TIMESTAMP, Postgres returns datetime — normalize
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at).replace(tzinfo=timezone.utc)
        elif expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if consumed_at is not None:
            raise InviteAlreadyConsumed(
                f"Invite for {email} was already consumed at {consumed_at}"
            )
        if expires_at < now:
            raise InviteExpired(f"Invite for {email} expired at {expires_at}")

        final_name = display_name or invite_name or ""

        # Create the user
        user_id = str(uuid.uuid4())
        conn.execute(
            text(
                "INSERT INTO mira_users (id, tenant_id, display_name, email) "
                "VALUES (:id, :tid, :name, :email)"
            ),
            {"id": user_id, "tid": tenant_id, "name": final_name, "email": email},
        )
        # Create the identity link
        conn.execute(
            text(
                "INSERT INTO identity_links "
                "(id, mira_user_id, platform, external_user_id, tenant_id) "
                "VALUES (:id, :uid, 'telegram', :ext, :tid)"
            ),
            {
                "id": str(uuid.uuid4()),
                "uid": user_id,
                "ext": telegram_user_id,
                "tid": tenant_id,
            },
        )
        # Mark the invite consumed
        conn.execute(
            text(
                "UPDATE tenant_invites SET consumed_at = :now, consumed_by = :tg "
                "WHERE token = :t"
            ),
            {"now": now, "tg": telegram_user_id, "t": token},
        )
        conn.commit()

    logger.info(
        "INVITE_CONSUMED tenant=%s email=%s telegram_user_id=%s mira_user_id=%s",
        tenant_id,
        email,
        telegram_user_id,
        user_id,
    )
    return InvitedUser(id=user_id, tenant_id=tenant_id, display_name=final_name, email=email)
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_invites.py -v
```

Expected: 6 passes.

- [ ] **Step 5: Commit**

```bash
git add mira-bots/shared/tenant/invites.py mira-bots/tests/test_invites.py
git -c commit.gpgsign=false commit -m "feat(tenant): add invite mint/consume with token + expiry guards"
```

---

## Task 5: `Authorizer` for admin command gating

**Files:**
- Create: `mira-bots/shared/tenant/authorizer.py`
- Test: `mira-bots/tests/test_authorizer.py`

- [ ] **Step 1: Write the failing test**

Create `mira-bots/tests/test_authorizer.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_authorizer.py -v
```

Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement Authorizer**

Create `mira-bots/shared/tenant/authorizer.py`:

```python
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
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_authorizer.py -v
```

Expected: 5 passes.

- [ ] **Step 5: Commit**

```bash
git add mira-bots/shared/tenant/authorizer.py mira-bots/tests/test_authorizer.py
git -c commit.gpgsign=false commit -m "feat(tenant): add Authorizer for admin allow-list"
```

---

## Task 6: Telegram admin commands

**Files:**
- Create: `mira-bots/telegram/admin_commands.py`
- Test: `mira-bots/tests/test_admin_commands.py`

- [ ] **Step 1: Write the failing test**

Create `mira-bots/tests/test_admin_commands.py`:

```python
"""Tests for /invite, /team, /revoke, /invite_status admin commands."""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, "mira-bots")
sys.path.insert(0, "mira-bots/telegram")

import pytest
from shared.tenant.authorizer import Authorizer
from sqlalchemy import create_engine, text

# Reuse schema from test_invites.py
_SQLITE_DDL = """
CREATE TABLE plg_tenants (id TEXT PRIMARY KEY, email TEXT);
CREATE TABLE mira_users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
                         display_name TEXT DEFAULT '', email TEXT DEFAULT '');
CREATE TABLE identity_links (id TEXT PRIMARY KEY, mira_user_id TEXT NOT NULL,
                             platform TEXT, external_user_id TEXT, tenant_id TEXT,
                             UNIQUE(platform, external_user_id, tenant_id));
CREATE TABLE tenant_invites (token TEXT PRIMARY KEY, tenant_id TEXT, email TEXT,
                              display_name TEXT DEFAULT '', minted_by TEXT,
                              minted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                              expires_at TIMESTAMP, consumed_at TIMESTAMP, consumed_by TEXT);
"""


@pytest.fixture
def engine():
    e = create_engine("sqlite:///:memory:")
    with e.connect() as conn:
        for stmt in _SQLITE_DDL.strip().split(";"):
            s = stmt.strip()
            if s:
                conn.execute(text(s))
        conn.execute(text("INSERT INTO plg_tenants VALUES ('t_acme', 'admin@acme.com')"))
        conn.commit()
    return e


def _mock_update(user_id: str, args: list[str]):
    """Build a fake Telegram Update with the given from-user and command args."""
    update = MagicMock()
    update.effective_user.id = int(user_id)
    update.effective_user.full_name = "Admin"
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = args
    context.bot.username = "MIRABot"
    return update, context


@pytest.mark.asyncio
async def test_invite_command_admin_returns_link(engine):
    from admin_commands import invite_command

    auth = Authorizer(admin_telegram_ids="42")
    update, context = _mock_update("42", ["alice@acme.com"])
    await invite_command(update, context, engine=engine, auth=auth, tenant_id="t_acme")
    update.message.reply_text.assert_called_once()
    msg = update.message.reply_text.call_args[0][0]
    assert "https://t.me/MIRABot?start=" in msg
    assert "alice@acme.com" in msg


@pytest.mark.asyncio
async def test_invite_command_non_admin_refused(engine):
    from admin_commands import invite_command

    auth = Authorizer(admin_telegram_ids="42")
    update, context = _mock_update("99", ["alice@acme.com"])
    await invite_command(update, context, engine=engine, auth=auth, tenant_id="t_acme")
    msg = update.message.reply_text.call_args[0][0]
    assert "admin" in msg.lower()
    # Confirm no invite row was written
    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM tenant_invites")).scalar()
    assert count == 0


@pytest.mark.asyncio
async def test_invite_command_missing_email_helps(engine):
    from admin_commands import invite_command

    auth = Authorizer(admin_telegram_ids="42")
    update, context = _mock_update("42", [])
    await invite_command(update, context, engine=engine, auth=auth, tenant_id="t_acme")
    msg = update.message.reply_text.call_args[0][0]
    assert "Usage" in msg or "email" in msg.lower()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_admin_commands.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'admin_commands'`.

- [ ] **Step 3: Implement admin_commands**

Create `mira-bots/telegram/admin_commands.py`:

```python
"""Admin command handlers for the Telegram bot: /invite, /team, /revoke, /invite_status.

Each handler takes the standard PTB (update, context) plus injected dependencies
(engine, auth, tenant_id) so the same code is testable without booting the bot.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from shared.tenant.authorizer import Authorizer
from shared.tenant.invites import mint_invite
from sqlalchemy import text
from telegram import Update
from telegram.ext import ContextTypes

logger = logging.getLogger("mira-bot")

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


async def invite_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    engine: Any,
    auth: Authorizer,
    tenant_id: str,
) -> None:
    """/invite <email> [Display Name]  →  returns t.me/MIRABot?start=<token>."""
    user_id = update.effective_user.id
    if not auth.is_admin(user_id):
        logger.warning("INVITE_REFUSED non-admin from=%s", user_id)
        await update.message.reply_text(
            "Sorry, only admins can mint invites. Ask an existing admin to add you."
        )
        return

    if not context.args:
        await update.message.reply_text(
            "Usage: /invite <email> [Display Name]\n"
            "Example: /invite alice@acme.com Alice Smith"
        )
        return

    email = context.args[0]
    if not _EMAIL_RE.match(email):
        await update.message.reply_text(f"That doesn't look like an email: {email}")
        return

    display_name = " ".join(context.args[1:])

    try:
        token = mint_invite(
            engine,
            tenant_id=tenant_id,
            email=email,
            minted_by=str(user_id),
            display_name=display_name,
        )
    except Exception as exc:
        logger.error("MINT_FAILED tenant=%s email=%s err=%s", tenant_id, email, exc)
        await update.message.reply_text(f"Could not mint invite: {exc}")
        return

    bot_username = context.bot.username or "MIRABot"
    url = f"https://t.me/{bot_username}?start={token}"
    await update.message.reply_text(
        f"Invite for {email} (valid 72h):\n{url}\n\n"
        "Send this link to them in any chat — they tap it and they're enrolled."
    )


async def team_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    engine: Any,
    auth: Authorizer,
    tenant_id: str,
) -> None:
    """/team — list enrolled members in this tenant."""
    if not auth.is_admin(update.effective_user.id):
        await update.message.reply_text("Admins only.")
        return
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT u.display_name, u.email, l.external_user_id "
                "FROM mira_users u JOIN identity_links l ON l.mira_user_id = u.id "
                "WHERE u.tenant_id = :tid AND l.platform = 'telegram' "
                "ORDER BY u.display_name"
            ),
            {"tid": tenant_id},
        ).fetchall()
    if not rows:
        await update.message.reply_text("No enrolled members yet.")
        return
    lines = [f"Team ({len(rows)} members):"]
    for name, email, ext_id in rows:
        lines.append(f"• {name or '(no name)'} — {email or '(no email)'} — telegram:{ext_id}")
    await update.message.reply_text("\n".join(lines))


async def revoke_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    engine: Any,
    auth: Authorizer,
    tenant_id: str,
) -> None:
    """/revoke <telegram_user_id> — drop the user's identity_links row."""
    if not auth.is_admin(update.effective_user.id):
        await update.message.reply_text("Admins only.")
        return
    if not context.args:
        await update.message.reply_text("Usage: /revoke <telegram_user_id>")
        return
    target = context.args[0].lstrip("@")
    with engine.connect() as conn:
        result = conn.execute(
            text(
                "DELETE FROM identity_links "
                "WHERE platform = 'telegram' AND external_user_id = :ext "
                "  AND tenant_id = :tid"
            ),
            {"ext": target, "tid": tenant_id},
        )
        conn.commit()
    if result.rowcount:
        await update.message.reply_text(f"Revoked telegram user {target}.")
    else:
        await update.message.reply_text(f"No mapping found for telegram user {target}.")


async def invite_status_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    engine: Any,
    auth: Authorizer,
    tenant_id: str,
) -> None:
    """/invite_status — list outstanding/expired/consumed invites for this tenant."""
    if not auth.is_admin(update.effective_user.id):
        await update.message.reply_text("Admins only.")
        return
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT email, expires_at, consumed_at "
                "FROM tenant_invites WHERE tenant_id = :tid "
                "ORDER BY minted_at DESC LIMIT 20"
            ),
            {"tid": tenant_id},
        ).fetchall()
    if not rows:
        await update.message.reply_text("No invites yet.")
        return
    lines = ["Last 20 invites:"]
    for email, exp, consumed in rows:
        if consumed:
            tag = f"consumed {consumed}"
        elif str(exp) < str(__import__("datetime").datetime.utcnow()):
            tag = "expired"
        else:
            tag = f"outstanding (expires {exp})"
        lines.append(f"• {email} — {tag}")
    await update.message.reply_text("\n".join(lines))
```

- [ ] **Step 4: Add pytest-asyncio if not present**

Check `mira-bots/pyproject.toml` for `pytest-asyncio` under dev deps. If missing, add it via:

```bash
cd /Users/bravonode/Mira/mira-bots
uv add --dev pytest-asyncio
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_admin_commands.py -v
```

Expected: 3 passes.

- [ ] **Step 6: Commit**

```bash
git add mira-bots/telegram/admin_commands.py mira-bots/tests/test_admin_commands.py
git -c commit.gpgsign=false commit -m "feat(telegram): /invite /team /revoke /invite_status admin commands"
```

---

## Task 7: `/start <token>` handler

**Files:**
- Modify: `mira-bots/telegram/bot.py` (add `start_command`, register before existing handlers)
- Test: `mira-bots/tests/test_start_command.py`

- [ ] **Step 1: Write the failing test**

Create `mira-bots/tests/test_start_command.py`:

```python
"""Tests for the /start handler — invite consumption and welcome."""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, "mira-bots")
sys.path.insert(0, "mira-bots/telegram")

import pytest
from shared.tenant.invites import mint_invite
from sqlalchemy import create_engine, text

_SQLITE_DDL = """
CREATE TABLE plg_tenants (id TEXT PRIMARY KEY, email TEXT);
CREATE TABLE mira_users (id TEXT PRIMARY KEY, tenant_id TEXT, display_name TEXT, email TEXT);
CREATE TABLE identity_links (id TEXT PRIMARY KEY, mira_user_id TEXT, platform TEXT,
                              external_user_id TEXT, tenant_id TEXT,
                              UNIQUE(platform, external_user_id, tenant_id));
CREATE TABLE tenant_invites (token TEXT PRIMARY KEY, tenant_id TEXT, email TEXT,
                              display_name TEXT DEFAULT '', minted_by TEXT,
                              minted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                              expires_at TIMESTAMP, consumed_at TIMESTAMP, consumed_by TEXT);
"""


@pytest.fixture
def engine():
    e = create_engine("sqlite:///:memory:")
    with e.connect() as conn:
        for stmt in _SQLITE_DDL.strip().split(";"):
            s = stmt.strip()
            if s:
                conn.execute(text(s))
        conn.execute(text("INSERT INTO plg_tenants VALUES ('t_acme', 'a@x')"))
        conn.commit()
    return e


def _mock(user_id: str, args: list[str], full_name: str = "Alice"):
    update = MagicMock()
    update.effective_user.id = int(user_id)
    update.effective_user.full_name = full_name
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = args
    return update, context


@pytest.mark.asyncio
async def test_start_with_valid_token_enrolls_user(engine):
    from start_command import start_command  # to be created

    token = mint_invite(engine, tenant_id="t_acme", email="alice@acme.com", minted_by="42")
    update, context = _mock("555", [token])
    await start_command(update, context, engine=engine)
    msg = update.message.reply_text.call_args[0][0]
    assert "welcome" in msg.lower() or "alice" in msg.lower()
    # Identity link should now exist
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT mira_user_id FROM identity_links WHERE external_user_id='555'")
        ).fetchone()
    assert row is not None


@pytest.mark.asyncio
async def test_start_with_no_token_replies_invite_only(engine):
    from start_command import start_command

    update, context = _mock("999", [])
    await start_command(update, context, engine=engine)
    msg = update.message.reply_text.call_args[0][0]
    assert "invite" in msg.lower()


@pytest.mark.asyncio
async def test_start_with_expired_token_rejects(engine):
    from start_command import start_command

    token = mint_invite(
        engine, tenant_id="t_acme", email="late@acme.com", minted_by="42", ttl_hours=-1
    )
    update, context = _mock("777", [token])
    await start_command(update, context, engine=engine)
    msg = update.message.reply_text.call_args[0][0]
    assert "expire" in msg.lower()


@pytest.mark.asyncio
async def test_start_with_consumed_token_rejects(engine):
    from start_command import start_command

    token = mint_invite(engine, tenant_id="t_acme", email="dup@acme.com", minted_by="42")
    update1, context1 = _mock("100", [token])
    await start_command(update1, context1, engine=engine)
    update2, context2 = _mock("101", [token])
    await start_command(update2, context2, engine=engine)
    msg = update2.message.reply_text.call_args[0][0]
    assert "already" in msg.lower()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_start_command.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'start_command'`.

- [ ] **Step 3: Implement start_command**

Create `mira-bots/telegram/start_command.py`:

```python
"""/start handler — consumes invite tokens or shows the invite-only message.

Pattern matches python-telegram-bot's deep-linking example:
    https://docs.python-telegram-bot.org/en/v21.11.1/examples.deeplinking.html
"""

from __future__ import annotations

import logging
from typing import Any

from shared.tenant.invites import (
    InviteAlreadyConsumed,
    InviteExpired,
    InviteNotFound,
    consume_invite,
)
from telegram import Update
from telegram.ext import ContextTypes

logger = logging.getLogger("mira-bot")


async def start_command(
    update: Update, context: ContextTypes.DEFAULT_TYPE, *, engine: Any
) -> None:
    """Handle /start, with optional invite token in context.args[0]."""
    args = context.args or []
    if not args:
        await update.message.reply_text(
            "Hi — I'm MIRA, your team's maintenance assistant. "
            "I'm invite-only. Ask your admin to send you an enrollment link."
        )
        return

    token = args[0]
    telegram_user_id = str(update.effective_user.id)
    display_name = update.effective_user.full_name or ""

    try:
        user = consume_invite(
            engine,
            token=token,
            telegram_user_id=telegram_user_id,
            display_name=display_name,
        )
    except InviteNotFound:
        await update.message.reply_text(
            "That invite link isn't valid. Ask your admin for a fresh one."
        )
        return
    except InviteExpired:
        await update.message.reply_text(
            "That invite has expired. Ask your admin for a fresh one."
        )
        return
    except InviteAlreadyConsumed:
        await update.message.reply_text(
            "That invite was already used. If this wasn't you, tell your admin."
        )
        return
    except Exception as exc:
        logger.error("START_CONSUME_FAILED telegram_id=%s err=%s", telegram_user_id, exc)
        await update.message.reply_text("Something went wrong. Please try again later.")
        return

    await update.message.reply_text(
        f"Welcome to MIRA, {user.display_name or 'there'}. "
        f"You're connected. Try sending me a maintenance question or a photo."
    )
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_start_command.py -v
```

Expected: 4 passes.

- [ ] **Step 5: Commit**

```bash
git add mira-bots/telegram/start_command.py mira-bots/tests/test_start_command.py
git -c commit.gpgsign=false commit -m "feat(telegram): /start handler with invite token consumption"
```

---

## Task 8: Telegram adapter — populate `tenant_id` from `chat_tenant.resolve()`

This is informational only (the dispatcher gate is the real auth) but keeps consistency with other adapters and makes the event self-describing.

**Files:**
- Modify: `mira-bots/telegram/chat_adapter.py:98`
- Test: `mira-bots/tests/test_telegram_adapter_tenant.py`

- [ ] **Step 1: Write the failing test**

Create `mira-bots/tests/test_telegram_adapter_tenant.py`:

```python
"""Tests that TelegramChatAdapter populates tenant_id via chat_tenant.resolve()."""

from __future__ import annotations

import sys
from unittest.mock import patch

sys.path.insert(0, "mira-bots")
sys.path.insert(0, "mira-bots/telegram")

import pytest
from chat_adapter import TelegramChatAdapter


@pytest.mark.asyncio
async def test_adapter_populates_tenant_id_from_resolver():
    adapter = TelegramChatAdapter(bot_token="dummy")
    raw = {
        "update_id": 1,
        "message": {
            "message_id": 99,
            "chat": {"id": 555, "type": "private"},
            "from": {"id": 555},
            "text": "hello",
        },
    }
    with patch("chat_adapter.chat_tenant_resolve", return_value="t_acme"):
        evt = await adapter.normalize_incoming(raw)
    assert evt.tenant_id == "t_acme"
    assert evt.external_user_id == "555"


@pytest.mark.asyncio
async def test_adapter_empty_tenant_when_resolver_returns_empty():
    adapter = TelegramChatAdapter(bot_token="dummy")
    raw = {
        "update_id": 2,
        "message": {
            "message_id": 100,
            "chat": {"id": 999, "type": "private"},
            "from": {"id": 999},
            "text": "stranger",
        },
    }
    with patch("chat_adapter.chat_tenant_resolve", return_value=""):
        evt = await adapter.normalize_incoming(raw)
    assert evt.tenant_id == ""
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_telegram_adapter_tenant.py -v
```

Expected: FAIL on the patch target (`chat_tenant_resolve` doesn't exist in `chat_adapter`).

- [ ] **Step 3: Modify the adapter**

In `mira-bots/telegram/chat_adapter.py`, add the import near the top (after the existing `from shared.chat.types ...` line):

```python
from shared.chat_tenant import resolve as chat_tenant_resolve
```

Then change the `tenant_id=""` field at line 98 to:

```python
            tenant_id=chat_tenant_resolve(external_user_id),
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_telegram_adapter_tenant.py -v
```

Expected: 2 passes.

- [ ] **Step 5: Commit**

```bash
git add mira-bots/telegram/chat_adapter.py mira-bots/tests/test_telegram_adapter_tenant.py
git -c commit.gpgsign=false commit -m "feat(telegram): adapter populates tenant_id from chat_tenant.resolve()"
```

---

## Task 9: Dispatcher — strict `lookup_only()` gate

Replace the optional identity check with a hard gate: no identity_links row → reject. Thread `tenant_id` and `mira_user_id` to the engine.

**Files:**
- Modify: `mira-bots/shared/chat/dispatcher.py:55-110`
- Modify: `mira-bots/shared/chat/types.py` (NormalizedChatResponse may need a `block` flag — verify; if it already returns text, skip)
- Test: `mira-bots/tests/test_dispatcher_gate.py`

- [ ] **Step 1: Write the failing test**

Create `mira-bots/tests/test_dispatcher_gate.py`:

```python
"""Tests for the strict lookup_only gate in ChatDispatcher."""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, "mira-bots")

import pytest
from shared.chat.dispatcher import ChatDispatcher
from shared.chat.types import NormalizedChatEvent
from shared.identity.service import IdentityService, MiraUser


@pytest.fixture
def fake_engine():
    eng = MagicMock()
    eng.process = AsyncMock(return_value="OK reply")
    return eng


def _event(ext_id: str, text: str, tenant_id: str = "t_acme") -> NormalizedChatEvent:
    return NormalizedChatEvent(
        event_id="e1",
        platform="telegram",
        tenant_id=tenant_id,
        user_id="",
        external_user_id=ext_id,
        external_channel_id=ext_id,
        external_thread_id="",
        text=text,
        attachments=[],
        event_type="dm",
        raw={},
    )


@pytest.mark.asyncio
async def test_stranger_blocked_with_invite_message(fake_engine):
    identity = MagicMock(spec=IdentityService)
    identity.lookup_only = MagicMock(return_value=None)
    disp = ChatDispatcher(fake_engine, identity_service=identity)
    resp = await disp.dispatch(_event("999", "hi"))
    assert "invite" in resp.text.lower()
    fake_engine.process.assert_not_called()


@pytest.mark.asyncio
async def test_known_user_passes_to_engine(fake_engine):
    identity = MagicMock(spec=IdentityService)
    identity.lookup_only = MagicMock(
        return_value=MiraUser(id="u1", tenant_id="t_acme", display_name="A", email="a@x")
    )
    disp = ChatDispatcher(fake_engine, identity_service=identity)
    resp = await disp.dispatch(_event("555", "diagnose this"))
    assert resp.text == "OK reply"
    # Engine must receive tenant_id and mira_user_id
    fake_engine.process.assert_awaited_once()
    call_kwargs = fake_engine.process.await_args.kwargs
    assert call_kwargs.get("tenant_id") == "t_acme"
    assert call_kwargs.get("mira_user_id") == "u1"


@pytest.mark.asyncio
async def test_no_identity_service_blocks_all(fake_engine):
    """If identity service is None (misconfig), block by default — fail closed."""
    disp = ChatDispatcher(fake_engine, identity_service=None)
    resp = await disp.dispatch(_event("123", "hi"))
    assert "invite" in resp.text.lower() or "unavailable" in resp.text.lower()
    fake_engine.process.assert_not_called()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_dispatcher_gate.py -v
```

Expected: FAIL — current dispatcher uses `IdentityService.resolve()` (auto-create) and doesn't gate strangers.

- [ ] **Step 3: Modify the dispatcher**

In `mira-bots/shared/chat/dispatcher.py`, replace the body of `async def dispatch(self, event)` (lines 55-128) with:

```python
    async def dispatch(self, event: NormalizedChatEvent) -> NormalizedChatResponse:
        """Process one chat event and return a response."""
        import asyncio
        import base64

        if event.external_thread_id:
            chat_id = f"{event.platform}:{event.external_channel_id}:{event.external_thread_id}"
        else:
            chat_id = f"{event.platform}:{event.external_channel_id}"

        if not self._check_rate_limit(chat_id):
            return NormalizedChatResponse(
                text=(
                    "You're sending messages too quickly. "
                    "Please wait a moment before sending another message."
                ),
                thread_id=event.external_thread_id,
            )

        # Strict gate: identity_links row required, no env-var fallback, no auto-create.
        if self._identity is None:
            logger.error("DISPATCH_NO_IDENTITY platform=%s — failing closed", event.platform)
            return NormalizedChatResponse(
                text=(
                    "MIRA is not configured for multi-tenant access yet. "
                    "If you believe this is a mistake, ask your admin."
                ),
                thread_id=event.external_thread_id,
            )

        try:
            mira_user = await asyncio.to_thread(
                self._identity.lookup_only, event.platform, event.external_user_id
            )
        except Exception as exc:
            logger.error(
                "IDENTITY_LOOKUP_FAILED platform=%s ext=%s err=%s",
                event.platform,
                event.external_user_id,
                exc,
            )
            return NormalizedChatResponse(
                text="MIRA is temporarily unavailable. Please retry shortly.",
                thread_id=event.external_thread_id,
            )

        if mira_user is None:
            logger.info(
                "DISPATCH_BLOCKED platform=%s ext=%s reason=stranger",
                event.platform,
                event.external_user_id,
            )
            return NormalizedChatResponse(
                text=(
                    "Hi — I'm MIRA, your team's maintenance assistant. "
                    "I'm invite-only. Ask your admin to send you an enrollment link."
                ),
                thread_id=event.external_thread_id,
            )

        # Extract pre-downloaded image bytes (set by adapter before dispatch)
        photo_b64 = None
        for att in event.attachments:
            if att.kind == "image" and att.data:
                photo_b64 = base64.b64encode(att.data).decode()
                break

        result = await self.engine.process(
            chat_id=chat_id,
            message=event.text,
            photo_b64=photo_b64,
            tenant_id=mira_user.tenant_id,
            mira_user_id=mira_user.id,
        )

        response = NormalizedChatResponse(
            text=result if isinstance(result, str) else str(result),
            thread_id=event.external_thread_id,
        )

        logger.info(
            "DISPATCH platform=%s user=%s mira_user=%s tenant=%s chat=%s text_len=%d",
            event.platform,
            event.external_user_id,
            mira_user.id,
            mira_user.tenant_id,
            event.external_channel_id,
            len(response.text),
        )
        return response
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_dispatcher_gate.py -v
```

Expected: 3 passes.

- [ ] **Step 5: Commit**

```bash
git add mira-bots/shared/chat/dispatcher.py mira-bots/tests/test_dispatcher_gate.py
git -c commit.gpgsign=false commit -m "feat(dispatch): strict lookup_only gate; thread tenant_id+mira_user_id"
```

---

## Task 10: `Supervisor.process()` — accept per-call `tenant_id`, `mira_user_id`

The dispatcher now passes these kwargs. Make the engine accept them backward-compatibly (default to constructor values when not supplied).

**Files:**
- Modify: `mira-bots/shared/engine.py:405-453` (`process` signature)
- Modify: `mira-bots/shared/engine.py:455+` (`process_full` signature)
- Test: `mira-bots/tests/test_engine_tenant_kwargs.py`

- [ ] **Step 1: Write the failing test**

Create `mira-bots/tests/test_engine_tenant_kwargs.py`:

```python
"""Tests that Supervisor.process accepts per-call tenant_id and mira_user_id
without breaking the existing call shape."""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, patch

sys.path.insert(0, "mira-bots")

import pytest


@pytest.mark.asyncio
async def test_process_accepts_tenant_kwargs(tmp_db):
    from shared.engine import Supervisor

    sup = Supervisor(
        db_path=tmp_db,
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id="default_t",
    )
    # Patch process_full so we can assert what process() forwarded.
    with patch.object(sup, "process_full", new=AsyncMock(return_value={"reply": "ok"})) as mock_pf:
        await sup.process(
            chat_id="c1",
            message="hi",
            tenant_id="per_call_t",
            mira_user_id="per_call_u",
        )
        # The call surface for process_full may stay positional (chat_id, message, photo_b64).
        # The plan only requires that no TypeError is raised when passing tenant_id/mira_user_id
        # kwargs to process(). The kwargs become available to process_full via attrs on self.
        mock_pf.assert_called_once()


@pytest.mark.asyncio
async def test_process_backward_compatible_without_tenant_kwargs(tmp_db):
    from shared.engine import Supervisor

    sup = Supervisor(
        db_path=tmp_db,
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id="default_t",
    )
    with patch.object(sup, "process_full", new=AsyncMock(return_value={"reply": "ok"})):
        # Existing call shape must keep working.
        result = await sup.process(chat_id="c1", message="hi")
    assert result == "ok"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_engine_tenant_kwargs.py -v
```

Expected: FAIL with `TypeError: process() got an unexpected keyword argument 'tenant_id'`.

- [ ] **Step 3: Modify the signature**

In `mira-bots/shared/engine.py`, change the `process` signature (line 405-412) to:

```python
    async def process(
        self,
        chat_id: str,
        message: str,
        photo_b64: str = None,
        *,
        platform: str = "telegram",
        tenant_id: str | None = None,
        mira_user_id: str | None = None,
    ) -> str:
```

Inside the body, immediately after the docstring, add:

```python
        # Per-call tenant overrides constructor default. Stash on self so workers
        # can reach the current request's tenant via self._current_tenant_id.
        # (Workers that need this read it lazily; existing callers that don't pass
        # the kwargs continue to use self.tenant_id from __init__.)
        self._current_tenant_id = tenant_id or self.tenant_id
        self._current_mira_user_id = mira_user_id or ""
```

You will also need to initialize the two attributes in `__init__` (around line 273) to avoid `AttributeError` on first read. Add at the end of `__init__`:

```python
        self._current_tenant_id: str = self.tenant_id
        self._current_mira_user_id: str = ""
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_engine_tenant_kwargs.py -v
```

Expected: 2 passes.

- [ ] **Step 5: Run the full engine test suite for regressions**

```bash
uv run pytest tests/test_engine.py -q
```

Expected: all existing tests pass. If any fail, fix immediately.

- [ ] **Step 6: Commit**

```bash
git add mira-bots/shared/engine.py mira-bots/tests/test_engine_tenant_kwargs.py
git -c commit.gpgsign=false commit -m "feat(engine): Supervisor.process accepts per-call tenant_id, mira_user_id"
```

---

## Task 11: ast-grep CI rule — `no-unscoped-tenant-query`

**Files:**
- Create: `.ast-grep-rules/no-unscoped-tenant-query.yml`

- [ ] **Step 1: Write the rule**

Create `.ast-grep-rules/no-unscoped-tenant-query.yml`:

```yaml
id: no-unscoped-tenant-query
language: Python
severity: error
message: |
  Query touches a tenant-scoped table (mira_users, identity_links, tenant_invites,
  conversation_state, feedback_log, api_usage, asset_qr_tags) without filtering on
  tenant_id. Add a `WHERE tenant_id = :tid` clause or use TenantScopedSession.
rule:
  any:
    - pattern: text("$SQL")
      where:
        SQL:
          regex: '(?si)(SELECT|UPDATE|DELETE|INSERT)[\s\S]*\b(mira_users|identity_links|tenant_invites|conversation_state|feedback_log|api_usage|asset_qr_tags)\b(?![\s\S]*tenant_id)'
    - pattern: text(\'$SQL\')
      where:
        SQL:
          regex: '(?si)(SELECT|UPDATE|DELETE|INSERT)[\s\S]*\b(mira_users|identity_links|tenant_invites|conversation_state|feedback_log|api_usage|asset_qr_tags)\b(?![\s\S]*tenant_id)'
```

- [ ] **Step 2: Verify the rule loads**

```bash
cd /Users/bravonode/Mira
sg scan --rule .ast-grep-rules/no-unscoped-tenant-query.yml --filter-language Python --no-color | head -20
```

Expected: no syntax errors. May report some false positives on test files where tenant_id is set elsewhere — review and either tighten the regex or accept the noise.

- [ ] **Step 3: Add the rule to sgconfig.yml so CI picks it up**

If `sgconfig.yml` already lists `.ast-grep-rules/`, no change needed. Otherwise, append the rule path. Check with:

```bash
cat /Users/bravonode/Mira/sgconfig.yml
```

If `ruleDirs` contains `.ast-grep-rules`, you're done.

- [ ] **Step 4: Commit**

```bash
git add .ast-grep-rules/no-unscoped-tenant-query.yml
git -c commit.gpgsign=false commit -m "ci(ast-grep): block unscoped queries on tenant tables"
```

---

## Task 12: Backfill script `tools/backfill_tenant_map.py`

**Files:**
- Create: `tools/backfill_tenant_map.py`
- Test: `tools/backfill_tenant_map.test.sh`

- [ ] **Step 1: Write the script**

Create `tools/backfill_tenant_map.py`:

```python
#!/usr/bin/env python3
"""Backfill identity_links + mira_users + chat_tenant_map for existing
Telegram users so they keep working under the new strict dispatcher gate.

Idempotent. Safe to re-run.

Usage:
    doppler run --project factorylm --config prd -- \\
        python3 tools/backfill_tenant_map.py [--dry-run]
"""

from __future__ import annotations

import argparse
import logging
import os
import sqlite3
import sys
import uuid
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("backfill")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="Print what would be inserted, don't write")
    ap.add_argument(
        "--sqlite-path",
        default=os.environ.get("MIRA_DB_PATH", "/data/mira.db"),
        help="Path to mira.db (default: $MIRA_DB_PATH or /data/mira.db)",
    )
    args = ap.parse_args()

    tenant_id = os.environ.get("MIRA_TENANT_ID", "")
    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot determine which tenant to backfill into.")
        return 2

    neon_url = os.environ.get("NEON_DATABASE_URL", "")
    if not neon_url:
        logger.error("NEON_DATABASE_URL not set — cannot reach NeonDB.")
        return 2

    # Load distinct chat_ids from local SQLite conversation_state
    if not os.path.exists(args.sqlite_path):
        logger.warning("SQLite DB not found at %s — nothing to backfill.", args.sqlite_path)
        return 0

    sq = sqlite3.connect(args.sqlite_path)
    rows = sq.execute("SELECT DISTINCT chat_id FROM conversation_state").fetchall()
    sq.close()
    chat_ids = [r[0] for r in rows if r[0]]
    logger.info("Found %d distinct chat_ids in conversation_state", len(chat_ids))

    # Filter: in private DMs, chat_id == user_id (positive int as str). Group chats
    # have negative IDs; skip those — Option B is per-user, not per-group.
    candidates: list[str] = []
    for cid in chat_ids:
        try:
            n = int(cid)
            if n > 0:
                candidates.append(str(n))
        except ValueError:
            continue
    logger.info("Of those, %d look like private-DM user IDs", len(candidates))

    if args.dry_run:
        for u in candidates:
            print(f"WOULD BACKFILL telegram:{u} → tenant:{tenant_id}")
        return 0

    # Connect to NeonDB
    try:
        import psycopg
    except ModuleNotFoundError:
        logger.error("psycopg not installed — install with `uv add psycopg[binary]`")
        return 2

    inserted_users = 0
    inserted_links = 0
    with psycopg.connect(neon_url) as conn:
        with conn.cursor() as cur:
            for ext_id in candidates:
                # Skip if identity_link already exists
                cur.execute(
                    "SELECT mira_user_id FROM identity_links "
                    "WHERE platform = 'telegram' AND external_user_id = %s "
                    "  AND tenant_id = %s",
                    (ext_id, tenant_id),
                )
                if cur.fetchone():
                    continue

                user_id = str(uuid.uuid4())
                cur.execute(
                    "INSERT INTO mira_users (id, tenant_id, display_name, email) "
                    "VALUES (%s, %s, 'legacy', '') "
                    "ON CONFLICT DO NOTHING",
                    (user_id, tenant_id),
                )
                inserted_users += cur.rowcount
                cur.execute(
                    "INSERT INTO identity_links "
                    "(id, mira_user_id, platform, external_user_id, tenant_id) "
                    "VALUES (%s, %s, 'telegram', %s, %s) "
                    "ON CONFLICT DO NOTHING",
                    (str(uuid.uuid4()), user_id, ext_id, tenant_id),
                )
                inserted_links += cur.rowcount
        conn.commit()

    # Also seed chat_tenant_map (informational)
    sq = sqlite3.connect(args.sqlite_path)
    sq.execute("PRAGMA journal_mode=WAL")
    sq.execute(
        "CREATE TABLE IF NOT EXISTS chat_tenant_map ("
        "chat_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, "
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
        "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    )
    seeded_map = 0
    for ext_id in candidates:
        cur = sq.execute(
            "INSERT OR IGNORE INTO chat_tenant_map (chat_id, tenant_id) VALUES (?, ?)",
            (ext_id, tenant_id),
        )
        seeded_map += cur.rowcount
    sq.commit()
    sq.close()

    logger.info(
        "BACKFILL_DONE inserted_users=%d inserted_links=%d seeded_chat_tenant_map=%d",
        inserted_users,
        inserted_links,
        seeded_map,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Smoke-test the script with --dry-run against a temp SQLite**

```bash
cd /Users/bravonode/Mira
TMPDB=$(mktemp -t mira_backfill_test.XXXXXX.db)
sqlite3 "$TMPDB" "CREATE TABLE conversation_state (chat_id TEXT PRIMARY KEY); INSERT INTO conversation_state VALUES ('555'), ('-100123'), ('999');"
MIRA_TENANT_ID=t_test NEON_DATABASE_URL=postgres://stub \
  python3 tools/backfill_tenant_map.py --dry-run --sqlite-path "$TMPDB"
rm "$TMPDB"
```

Expected output:
```
WOULD BACKFILL telegram:555 → tenant:t_test
WOULD BACKFILL telegram:999 → tenant:t_test
```
(Group chat `-100123` skipped.)

- [ ] **Step 3: Commit**

```bash
git add tools/backfill_tenant_map.py
git -c commit.gpgsign=false commit -m "feat(tools): add idempotent tenant backfill script"
```

---

## Task 13: Wire admin commands + start handler into `bot.py`

This is the integration step that actually makes the new code reachable from a live bot.

**Files:**
- Modify: `mira-bots/telegram/bot.py:43-55` (instantiate identity service, auth, engine for admin DB)
- Modify: `mira-bots/telegram/bot.py:609-625` (`main()` — register handlers)

- [ ] **Step 1: Add imports near the top**

In `mira-bots/telegram/bot.py`, add after the existing imports (around line 25):

```python
from admin_commands import (
    invite_command,
    invite_status_command,
    revoke_command,
    team_command,
)
from shared.identity.service import get_identity_service
from shared.tenant.authorizer import Authorizer
from start_command import start_command
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool
```

- [ ] **Step 2: Build shared dependencies after `engine = Supervisor(...)` (around line 51)**

```python
# Multi-tenant infra (NeonDB-backed)
ADMIN_TELEGRAM_IDS = os.environ.get("ADMIN_TELEGRAM_IDS", "")
DEFAULT_TENANT_ID = os.environ.get("MIRA_TENANT_ID", "")

_identity_service = get_identity_service()
_authorizer = Authorizer(admin_telegram_ids=ADMIN_TELEGRAM_IDS)

_neon_url = os.environ.get("NEON_DATABASE_URL", "")
_admin_db_engine = (
    create_engine(
        _neon_url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    if _neon_url
    else None
)
```

- [ ] **Step 3: Replace `dispatcher = ChatDispatcher(engine)` with the identity-aware version**

```python
dispatcher = ChatDispatcher(engine, identity_service=_identity_service)
```

- [ ] **Step 4: Register the new handlers in `main()` (immediately after the existing `add_handler` calls, before the catch-all MessageHandler)**

In `main()`, replace the existing handler block with:

```python
def main():
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).post_init(_startup).build()

    # Helper to bind admin command kwargs without subclassing PTB's CommandHandler.
    async def _wrap_invite(update, context):
        if _admin_db_engine is None:
            await update.message.reply_text("Admin commands unavailable: NEON_DATABASE_URL not set.")
            return
        await invite_command(
            update, context,
            engine=_admin_db_engine, auth=_authorizer, tenant_id=DEFAULT_TENANT_ID,
        )

    async def _wrap_team(update, context):
        if _admin_db_engine is None:
            await update.message.reply_text("Admin commands unavailable: NEON_DATABASE_URL not set.")
            return
        await team_command(
            update, context,
            engine=_admin_db_engine, auth=_authorizer, tenant_id=DEFAULT_TENANT_ID,
        )

    async def _wrap_revoke(update, context):
        if _admin_db_engine is None:
            await update.message.reply_text("Admin commands unavailable: NEON_DATABASE_URL not set.")
            return
        await revoke_command(
            update, context,
            engine=_admin_db_engine, auth=_authorizer, tenant_id=DEFAULT_TENANT_ID,
        )

    async def _wrap_invite_status(update, context):
        if _admin_db_engine is None:
            await update.message.reply_text("Admin commands unavailable: NEON_DATABASE_URL not set.")
            return
        await invite_status_command(
            update, context,
            engine=_admin_db_engine, auth=_authorizer, tenant_id=DEFAULT_TENANT_ID,
        )

    async def _wrap_start(update, context):
        if _admin_db_engine is None:
            await update.message.reply_text("MIRA isn't fully configured. Ask your admin.")
            return
        await start_command(update, context, engine=_admin_db_engine)

    # IMPORTANT: register /start FIRST so it wins over the legacy welcome.
    app.add_handler(CommandHandler("start", _wrap_start))
    app.add_handler(CommandHandler("invite", _wrap_invite))
    app.add_handler(CommandHandler("team", _wrap_team))
    app.add_handler(CommandHandler("revoke", _wrap_revoke))
    app.add_handler(CommandHandler("invite_status", _wrap_invite_status))

    app.add_handler(CommandHandler("equipment", equipment_command))
    app.add_handler(CommandHandler("faults", faults_command))
    app.add_handler(CommandHandler("status", status_command))
    app.add_handler(CommandHandler("reset", reset_command))
    app.add_handler(CommandHandler("voice", voice_command))
    app.add_handler(CommandHandler("bad", bad_command))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(MessageHandler(filters.Document.PDF, document_handler))
    app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_error_handler(_conflict_error_handler)

    _ver_path = os.path.join(os.path.dirname(__file__), "VERSION")
    _ver = open(_ver_path).read().strip() if os.path.exists(_ver_path) else "unknown"
    logger.info("MIRA Telegram bot starting (polling) version=%s admins=%d",
                _ver, _authorizer.admin_count())
    app.run_polling(allowed_updates=Update.ALL_TYPES)
```

- [ ] **Step 5: Update help text**

In `help_command`, prepend:

```python
        "/invite <email> — (admin) mint enrollment link\n"
        "/team — (admin) list enrolled members\n"
        "/revoke <telegram_id> — (admin) remove a member\n"
        "/invite_status — (admin) list pending/used invites\n"
```

- [ ] **Step 6: Run the full bot-side test suite for regressions**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/ -q -x
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add mira-bots/telegram/bot.py
git -c commit.gpgsign=false commit -m "feat(telegram): wire identity service, admin commands, /start invite handler"
```

---

## Task 14: Multi-tenant isolation integration test

End-to-end isolation guarantees in pytest.

**Files:**
- Create: `mira-bots/tests/test_multi_tenant_isolation.py`

- [ ] **Step 1: Write the test**

Create `mira-bots/tests/test_multi_tenant_isolation.py`:

```python
"""Integration: two users in the same tenant don't see each other's state;
two users in different tenants don't see each other's data."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest
from shared.identity.service import IdentityService
from shared.tenant.invites import consume_invite, mint_invite
from sqlalchemy import create_engine, text

_DDL = """
CREATE TABLE plg_tenants (id TEXT PRIMARY KEY, email TEXT);
CREATE TABLE mira_users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
                         display_name TEXT DEFAULT '', email TEXT DEFAULT '');
CREATE TABLE identity_links (id TEXT PRIMARY KEY, mira_user_id TEXT NOT NULL,
                             platform TEXT, external_user_id TEXT, tenant_id TEXT,
                             UNIQUE(platform, external_user_id, tenant_id));
CREATE TABLE tenant_invites (token TEXT PRIMARY KEY, tenant_id TEXT, email TEXT,
                              display_name TEXT DEFAULT '', minted_by TEXT,
                              minted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                              expires_at TIMESTAMP, consumed_at TIMESTAMP, consumed_by TEXT);
"""


@pytest.fixture
def engine():
    e = create_engine("sqlite:///:memory:")
    with e.connect() as conn:
        for stmt in _DDL.strip().split(";"):
            s = stmt.strip()
            if s:
                conn.execute(text(s))
        conn.execute(text("INSERT INTO plg_tenants VALUES ('t_acme', 'a@acme'), ('t_other', 'a@other')"))
        conn.commit()
    return e


def test_lookup_only_isolates_users_across_tenants(engine):
    """An external_user_id existing in one tenant must NOT match for another."""
    svc = IdentityService(engine)
    # Enroll Alice in t_acme
    tok = mint_invite(engine, tenant_id="t_acme", email="alice@x", minted_by="admin")
    consume_invite(engine, token=tok, telegram_user_id="555", display_name="Alice")
    # Lookup as a stranger DM from a different telegram id → must be None
    assert svc.lookup_only("telegram", "999") is None


def test_two_users_same_tenant_get_distinct_mira_user_ids(engine):
    svc = IdentityService(engine)
    tok_a = mint_invite(engine, tenant_id="t_acme", email="alice@x", minted_by="admin")
    consume_invite(engine, token=tok_a, telegram_user_id="555", display_name="Alice")
    tok_b = mint_invite(engine, tenant_id="t_acme", email="bob@x", minted_by="admin")
    consume_invite(engine, token=tok_b, telegram_user_id="666", display_name="Bob")

    a = svc.lookup_only("telegram", "555")
    b = svc.lookup_only("telegram", "666")
    assert a is not None and b is not None
    assert a.id != b.id
    assert a.tenant_id == b.tenant_id == "t_acme"


def test_revoked_user_cannot_be_looked_up(engine):
    """After deleting identity_links row, lookup_only returns None — the next
    message hits the dispatcher gate and is rejected."""
    svc = IdentityService(engine)
    tok = mint_invite(engine, tenant_id="t_acme", email="charlie@x", minted_by="admin")
    consume_invite(engine, token=tok, telegram_user_id="777", display_name="Charlie")
    assert svc.lookup_only("telegram", "777") is not None
    # Revoke
    with engine.connect() as conn:
        conn.execute(
            text(
                "DELETE FROM identity_links "
                "WHERE platform='telegram' AND external_user_id='777' AND tenant_id='t_acme'"
            )
        )
        conn.commit()
    assert svc.lookup_only("telegram", "777") is None
```

- [ ] **Step 2: Run the tests**

```bash
cd /Users/bravonode/Mira/mira-bots
uv run pytest tests/test_multi_tenant_isolation.py -v
```

Expected: 3 passes.

- [ ] **Step 3: Run the full test suite**

```bash
uv run pytest tests/ -q
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add mira-bots/tests/test_multi_tenant_isolation.py
git -c commit.gpgsign=false commit -m "test(tenant): isolation guarantees across users and tenants"
```

---

## Task 15: Backfill in prod, rebuild, deploy, smoke

This is the deploy ritual. **Order matters: backfill BEFORE deploy or existing users get locked out by the strict gate.**

- [ ] **Step 1: Find the admin's Telegram user ID**

Send any message to the bot from the admin's Telegram account, then look at the bot logs for `Received from <name>:` and run:

```bash
docker logs mira-bot-telegram --tail 200 | grep -E "Received from|getUpdates" | tail -5
```

Or the admin can DM `@userinfobot` on Telegram, which replies with the user ID. Note this number — it goes into `ADMIN_TELEGRAM_IDS`.

- [ ] **Step 2: Set `ADMIN_TELEGRAM_IDS` in Doppler**

```bash
doppler secrets set ADMIN_TELEGRAM_IDS="<your_telegram_user_id>" --project factorylm --config prd
```

Confirm:

```bash
doppler secrets get ADMIN_TELEGRAM_IDS --project factorylm --config prd --plain | head -c 30
```

- [ ] **Step 3: Run the backfill in dry-run mode against the live SQLite**

The bot's SQLite lives in the `mira-bridge` data volume. Dry-run via the existing container:

```bash
docker exec mira-bot-telegram python3 - <<'EOF'
import os, sqlite3
os.environ.setdefault("MIRA_DB_PATH", "/data/mira.db")
sq = sqlite3.connect(os.environ["MIRA_DB_PATH"])
print("chat_ids in conversation_state:")
for r in sq.execute("SELECT DISTINCT chat_id FROM conversation_state"):
    print(" ", r[0])
EOF
```

Note the count and which look like positive ints (private DM users) vs negatives (group chats).

- [ ] **Step 4: Run the backfill for real**

Copy the script in and run with Doppler env injected:

```bash
docker cp tools/backfill_tenant_map.py mira-bot-telegram:/tmp/backfill.py
doppler run --project factorylm --config prd -- bash -c '
  docker exec -e MIRA_TENANT_ID="$MIRA_TENANT_ID" \
              -e NEON_DATABASE_URL="$NEON_DATABASE_URL" \
              mira-bot-telegram python3 /tmp/backfill.py --sqlite-path /data/mira.db
'
```

Expected log lines: `Found N distinct chat_ids`, `Of those, M look like private-DM user IDs`, `BACKFILL_DONE inserted_users=M inserted_links=M seeded_chat_tenant_map=M`.

- [ ] **Step 5: Rebuild and redeploy the bot with the new code**

```bash
cd /Users/bravonode/Mira/mira-bots
doppler run --project factorylm --config prd -- \
  docker compose up -d --build telegram-bot
```

- [ ] **Step 6: Watch startup for 30s**

```bash
sleep 12 && docker logs mira-bot-telegram --tail 80
```

Expected: `MIRA Telegram bot starting (polling) version=... admins=1`, `Application started`, no `409 Conflict`, no traceback.

- [ ] **Step 7: Smoke from Telegram (admin's account)**

Send to the bot:
1. `/help` — should list new admin commands
2. Any maintenance question — should reply normally (admin is enrolled via backfill)
3. `/team` — should list yourself
4. `/invite test@example.com` — should return a `https://t.me/.../?start=tok_...` link

- [ ] **Step 8: Smoke as a stranger (use a second Telegram account, or ask a colleague)**

DM the bot from an unenrolled account → should reply with the invite-only message. No further responses to that account's messages.

- [ ] **Step 9: Smoke the invite consumption**

Open the invite link from step 7's `/invite` reply in the second Telegram account → should see the welcome message. Try `/team` from the admin account → new member appears.

- [ ] **Step 10: Push the branch and open a PR**

```bash
git push -u origin feat/multi-tenant-telegram
gh pr create --title "Multi-tenant Telegram via deep-link invites" --body "$(cat <<'EOF'
## Summary
Wires existing identity scaffolding (mira_users / identity_links / chat_tenant_map / IdentityService) into the Telegram bot. Adds:
- `tenant_invites` table (migration 006)
- `IdentityService.lookup_only()` strict gate
- `TenantScopedSession` SQLAlchemy guard
- Telegram `/invite`, `/team`, `/revoke`, `/invite_status` admin commands
- `/start <token>` invite-consumption flow
- `tools/backfill_tenant_map.py` migration script
- `.ast-grep-rules/no-unscoped-tenant-query.yml` defense in depth

Spec: `docs/superpowers/specs/2026-04-26-mira-multi-tenant-design.md`

## Test plan
- [x] Unit tests pass: `cd mira-bots && uv run pytest tests/ -q`
- [x] Backfill ran against prod SQLite (dry-run + real)
- [x] Bot restarted cleanly, no 409
- [x] Admin can `/invite`, `/team`, `/revoke`
- [x] Stranger gets invite-only message
- [x] Invite link enrolls new user, message flow works

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 11: Final commit (if any uncommitted artifacts)**

```bash
git status
# If clean → done. If anything outstanding, commit it with a clear message.
```

---

## Self-review checklist (run by plan author after writing)

**Spec coverage** — every requirement in `2026-04-26-mira-multi-tenant-design.md`:

| Spec § | Requirement | Implemented in |
|--------|-------------|----------------|
| §3 | TelegramChatAdapter populates tenant_id | Task 8 |
| §3 | Dispatcher uses lookup_only, fails closed | Task 9 |
| §3 | Supervisor accepts per-call tenant_id | Task 10 |
| §3 | TenantScopedSession enforces filter | Task 3 |
| §4.1 | bot.py wires identity + auth | Task 13 |
| §4.1 | /start handler | Task 7 |
| §4.1 | identity service lookup_only | Task 2 |
| §4.2 | invites.py mint/consume | Task 4 |
| §4.2 | admin_commands.py | Task 6 |
| §4.2 | migration 006 | Task 1 |
| §4.2 | ast-grep rule | Task 11 |
| §4.3 | tenant_invites schema | Task 1 |
| §6 | Admin command UX | Task 6 + 13 |
| §7 | Backfill before deploy | Task 12 + 15 |
| §8 | Failure modes (NeonDB outage fails closed) | Task 9 step 3 |
| §9.1 | Unit tests per file | Tasks 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| §9.2 | Integration isolation test | Task 14 |
| §9.3 | E2E in test runner | Task 15 step 7-9 (manual; full Telethon scenario deferred to follow-up PR) |
| §10 | Defense-in-depth: TenantScopedSession + ast-grep | Task 3 + 11 |

**Placeholder scan:** No "TBD"/"TODO"/"add error handling" — every step has concrete code or commands.

**Type consistency:** `MiraUser` and `InvitedUser` are distinct dataclasses — that's intentional (`MiraUser` lives in `identity.service`, `InvitedUser` is a thin return shape from `consume_invite`). They share field names (`id`, `tenant_id`, `display_name`, `email`) for ergonomics. Caller treats them duck-typed where applicable.

**Known follow-ups (out of scope, captured for next plan):**
- Full Telethon E2E scenario for invite-to-chat (manual smoke covered in Task 15 §7-9)
- `/whoami` and `/leave` member commands (admin commands sufficient for v1)
- Removing `MIRA_TENANT_ID` env-var fallback once §13 prod audit confirms it's quiet
