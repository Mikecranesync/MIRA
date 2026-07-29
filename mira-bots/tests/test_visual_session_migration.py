"""Tenant-isolation hard gate for migration 063 (visual_session spine),
proven against a REAL, ephemeral postgres:16 -- the one Phase-1 test that is
not hermetic by nature, since RLS enforcement can only be proven by a real
Postgres, not asserted in Python.

Skips cleanly (never fails the suite) when Docker is unavailable or the
daemon is unreachable. Per .claude/rules/mira-hub-migrations.md rule 6:
reproduce with a tenant that can actually authenticate -- both tenants here
are UUIDs (the Hub tenant family), never a legacy non-UUID slug.

Connects as the ``factorylm_app`` role for every store call (never as the
``postgres`` superuser) -- superusers bypass RLS unconditionally, so a test
that ran as postgres would pass even if the RLS policy were completely
broken. ``VisualSessionStore`` opens a fresh connection per call (matching
decision_trace.py's pattern), so "run as factorylm_app" is achieved by
pointing ``NEON_DATABASE_URL`` at that role's own DSN directly, which is also
how production actually authenticates (no ``SET ROLE`` hop) -- see
mira-hub-migrations.md rule 1.

What this proves, using the REAL VisualSessionStore code (not hand-rolled
SQL), end to end:
  1. Migration 063 applies cleanly to a fresh Postgres 16 once the
     ``factorylm_app`` role exists (its GRANTs are conditional on the role
     already being present).
  2. Tenant A can create a session and append + read back its own
     observation.
  3. Tenant B, querying the EXACT SAME session_id, sees zero of tenant A's
     rows -- neither the session nor its observations.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Iterator

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.visual.evidence_state import EvidenceState  # noqa: E402
from shared.visual.store import VisualSessionStore  # noqa: E402

_REPO_ROOT = Path(__file__).resolve().parents[2]
_MIGRATION_PATH = _REPO_ROOT / "mira-hub" / "db" / "migrations" / "063_visual_sessions.sql"

_PG_SUPERUSER_PASSWORD = "vt_test_superuser_pw"  # ephemeral container only, never real infra
_APP_ROLE_PASSWORD = "vt_test_app_role_pw"  # ephemeral container only, never real infra
_STARTUP_TIMEOUT_S = 60
_CONTAINER_PREFIX = "mira-vt-migration-test-"


def _docker_available() -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=10,
            check=True,
        )
        return True
    except Exception:
        return False


_SKIP_REASON = "Docker not installed/reachable -- skipping the ephemeral-Postgres migration test"
pytestmark = pytest.mark.skipif(not _docker_available(), reason=_SKIP_REASON)


def _free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_postgres(admin_url: str, deadline_s: float) -> None:
    import psycopg2

    deadline = time.monotonic() + deadline_s
    last_exc: Exception | None = None
    while time.monotonic() < deadline:
        try:
            conn = psycopg2.connect(admin_url, sslmode="require", connect_timeout=3)
            conn.close()
            return
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            time.sleep(0.5)
    pytest.skip(f"ephemeral postgres:16 did not become ready in time: {last_exc}")


# VisualSessionStore (matching decision_trace.py EXACTLY, per the Phase-1
# spec) always connects with sslmode=require -- correct for real Neon, but a
# vanilla `postgres:16` container has SSL off by default. Rather than weaken
# the store for this test, boot the container with a self-signed cert
# generated INSIDE it (avoids Windows bind-mount permission issues: Postgres
# refuses to start if the key file is group/world-readable, which is exactly
# what a Windows->Docker Desktop bind mount tends to produce for a
# host-generated key).
_SSL_ENABLE_COMMAND = (
    "openssl req -new -x509 -days 3 -nodes -text -out /tmp/server.crt "
    "-keyout /tmp/server.key -subj '/CN=localhost' && "
    "chmod 600 /tmp/server.key && "
    "chown postgres:postgres /tmp/server.crt /tmp/server.key && "
    "exec docker-entrypoint.sh postgres -c ssl=on "
    "-c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key"
)


@pytest.fixture(scope="module")
def pg_container() -> Iterator[dict]:
    if not _docker_available():
        pytest.skip(_SKIP_REASON)

    name = _CONTAINER_PREFIX + uuid.uuid4().hex[:8]
    port = _free_tcp_port()
    run_cmd = [
        "docker", "run", "-d", "--rm", "--name", name,
        "-e", f"POSTGRES_PASSWORD={_PG_SUPERUSER_PASSWORD}",
        "-p", f"{port}:5432",
        "postgres:16",
        "bash", "-c", _SSL_ENABLE_COMMAND,
    ]
    try:
        subprocess.run(run_cmd, capture_output=True, timeout=120, check=True)
    except Exception as exc:  # noqa: BLE001 - docker present but couldn't run/pull -> skip, don't fail
        pytest.skip(f"could not start ephemeral postgres:16 container: {exc}")

    admin_url = f"postgresql://postgres:{_PG_SUPERUSER_PASSWORD}@127.0.0.1:{port}/postgres"
    try:
        _wait_for_postgres(admin_url, _STARTUP_TIMEOUT_S)
        yield {"name": name, "port": port, "admin_url": admin_url}
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=30)


@pytest.fixture(scope="module")
def app_role_url(pg_container: dict) -> str:
    """Create the factorylm_app role, apply migration 063, return its DSN."""
    import psycopg2

    conn = psycopg2.connect(pg_container["admin_url"])
    conn.autocommit = True
    try:
        cur = conn.cursor()
        cur.execute(
            "DO $$ BEGIN "
            "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN "
            f"CREATE ROLE factorylm_app LOGIN PASSWORD '{_APP_ROLE_PASSWORD}'; "
            "END IF; "
            "END $$;"
        )
        migration_sql = _MIGRATION_PATH.read_text(encoding="utf-8")
        # The migration file wraps itself in BEGIN;/COMMIT; -- run it as one
        # multi-statement command on an autocommit connection so its own
        # transaction boundaries are honored rather than nested in ours.
        cur.execute(migration_sql)
    finally:
        conn.close()

    return f"postgresql://factorylm_app:{_APP_ROLE_PASSWORD}@127.0.0.1:{pg_container['port']}/postgres"


@pytest.mark.asyncio
async def test_migration_applies_and_tenant_a_reads_its_own_data(app_role_url, monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", app_role_url)
    store = VisualSessionStore()
    tenant_a = str(uuid.uuid4())

    session_id = await store.create_session(tenant_a, title="tenant A session")
    assert session_id is not None, (
        "create_session returned None -- either the migration did not apply, the "
        "factorylm_app grant is missing, or the RLS WITH CHECK rejected tenant A's own insert"
    )

    fetched = await store.get_session(session_id, tenant_a)
    assert fetched is not None
    assert fetched.session_id == session_id
    assert fetched.tenant_id == tenant_a

    observation_id = await store.append_observation(
        session_id,
        tenant_a,
        obs_kind="entity",
        evidence_state=EvidenceState.VISIBLE,
        raw_value="contact CR3 normally open",
        extractor="ocr",
    )
    assert observation_id is not None

    observations = await store.load_observations(session_id, tenant_a)
    assert len(observations) == 1
    assert observations[0].raw_value == "contact CR3 normally open"
    assert observations[0].evidence_state == EvidenceState.VISIBLE


@pytest.mark.asyncio
async def test_tenant_b_sees_zero_of_tenant_as_rows(app_role_url, monkeypatch):
    """The hard gate: RLS-enforced tenant isolation on the visual_session
    spine. Tenant B, given the EXACT session_id tenant A owns, must see
    neither the session nor any of its observations."""
    monkeypatch.setenv("NEON_DATABASE_URL", app_role_url)
    store = VisualSessionStore()
    tenant_a, tenant_b = str(uuid.uuid4()), str(uuid.uuid4())

    session_id = await store.create_session(tenant_a, title="tenant A private session")
    assert session_id is not None
    observation_id = await store.append_observation(
        session_id,
        tenant_a,
        obs_kind="entity",
        evidence_state=EvidenceState.VISIBLE,
        raw_value="tenant A's private observation",
        extractor="ocr",
    )
    assert observation_id is not None

    # Positive control FIRST -- if this fails, the negative assertions below
    # would be meaningless (a broken query can "pass" a hard-gate test by
    # returning nothing for everyone). debugging-conventions.md: a MISSING
    # result against an unverified path is inconclusive, not a finding.
    assert await store.get_session(session_id, tenant_a) is not None
    assert len(await store.load_observations(session_id, tenant_a)) == 1

    # The hard gate.
    assert await store.get_session(session_id, tenant_b) is None
    assert await store.load_observations(session_id, tenant_b) == []


@pytest.mark.asyncio
async def test_migration_reapplication_is_idempotent(app_role_url, pg_container, monkeypatch):
    """mira-hub-migrations.md rule 5: apply-migrations.yml may re-run a
    migration; CREATE TABLE/POLICY IF NOT EXISTS / DROP POLICY IF EXISTS
    before CREATE POLICY must make this safe. Applying 063 a second time
    against the same database must not raise."""
    import psycopg2

    conn = psycopg2.connect(pg_container["admin_url"])
    conn.autocommit = True
    try:
        cur = conn.cursor()
        cur.execute(_MIGRATION_PATH.read_text(encoding="utf-8"))
    finally:
        conn.close()

    # And the store still works after the re-apply.
    monkeypatch.setenv("NEON_DATABASE_URL", app_role_url)
    store = VisualSessionStore()
    tenant = str(uuid.uuid4())
    session_id = await store.create_session(tenant, title="post-reapply session")
    assert session_id is not None
