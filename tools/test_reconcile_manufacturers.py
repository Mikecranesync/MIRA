"""Offline tests for the dry-run manufacturer reconciliation planner (#1596).

These tests exercise the classification logic on a fixed sample list and prove
the planner does NOT touch a database or network in its default (file/stdin)
mode. The four canonical cases:

- "Alien-Bradley" → deterministic alias hit  → ``alias``
- "Cofemo"        → deterministic alias hit  → ``alias``
- "Deshazoo"      → not in the map, fuzzy-matches "Deshazo" → ``fuzzy``
- "Acme Hoist"    → no alias, no fuzzy hit   → ``unchanged``
"""

from __future__ import annotations

import sys

import reconcile_manufacturers as rm

SAMPLE = ["Alien-Bradley", "Cofemo", "Deshazoo", "Acme Hoist"]


def _by_raw(plans: list[rm.Plan]) -> dict[str, rm.Plan]:
    return {p.raw: p for p in plans}


def test_classification_of_sample_list() -> None:
    plans = rm.plan_reconciliation(SAMPLE)
    by_raw = _by_raw(plans)

    assert by_raw["Alien-Bradley"].action == "alias"
    assert by_raw["Alien-Bradley"].canonical == "Rockwell Automation"

    assert by_raw["Cofemo"].action == "alias"
    assert by_raw["Cofemo"].canonical == "Coffing"

    assert by_raw["Deshazoo"].action == "fuzzy"
    assert by_raw["Deshazoo"].canonical == "Deshazo"
    assert by_raw["Deshazoo"].needs_review is True

    assert by_raw["Acme Hoist"].action == "unchanged"
    assert by_raw["Acme Hoist"].canonical == "Acme Hoist"
    assert by_raw["Acme Hoist"].needs_review is False


def test_alias_hit_is_never_fuzzed() -> None:
    """An alias result must classify as ``alias``, never ``fuzzy`` — fuzzy is a
    fallback only for identity results."""
    plans = rm.plan_reconciliation(["Alien-Bradley", "Cofemo"])
    assert all(p.action == "alias" for p in plans)
    assert all(p.needs_review is False for p in plans)


def test_counts_summary() -> None:
    counts = rm.summarize(rm.plan_reconciliation(SAMPLE))
    assert counts == {"alias": 2, "fuzzy": 1, "unchanged": 1}


def test_default_mode_imports_no_db_driver() -> None:
    """The default (file/stdin) path must not import sqlalchemy — proves no DB
    or network call happens unless ``--from-db`` is explicitly requested.

    sqlalchemy must be imported LAZILY inside the --from-db branch. After a
    plan run, the module must not be present (assuming it was not already
    imported by the test runner itself — which it is not in this offline
    suite)."""
    sys.modules.pop("sqlalchemy", None)
    rm.plan_reconciliation(SAMPLE)
    assert "sqlalchemy" not in sys.modules, (
        "Default file/stdin mode pulled in sqlalchemy — DB access must be lazy "
        "and gated behind --from-db only."
    )


def test_from_db_refuses_prod_and_unknown_urls() -> None:
    """Fail-safe: the prod URL AND any unrecognized URL are NOT safe.

    A real Neon prod connection string uses the endpoint hostname
    (ep-<id>-pooler.<region>.aws.neon.tech), not the branch id / VPS IP /
    website domain — so a prod blocklist would be hollow. The allowlist
    refuses everything it doesn't recognize as safe."""
    unsafe_urls = [
        # Realistically-shaped prod Neon URL: endpoint host, no safe marker.
        "postgresql://u:p@ep-prod-endpoint-xyz-pooler.us-east-2.aws.neon.tech/mira",
        # Even URLs embedding prod metadata are unsafe (and so is anything else).
        "postgresql://u:p@165.245.138.91:5432/mira",
        "postgresql://u:p@db.factorylm.com/mira",
        "postgresql://u:p@ep-unknown-host-pooler.neon.tech/db",
    ]
    for url in unsafe_urls:
        assert rm.is_safe_url(url) is False, f"wrongly allowed unsafe URL: {url}"


def test_from_db_allows_known_safe_url() -> None:
    safe_urls = [
        "postgresql://u:p@ep-polished-hall-ahcqtcxe-pooler.neon.tech/db",  # staging endpoint
        "postgresql://u:p@ep-x.br-small-term-ahtkz61d.neon.tech/db",  # staging branch
        "postgresql://u:p@localhost:5432/mira_dev",
        "postgresql://u:p@127.0.0.1/mira",
    ]
    for url in safe_urls:
        assert rm.is_safe_url(url) is True, f"wrongly refused safe URL: {url}"


def test_read_from_db_blocks_before_connect_on_unsafe_url() -> None:
    """read_from_db must refuse (SystemExit) on an unsafe URL BEFORE importing
    sqlalchemy or opening any socket — proving the guard runs pre-connect."""
    import pytest

    sys.modules.pop("sqlalchemy", None)
    with pytest.raises(SystemExit):
        rm.read_from_db("postgresql://u:p@ep-prod-endpoint-pooler.neon.tech/mira")
    assert "sqlalchemy" not in sys.modules, (
        "read_from_db imported sqlalchemy before refusing — the prod guard must "
        "block before any DB driver loads or socket opens."
    )
