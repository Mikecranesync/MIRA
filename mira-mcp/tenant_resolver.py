"""Tenant resolver — look up per-tenant Atlas CMMS credentials from NeonDB.

The password is never stored in NeonDB; it is derived on the fly from
ATLAS_PASSWORD_DERIVATION_KEY (same algorithm as mira-web/src/lib/crypto.ts).

Algorithm (must stay byte-for-byte identical to the TypeScript version):
    HMAC-SHA256(key=ATLAS_PASSWORD_DERIVATION_KEY, msg=tenant_id)
    → base64url-encoded digest
    → first 32 characters
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os

import httpx  # noqa: F401 — imported for consistency, actual DB calls use psycopg

logger = logging.getLogger("mira.tenant_resolver")

# ---------------------------------------------------------------------------
# Password derivation
# ---------------------------------------------------------------------------

_DERIVATION_KEY_VAR = "ATLAS_PASSWORD_DERIVATION_KEY"


def derive_atlas_password(tenant_id: str) -> str:
    """Derive an Atlas CMMS password for a tenant.

    Mirrors ``deriveAtlasPassword()`` in mira-web/src/lib/crypto.ts exactly:

        createHmac("sha256", key).update(tenantId).digest("base64url").slice(0, 32)

    Args:
        tenant_id: The tenant UUID (``plg_tenants.id``).

    Returns:
        A 32-character base64url string.

    Raises:
        RuntimeError: When ATLAS_PASSWORD_DERIVATION_KEY is not set.
    """
    key = os.environ.get(_DERIVATION_KEY_VAR, "")
    if not key:
        raise RuntimeError(f"{_DERIVATION_KEY_VAR} not set — cannot derive Atlas password")

    digest = hmac.new(key.encode(), tenant_id.encode(), hashlib.sha256).digest()
    # base64url = standard base64 with '+' → '-' and '/' → '_', no padding
    b64url = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return b64url[:32]


# ---------------------------------------------------------------------------
# NeonDB tenant lookup
# ---------------------------------------------------------------------------

_NEON_URL_VAR = "NEON_DATABASE_URL"


async def resolve_atlas_creds(tenant_id: str) -> tuple[str, str, str] | None:
    """Look up (email, derived_password, api_url) for a tenant.

    Queries ``plg_tenants`` in NeonDB. Password is derived via
    :func:`derive_atlas_password` — it is never stored in the DB.
    The Atlas API URL falls back to the ``ATLAS_API_URL`` env var so
    single-instance deployments work without extra config.

    Args:
        tenant_id: The tenant UUID to resolve.

    Returns:
        ``(email, password, api_url)`` tuple, or ``None`` when the tenant
        is not found, the derivation key is missing, or the DB is unreachable.
    """
    neon_url = os.environ.get(_NEON_URL_VAR, "")
    if not neon_url:
        logger.error("NEON_DATABASE_URL not set — tenant resolver cannot query NeonDB")
        return None

    try:
        import psycopg  # type: ignore[import]
    except ModuleNotFoundError:
        try:
            import psycopg2 as psycopg  # type: ignore[import,no-redef]
        except ModuleNotFoundError:
            logger.error("Neither psycopg nor psycopg2 installed — cannot query NeonDB")
            return None

    email: str | None = None
    try:
        # NeonDB / Postgres: use a plain synchronous connection wrapped in
        # asyncio.to_thread if needed, but psycopg3 supports async natively.
        # We attempt psycopg3 async first; fall back to sync for psycopg2.
        if hasattr(psycopg, "AsyncConnection"):
            async with await psycopg.AsyncConnection.connect(  # type: ignore[attr-defined]
                neon_url,
                row_factory=psycopg.rows.dict_row,  # type: ignore[attr-defined]
            ) as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "SELECT email FROM plg_tenants WHERE id = %s LIMIT 1",
                        (tenant_id,),
                    )
                    row = await cur.fetchone()
                    email = row["email"] if row else None
        else:
            # psycopg2 — synchronous path
            import asyncio

            def _sync_query() -> str | None:
                with psycopg.connect(neon_url) as conn:  # type: ignore[arg-type]
                    with conn.cursor() as cur:
                        cur.execute(
                            "SELECT email FROM plg_tenants WHERE id = %s LIMIT 1",
                            (tenant_id,),
                        )
                        row = cur.fetchone()
                        return row[0] if row else None

            email = await asyncio.get_event_loop().run_in_executor(None, _sync_query)

    except Exception as exc:
        logger.error("NeonDB query failed for tenant=%s: %s", tenant_id, exc)
        return None

    if not email:
        logger.warning("Tenant not found in plg_tenants: %s", tenant_id)
        return None

    try:
        password = derive_atlas_password(tenant_id)
    except RuntimeError as exc:
        logger.error("Password derivation failed for tenant=%s: %s", tenant_id, exc)
        return None

    api_url = os.environ.get("ATLAS_API_URL", "http://atlas-api:8080")
    logger.info("Resolved Atlas creds for tenant=%s email=%s api_url=%s", tenant_id, email, api_url)
    return email, password, api_url
