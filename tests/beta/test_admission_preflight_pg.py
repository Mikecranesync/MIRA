"""Disposable-Postgres integration test for the §7.3 preflight tool.

Exercises the REAL path — `_connect` (loopback gate + asyncpg, Apache-2.0), the
real SELECT with its FILTER aggregates, asyncpg Record → dict shaping, the
explicit read-only transaction + ROLLBACK, and legacy-vs-v2 admission — against
a disposable local Postgres carrying the Hub integration schema (the migration
set `admission-regression` applies in CI). Never a shared database: the tool
refuses any non-loopback host before connecting.

Skips unless BOTH are set, exactly like the Hub integration suite:
  PREFLIGHT_DATABASE_URL   loopback only
  MIRA_TEST_DB_CONFIRM=DISPOSABLE
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import pathlib
import uuid

import pytest

_TOOL = (
    pathlib.Path(__file__).resolve().parents[2]
    / "tools"
    / "qa"
    / "notebook_source_admission_preflight.py"
)
_spec = importlib.util.spec_from_file_location("notebook_source_admission_preflight_pg", _TOOL)
pre = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pre)

URL = os.getenv("PREFLIGHT_DATABASE_URL", "")
# Only the tests that touch a database skip without the disposable env; the
# guard tests below run everywhere (collection-safe, no DB).
needs_db = pytest.mark.skipif(
    not URL or os.getenv("MIRA_TEST_DB_CONFIRM") != "DISPOSABLE",
    reason="needs PREFLIGHT_DATABASE_URL (loopback) + MIRA_TEST_DB_CONFIRM=DISPOSABLE",
)

TENANT = str(uuid.uuid4())
OTHER = str(uuid.uuid4())
NB = str(uuid.uuid4())
NODE = str(uuid.uuid4())
DOC_V2_PRIVATE = str(uuid.uuid4())
DOC_LEGACY_ONLY = str(uuid.uuid4())
DOC_MIXED = str(uuid.uuid4())
DOC_SHARED = str(uuid.uuid4())
DOC_VERIFIED = str(uuid.uuid4())
DOC_NONE = str(uuid.uuid4())


async def _fixture_connect(url: str):
    """Fixture connections go through the SAME loopback gate as the tool: a
    mistaken remote URL must be refused BEFORE any ALTER/INSERT/DELETE runs,
    regardless of MIRA_TEST_DB_CONFIRM."""
    pre.assert_safe_target(url)
    import asyncpg

    return await asyncpg.connect(url)


async def _seed():
    c = await _fixture_connect(URL)
    try:
        # The Hub integration fixture creates knowledge_entries without the v2
        # chunk columns (they live in docs/migrations + prod drift) — the same
        # additive stubs the Workstream A integration test applies.
        await c.execute(
            """ALTER TABLE knowledge_entries
                 ADD COLUMN IF NOT EXISTS doc_id uuid,
                 ADD COLUMN IF NOT EXISTS ingest_route text,
                 ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false,
                 ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false"""
        )
        await c.execute(
            "INSERT INTO equipment_notebooks (id, tenant_id, display_name, node_id) "
            "VALUES ($1::uuid, $2::uuid, 'preflight pg itest', $3::uuid)",
            NB,
            TENANT,
            NODE,
        )
        for doc, state in [
            (DOC_V2_PRIVATE, "user_confirmed"),
            (DOC_LEGACY_ONLY, "user_confirmed"),
            (DOC_MIXED, "user_confirmed"),
            (DOC_SHARED, "user_confirmed"),
            (DOC_VERIFIED, "verified"),
            (DOC_NONE, "user_confirmed"),
        ]:
            await c.execute(
                """INSERT INTO equipment_notebook_sources
                     (notebook_id, doc_id, tenant_id, enabled_by_default, match_state, source_role)
                   VALUES ($1::uuid, $2::uuid, $3::uuid, true, $4, 'manual')""",
                NB,
                doc,
                TENANT,
                state,
            )

        async def chunk(doc, tenant, route, private, verified):
            await c.execute(
                """INSERT INTO knowledge_entries
                     (tenant_id, doc_id, content, source_type, source_url, source_page,
                      ingest_route, metadata, is_private, verified)
                   VALUES ($1::uuid, $2::uuid, 'preflight pg itest chunk', 'equipment_manual',
                           'itest://preflight', 1, $3, '{}'::jsonb, $4, $5)""",
                tenant,
                doc,
                route,
                private,
                verified,
            )

        for _ in range(3):
            await chunk(DOC_V2_PRIVATE, TENANT, "v2", True, False)
        for _ in range(2):
            await chunk(DOC_LEGACY_ONLY, TENANT, "v1", True, False)
        # mixed: ONE legacy chunk that is VERIFIED (must not decide) + 2 v2 private
        await chunk(DOC_MIXED, TENANT, "v1", True, True)
        await chunk(DOC_MIXED, TENANT, "v2", True, False)
        await chunk(DOC_MIXED, TENANT, "v2", True, False)
        for _ in range(2):
            await chunk(DOC_SHARED, TENANT, "v2", False, False)
        await chunk(DOC_VERIFIED, TENANT, "v2", False, True)
        # another tenant's chunk under a doc id this tenant confirmed: invisible
        await chunk(DOC_V2_PRIVATE, OTHER, "v2", True, True)
    finally:
        await c.close()


async def _unseed():
    c = await _fixture_connect(URL)
    try:
        await c.execute(
            "DELETE FROM knowledge_entries WHERE tenant_id IN ($1::uuid, $2::uuid)", TENANT, OTHER
        )
        await c.execute("DELETE FROM equipment_notebook_sources WHERE tenant_id = $1::uuid", TENANT)
        await c.execute("DELETE FROM equipment_notebooks WHERE tenant_id = $1::uuid", TENANT)
    finally:
        await c.close()


@pytest.fixture(scope="module")
def seeded():
    asyncio.run(_seed())
    yield
    asyncio.run(_unseed())


async def _real_run():
    conn = await pre._connect(URL)  # loopback gate + asyncpg
    try:
        report = await pre.run_preflight(TENANT, conn)
        # the read-only transaction was rolled back: nothing is open
        assert not conn.is_in_transaction()
        return report
    finally:
        await conn.close()


@needs_db
def test_real_connect_select_readonly_rollback_and_admission(seeded):
    report = asyncio.run(_real_run())
    by = {s["doc_id"]: s for s in report["sources"]}
    assert set(by) == {
        DOC_V2_PRIVATE,
        DOC_LEGACY_ONLY,
        DOC_MIXED,
        DOC_SHARED,
        DOC_VERIFIED,
        DOC_NONE,
    }
    v = by[DOC_V2_PRIVATE]
    assert (
        v["chunks_total"],
        v["chunks_v2"],
        v["chunks_v2_private"],
        v["chunks_v2_verified"],
        v["chunks_admissible"],
    ) == (3, 3, 3, 0, 3)
    assert v["current_admission_result"] == "admitted"
    assert v["admission_path"] == "admitted_via_confirmation"
    lg = by[DOC_LEGACY_ONLY]
    assert (lg["chunks_total"], lg["chunks_v2"], lg["chunks_admissible"]) == (2, 0, 0)
    assert lg["current_admission_result"] == "excluded"
    assert lg["admission_path"] == "excluded_legacy_route_only"
    mx = by[DOC_MIXED]
    assert (
        mx["chunks_total"],
        mx["chunks_v2"],
        mx["chunks_v2_verified"],
        mx["chunks_admissible"],
    ) == (3, 2, 0, 2)
    assert mx["current_admission_result"] == "admitted"
    assert (
        mx["admission_path"] == "admitted_via_confirmation"
    )  # legacy verified chunk did not decide
    sh = by[DOC_SHARED]
    assert (sh["chunks_total"], sh["chunks_v2_private"], sh["chunks_admissible"]) == (2, 0, 0)
    assert sh["admission_path"] == "excluded_shared_unverified"
    assert by[DOC_VERIFIED]["admission_path"] == "verified_mark_present"
    assert by[DOC_NONE]["admission_path"] == "no_chunks"
    assert report["before"] == report["after"] and set(report["delta"].values()) == {0}
    assert report["mutations_performed"] == 0 and report["conclusion"] == "no_rewrite_required"


def test_fixture_seed_path_refuses_remote_before_any_write(monkeypatch):
    # Collection-safe (no DB needed): the seed/teardown connector must refuse a
    # remote URL before the driver is imported or any statement could run.
    import builtins

    real_import = builtins.__import__

    def no_driver(name, *a, **kw):
        if name == "asyncpg":
            raise AssertionError("asyncpg imported for a remote fixture URL")
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", no_driver)
    remote = "postgres://u:p@ep-purple-hall-ahimeyn0-pooler.us-east-2.aws.neon.tech/neondb"
    with pytest.raises(pre.PreflightRefused):
        asyncio.run(_fixture_connect(remote))


def test_remote_url_is_refused_by_connect_even_with_driver_available():
    with pytest.raises(pre.PreflightRefused):
        asyncio.run(
            pre._connect(
                "postgres://u:p@ep-purple-hall-ahimeyn0-pooler.us-east-2.aws.neon.tech/neondb"
            )
        )
