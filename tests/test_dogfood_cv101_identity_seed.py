"""Guards for the CV-101 dogfood identity seed (plan §2.4, ADR-0035 amendment 2026-08-23).

These are static assertions over the SQL text — no database required — in the same
style as ``tests/test_northwind_cv200_seed_and_config.py``. They exist because the
seed's correctness is mostly about what it *refuses* to do, and a runtime test on a
throwaway database would happily pass a seed that quietly re-keys production identity.

What is pinned:

  1. The seed NEVER writes ``kg_entities.entity_id``. Writing ``cv_101`` there blanks
     three working surfaces — ``context/route.ts``, ``signal-history/route.ts`` and the
     live-evidence packet — and none of them error; they return null, empty, blank.
     This is the mechanical form of the ADR amendment.
  2. BOTH label fields are updated. ``kg_entities.name`` was materialised at bridge
     INSERT time and nothing propagates a later ``cmms_equipment.description`` change,
     so a single UPDATE leaves the QR card and the KG surfaces disagreeing.
  3. Promotion to ``verified`` is scoped to one row BY ``entity_id`` — never a pattern,
     never a bare ``equipment_type`` sweep. proposed → verified is an evidenced act.
  4. The older staging probe seed asserts it is operating on a single CV-101 row.
     It must, and now for the opposite reason from the one first recorded here: the
     global unique constraint DID exist in production and migration 083 dropped it,
     so from now on two tenants may each hold a CV-101 and the seed's tenant-free
     UPDATE really can see more than one row.
"""

from __future__ import annotations

import os
import re

_REPO_ROOT = os.path.dirname(os.path.dirname(__file__))

IDENTITY_SEED = os.path.join(_REPO_ROOT, "tools", "seeds", "dogfood-cv101-identity.sql")
PROBE_SEED = os.path.join(_REPO_ROOT, "tools", "seeds", "staging-cv101-probe.sql")
BRIDGE_SEED = os.path.join(_REPO_ROOT, "tools", "seeds", "garage-cv101-kg-bridge.sql")
ADR = os.path.join(_REPO_ROOT, "docs", "adr", "0035-cv101-canonical-uns-path.md")
APPLY_SEEDS = os.path.join(_REPO_ROOT, ".github", "workflows", "apply-seeds.yml")

DISPLAY_NAME = "Discharge Conveyor"


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _statements(sql: str) -> list[str]:
    """Split on semicolons outside dollar-quoted blocks, with comments stripped."""
    body = re.sub(r"\$\$.*?\$\$", " DOLLAR_BLOCK ", sql, flags=re.S)
    body = re.sub(r"--[^\n]*", "", body)
    return [s.strip() for s in body.split(";") if s.strip()]


def test_seed_never_writes_entity_id() -> None:
    """The ADR amendment, mechanically: entity_id is read, never assigned."""
    sql = _read(IDENTITY_SEED)
    for stmt in _statements(sql):
        head = stmt.lstrip().upper()
        if not (head.startswith("UPDATE") or head.startswith("INSERT")):
            continue
        set_clause = re.search(r"\bSET\b(.*?)(?:\bFROM\b|\bWHERE\b|$)", stmt, flags=re.S | re.I)
        if set_clause:
            assert not re.search(r"\bentity_id\s*=", set_clause.group(1), flags=re.I), (
                "identity seed assigns kg_entities.entity_id; the canonical key is derived, "
                "not stored (ADR-0035 amendment 2026-08-23)"
            )
        if head.startswith("INSERT"):
            cols = re.search(r"\(([^)]*)\)", stmt)
            assert not (cols and re.search(r"\bentity_id\b", cols.group(1), flags=re.I)), (
                "identity seed INSERTs entity_id; only the bridge seed may write it"
            )


def test_seed_updates_both_description_and_kg_name() -> None:
    """One UPDATE is a bug: the two labels are materialised independently."""
    sql = _read(IDENTITY_SEED)
    updates = [s for s in _statements(sql) if s.lstrip().upper().startswith("UPDATE")]

    cmms = [s for s in updates if re.search(r"UPDATE\s+cmms_equipment", s, flags=re.I)
            and re.search(r"\bdescription\s*=", s, flags=re.I)]
    kg = [s for s in updates if re.search(r"UPDATE\s+kg_entities", s, flags=re.I)
          and re.search(r"\bname\s*=", s, flags=re.I)]

    assert cmms, "no UPDATE of cmms_equipment.description — the QR scan card keeps its stale label"
    assert kg, "no UPDATE of kg_entities.name — the KG surfaces keep the seed changelog string"
    assert DISPLAY_NAME in sql, f"display name must be ADR-0035's {DISPLAY_NAME!r}"

    # The kg name change collides with the (tenant, type, name) natural key if another
    # row already holds it; an unguarded UPDATE aborts the whole transaction.
    assert re.search(r"NOT\s+EXISTS", kg[0], flags=re.I), (
        "kg_entities.name UPDATE is unguarded against kg_entities_tenant_type_name_key (064)"
    )


def test_promotes_exactly_one_row_by_entity_id() -> None:
    """Promotion is scoped by entity_id, never by a pattern or a bare type sweep."""
    sql = _read(IDENTITY_SEED)
    promos = [
        s for s in _statements(sql)
        if s.lstrip().upper().startswith("UPDATE") and re.search(r"approval_state\s*=\s*'verified'", s, flags=re.I)
    ]
    assert len(promos) == 1, f"expected exactly one promotion statement, found {len(promos)}"
    promo = promos[0]

    assert re.search(r"k\.entity_id\s*=\s*ce\.id::text", promo, flags=re.I), (
        "promotion must be keyed on the bridge row's entity_id"
    )
    assert re.search(r"equipment_number\s*=\s*'CV-101'", promo, flags=re.I), (
        "promotion must be scoped to CV-101"
    )
    assert not re.search(r"\bLIKE\b|\bILIKE\b|~\*?\s*'", promo, flags=re.I), (
        "promotion uses a pattern match; proposed -> verified is per-row and evidenced"
    )


def test_seed_is_transactional_and_tenant_parameterised() -> None:
    sql = _read(IDENTITY_SEED)
    assert "BEGIN;" in sql and "COMMIT;" in sql, "seed must be a single transaction"
    assert ":tenant_id" in sql, "seed must be tenant-parameterised, not hardcoded to one tenant"
    # psql does not interpolate :variables inside dollar-quoted bodies; the seed must
    # hand the tenant through a GUC rather than silently comparing against nothing.
    if "$$" in sql:
        assert "SET LOCAL" in sql and "current_setting" in sql, (
            "a DO block reads the tenant; it must arrive via SET LOCAL + current_setting"
        )


def test_probe_seed_asserts_single_cv101_row() -> None:
    """Its tenant-free UPDATE is only safe if exactly one CV-101 row exists."""
    sql = _read(PROBE_SEED)
    assert "RAISE EXCEPTION" in sql, "probe seed must refuse to claim an arbitrary CV-101 row"
    assert re.search(r"count\(\*\).*cmms_equipment", sql, flags=re.S | re.I)
    # This assertion used to require that naming `cmms_equipment_equipment_number_key`
    # be accompanied by a "CORRECTION" disclaiming it, on the grounds that no migration
    # creates it. That was inferred from the migration folder. A read-only db-inspect
    # probe against PROD (2026-08-24) found the constraint present: it shipped with the
    # original CMMS schema, 012 added the per-tenant index alongside it, and nothing
    # ever dropped it — so `grep db/migrations` was the wrong place to look. Migration
    # 083 drops it. The guard is now inverted: if the file names the constraint, it must
    # also name the migration that removed it, so the false correction cannot return.
    if "cmms_equipment_equipment_number_key" in sql:
        assert "083" in sql, (
            "the global unique constraint was REAL in production and migration 083 dropped it; "
            "if this file names the constraint it must also name 083, or the next reader will "
            "'correct' it back to not existing"
        )


def test_bridge_seed_is_not_rewritten() -> None:
    """The applied bridge seed stays immutable; repairs are compensating seeds."""
    bridge = _read(BRIDGE_SEED)
    assert "ce.id::text" in bridge, (
        "bridge seed no longer writes the UUID into entity_id — every resolver depends on it"
    )
    assert "approval_state" not in bridge, (
        "bridge seed was edited to set approval_state; it is applied and therefore immutable — "
        "promote via tools/seeds/dogfood-cv101-identity.sql instead"
    )


def test_adr_amendment_present_and_consistent() -> None:
    adr = _read(ADR)
    assert "Amendment — 2026-08-23" in adr, "ADR-0035 must carry the derived-key amendment"
    assert "derived" in adr.lower()
    assert DISPLAY_NAME in adr, "the amendment must keep ADR-0035's display name"


def test_identity_seed_registered_but_not_in_all() -> None:
    """Rig-specific repair: reachable by name, never swept in by 'all'."""
    wf = _read(APPLY_SEEDS)
    assert "dogfood-cv101-identity" in wf, "seed is not discoverable from apply-seeds.yml"
    all_loop = re.search(r"for seed_name in ([^\n]*)", wf)
    assert all_loop, "could not locate the 'all' seed loop"
    assert "dogfood-cv101-identity" not in all_loop.group(1), (
        "a rig-specific identity repair must not run as part of 'all'"
    )


def test_migration_083_drops_the_global_tag_constraint_and_keeps_the_per_tenant_one() -> None:
    """Asset tags are unique per tenant, not globally.

    Production carried BOTH indexes on ``cmms_equipment`` (read-only db-inspect probe,
    2026-08-24)::

        cmms_equipment_equipment_number_key      (equipment_number)             global
        idx_cmms_equipment_number_tenant_unique  (tenant_id, equipment_number)  per tenant

    The global one meant the first tenant to use ``CV-101`` denied that tag to every
    other tenant, and made 409-vs-201 an oracle for which tags exist in other accounts.

    The half that matters most here is the SECOND assertion: dropping the wrong index
    would remove tag uniqueness altogether, letting one tenant hold two ``CV-101`` rows
    and making ``/api/assets/by-tag`` (``LIMIT 1``) silently pick one of them.
    """
    path = os.path.join(
        _REPO_ROOT, "mira-hub", "db", "migrations",
        "083_cmms_equipment_tag_unique_per_tenant.sql",
    )
    assert os.path.exists(path), "migration 083 is referenced by the probe seed and the tests"
    sql = _read(path)

    assert re.search(
        r"DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+cmms_equipment_equipment_number_key", sql, re.I
    ), "083 must drop the GLOBAL unique constraint"

    assert re.search(
        r"CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_cmms_equipment_number_tenant_unique",
        sql, re.I,
    ), "083 must leave a PER-TENANT unique index behind — never zero tag uniqueness"

    # The end-state assertions are the point: both statements above are IF EXISTS /
    # IF NOT EXISTS, so on a drifted database they can each be a silent no-op and the
    # migration still reports success. 083 must therefore VERIFY the outcome.
    #
    # Counting RAISE EXCEPTION is not enough — the FK guard contributes one, so a
    # count-based assertion survives deleting both end-state checks (confirmed by
    # mutation). Assert the distinctive shape of each check instead.
    assert re.search(r"NOT\s+LIKE\s+'%tenant_id%'", sql, re.I), (
        "083 must detect a SURVIVING global index — a unique index over equipment_number "
        "whose definition does not mention tenant_id"
    )
    assert re.search(
        r"pg_indexes[\s\S]{0,400}idx_cmms_equipment_number_tenant_unique", sql, re.I
    ), (
        "083 must confirm the per-tenant index exists afterwards; without that check a "
        "wrong drop leaves the table with NO tag uniqueness at all"
    )
    assert sql.count("RAISE EXCEPTION") >= 3, (
        "expected the FK guard plus both end-state guards"
    )
