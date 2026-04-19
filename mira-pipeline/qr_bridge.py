"""QR->pipeline bridge.

On first chat invocation after a scan, read the ``mira_pending_scan``
cookie, look up (tenant_id, asset_tag) in NeonDB, and call
session_memory.save_session() so the engine's existing IDLE-state
load_session() hook (engine.py:619-639) picks up the asset context.

Clears the cookie on completion so it is one-shot.

Import note: ``from shared.session_memory import save_session`` works
because:
  - In the container, main.py:32 inserts /app which contains shared/ as a
    subdirectory (copied from mira-bots/ at build time).
  - In dev, the repo-root tests/conftest.py inserts mira-bots/ on sys.path,
    and mira-bots/shared/ is the package.
The caller (main.py or pytest) is responsible for sys.path; no sys.path
manipulation is needed here.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

logger = logging.getLogger("mira-pipeline.qr_bridge")

_UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


# ---------------------------------------------------------------------------
# Public helpers — pure functions, no I/O (unit-testable)
# ---------------------------------------------------------------------------


def parse_cookie_header(header: str | None) -> dict[str, str]:
    """Parse a raw HTTP Cookie header value into a dict."""
    if not header:
        return {}
    out: dict[str, str] = {}
    for part in header.split(";"):
        eq = part.find("=")
        if eq < 0:
            continue
        k = part[:eq].strip()
        v = part[eq + 1 :].strip()
        if k:
            out[k] = v
    return out


def read_pending_scan_id(cookie_header: str | None) -> str | None:
    """Return the pending scan_id if present and syntactically valid, else None.

    Rejects values that are not 36-character UUID-shaped strings to avoid
    passing arbitrary user-controlled values to the database.
    """
    raw = parse_cookie_header(cookie_header).get("mira_pending_scan")
    if not raw:
        return None
    if not _UUID_RE.match(raw):
        logger.warning("qr_bridge: rejecting non-UUID pending scan cookie value")
        return None
    return raw


# ---------------------------------------------------------------------------
# I/O helpers — graceful-failure pattern (never raise to caller)
# ---------------------------------------------------------------------------


def lookup_scan(scan_id: str) -> dict[str, Any] | None:
    """Fetch (tenant_id, asset_tag, atlas_user_id) from qr_scan_events.

    Returns None on any error or if the scan_id is not found.
    Uses sqlalchemy + NullPool matching the session_memory pattern.
    """
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        return None
    try:
        from sqlalchemy import create_engine, text  # noqa: PLC0415
        from sqlalchemy.pool import NullPool  # noqa: PLC0415
    except ImportError:
        logger.warning("qr_bridge: sqlalchemy not installed, skipping lookup")
        return None
    try:
        engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        with engine.connect() as conn:
            row = (
                conn.execute(
                    text(
                        "SELECT tenant_id::text, asset_tag, atlas_user_id "
                        "FROM qr_scan_events WHERE scan_id = :sid LIMIT 1"
                    ),
                    {"sid": scan_id},
                )
                .mappings()
                .fetchone()
            )
            return dict(row) if row else None
    except Exception as exc:
        logger.warning("qr_bridge: lookup_scan failed: %s", exc)
        return None


def process_pending_scan(cookie_header: str | None, chat_id: str) -> bool:
    """Read pending-scan cookie, resolve to asset, and seed session_memory.

    Returns True if a pending scan was found, resolved, and saved.
    Always safe to call — returns False on any failure without raising.
    """
    scan_id = read_pending_scan_id(cookie_header)
    if not scan_id:
        return False

    row = lookup_scan(scan_id)
    if not row:
        logger.debug("qr_bridge: scan_id=%s not found in qr_scan_events", scan_id)
        return False

    try:
        from shared.session_memory import save_session  # noqa: PLC0415
    except ImportError:
        logger.warning("qr_bridge: shared.session_memory unavailable, cannot seed session")
        return False

    ok = save_session(
        chat_id=chat_id,
        asset_id=row["asset_tag"],
    )
    if ok:
        logger.info(
            "qr_bridge: seeded session chat_id=%s asset=%s from scan_id=%s",
            chat_id,
            row["asset_tag"],
            scan_id,
        )
    return ok


def build_clear_cookie_header() -> str:
    """Build the Set-Cookie value that clears mira_pending_scan (one-shot)."""
    domain = os.environ.get("COOKIE_DOMAIN", ".factorylm.com")
    secure_attr = "Secure; " if os.environ.get("NODE_ENV") != "development" else ""
    return (
        f"mira_pending_scan=; HttpOnly; {secure_attr}"
        f"SameSite=Lax; Path=/; Max-Age=0; Domain={domain}"
    )
