"""Unified cross-platform identity resolution.

Maps (platform, external_user_id, tenant_id) → canonical mira_user_id.

Three-step resolve():
  1. Direct link lookup — fastest path, cached per call.
  2. Email match — if the normalized event carries email, link to existing user.
  3. Create new user + link — first time a platform identity is seen.

Uses SQLAlchemy text() with :param style so the same code runs against
NeonDB (prod) and SQLite in-memory (tests).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("mira-gsd")


@dataclass
class MiraUser:
    id: str
    tenant_id: str
    display_name: str
    email: str


@dataclass
class IdentityLink:
    id: str
    mira_user_id: str
    platform: str
    external_user_id: str
    tenant_id: str


class IdentityService:
    """Resolve platform identities to canonical MIRA users.

    Pass a SQLAlchemy engine (NeonDB or SQLite).  All methods are synchronous
    because the underlying SQLAlchemy core execute() is sync; wrap in
    asyncio.to_thread() if calling from async code.
    """

    def __init__(self, db_engine: Any) -> None:
        self._engine = db_engine

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def resolve(
        self,
        platform: str,
        external_user_id: str,
        tenant_id: str,
        *,
        email: str = "",
        display_name: str = "",
    ) -> MiraUser:
        """Return (or create) the canonical MiraUser for this platform identity."""
        from sqlalchemy import text

        with self._engine.connect() as conn:
            # Step 1 — direct link lookup
            row = conn.execute(
                text(
                    "SELECT u.id, u.tenant_id, u.display_name, u.email "
                    "FROM mira_users u "
                    "JOIN identity_links l ON l.mira_user_id = u.id "
                    "WHERE l.platform = :platform "
                    "  AND l.external_user_id = :ext_id "
                    "  AND l.tenant_id = :tenant_id"
                ),
                {"platform": platform, "ext_id": external_user_id, "tenant_id": tenant_id},
            ).fetchone()
            if row:
                return MiraUser(id=str(row[0]), tenant_id=row[1], display_name=row[2], email=row[3])

            # Step 2 — email match
            if email:
                row = conn.execute(
                    text(
                        "SELECT id, tenant_id, display_name, email "
                        "FROM mira_users "
                        "WHERE tenant_id = :tenant_id AND email = :email"
                    ),
                    {"tenant_id": tenant_id, "email": email},
                ).fetchone()
                if row:
                    user = MiraUser(
                        id=str(row[0]), tenant_id=row[1], display_name=row[2], email=row[3]
                    )
                    self._create_link(conn, user.id, platform, external_user_id, tenant_id)
                    conn.commit()
                    return user

            # Step 3 — create new user + link
            user_id = self._create_user(conn, tenant_id, display_name=display_name, email=email)
            self._create_link(conn, user_id, platform, external_user_id, tenant_id)
            conn.commit()
            return MiraUser(id=user_id, tenant_id=tenant_id, display_name=display_name, email=email)

    def get_user(self, mira_user_id: str) -> MiraUser | None:
        from sqlalchemy import text

        with self._engine.connect() as conn:
            row = conn.execute(
                text("SELECT id, tenant_id, display_name, email FROM mira_users WHERE id = :id"),
                {"id": mira_user_id},
            ).fetchone()
        if not row:
            return None
        return MiraUser(id=str(row[0]), tenant_id=row[1], display_name=row[2], email=row[3])

    def get_linked_platforms(self, mira_user_id: str) -> list[IdentityLink]:
        from sqlalchemy import text

        with self._engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, mira_user_id, platform, external_user_id, tenant_id "
                    "FROM identity_links WHERE mira_user_id = :uid"
                ),
                {"uid": mira_user_id},
            ).fetchall()
        return [
            IdentityLink(
                id=str(r[0]),
                mira_user_id=str(r[1]),
                platform=r[2],
                external_user_id=r[3],
                tenant_id=r[4],
            )
            for r in rows
        ]

    def link_identity(
        self,
        mira_user_id: str,
        platform: str,
        external_user_id: str,
        tenant_id: str,
    ) -> IdentityLink:
        """Manually link a platform identity to an existing MiraUser."""
        with self._engine.connect() as conn:
            link_id = self._create_link(conn, mira_user_id, platform, external_user_id, tenant_id)
            conn.commit()
        return IdentityLink(
            id=link_id,
            mira_user_id=mira_user_id,
            platform=platform,
            external_user_id=external_user_id,
            tenant_id=tenant_id,
        )

    def list_users(self, tenant_id: str) -> list[MiraUser]:
        from sqlalchemy import text

        with self._engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, tenant_id, display_name, email FROM mira_users "
                    "WHERE tenant_id = :tenant_id ORDER BY display_name"
                ),
                {"tenant_id": tenant_id},
            ).fetchall()
        return [MiraUser(id=str(r[0]), tenant_id=r[1], display_name=r[2], email=r[3]) for r in rows]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _create_user(
        self, conn: Any, tenant_id: str, *, display_name: str = "", email: str = ""
    ) -> str:
        import uuid

        from sqlalchemy import text

        uid = str(uuid.uuid4())
        conn.execute(
            text(
                "INSERT INTO mira_users (id, tenant_id, display_name, email) "
                "VALUES (:id, :tenant_id, :display_name, :email)"
            ),
            {"id": uid, "tenant_id": tenant_id, "display_name": display_name, "email": email},
        )
        return uid

    def _create_link(
        self,
        conn: Any,
        mira_user_id: str,
        platform: str,
        external_user_id: str,
        tenant_id: str,
    ) -> str:
        import uuid

        from sqlalchemy import text

        link_id = str(uuid.uuid4())
        conn.execute(
            text(
                "INSERT INTO identity_links "
                "(id, mira_user_id, platform, external_user_id, tenant_id) "
                "VALUES (:id, :uid, :platform, :ext_id, :tenant_id) "
                "ON CONFLICT (platform, external_user_id, tenant_id) DO NOTHING"
            ),
            {
                "id": link_id,
                "uid": mira_user_id,
                "platform": platform,
                "ext_id": external_user_id,
                "tenant_id": tenant_id,
            },
        )
        return link_id


def get_identity_service() -> IdentityService | None:
    """Construct an IdentityService from NEON_DATABASE_URL env var.

    Returns None if the URL is unset or SQLAlchemy is not installed.
    """
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        return None
    try:
        from sqlalchemy import create_engine
        from sqlalchemy.pool import NullPool
    except ImportError:
        logger.warning("sqlalchemy not installed — identity service disabled")
        return None

    engine = create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    return IdentityService(engine)
