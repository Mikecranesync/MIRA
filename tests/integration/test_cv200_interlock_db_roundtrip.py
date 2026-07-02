"""
CV-200 interlock DB round-trip integration test (Issue #2396).

Proves the DATABASE-backed lifecycle end-to-end through the REAL production path:

    propose  ->  approve  ->  recall  ->  answer

- **propose:** insert CV-200 interlock edges as `proposed` (with `plc_rung` evidence).
- **approve:** flip the verified chain via the REAL approval helper
  `proposal_transition.apply_kg_approval(..., trigger="accept")` (ADR-0017).
- **recall:** read them back with the REAL `interlock_context.recall_interlocks`
  (verified-only) — proposed edges must be excluded.
- **answer:** build the grounded explanation with the REAL
  `interlock_context.build_interlock_answer` — `plc_rung` citations must survive.

Safety / scope:
- **Skips cleanly** when `DATABASE_URL` is unset (locally verifiable skip path).
- Creates ONLY `CREATE TEMP TABLE` records: `pg_temp` is first in the search path, so the
  unqualified table names in the production SQL resolve to THESE temp tables, never the real
  `kg_*` tables. Temp tables are session-scoped and auto-dropped on disconnect; the test also
  rolls back. So it is safe even against staging Neon and touches no real rows.
- Does NOT modify `recall_interlocks` / `build_interlock_answer`; does NOT fake the answer logic.
- No PLC writes, no Ignition/Perspective, no live Ask MIRA / engine turn, and the interlock
  feature flag `MIRA_INTERLOCK_CONTEXT_ENABLED` is neither read for behavior nor enabled here.

    DATABASE_URL=postgres://...  pytest tests/integration/test_cv200_interlock_db_roundtrip.py -q
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "mira-bots" / "shared"))

from interlock_context import (  # noqa: E402  (real production consume path)
    build_interlock_answer,
    evaluate_permissive,
    recall_interlocks,
)
from proposal_transition import apply_kg_approval  # noqa: E402  (real ADR-0017 approval helper)

_TENANT = "cv200-db-it"
_SUBTREE = "enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200"
_ASSET = "Discharge Conveyor CV-200"
_RUNG_214 = "vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched;"
_RUNG_236 = "motor_running := vfd_run_permit AND (dir_fwd OR dir_rev);"

# (source, target, relationship_type, approve?, evidence[(location, excerpt)])
_EDGES = [
    ("e_stop_ok", "vfd_run_permit", "USED_IN_LOGIC", True,
     [("Prog_init_ConvSimple_v2.1.st:214", _RUNG_214)]),
    ("_IO_EM_DO_02", "vfd_run_permit", "USED_IN_LOGIC", True,
     [("Prog_init_ConvSimple_v2.1.st:214", _RUNG_214)]),
    ("vfd_run_permit", "motor_running", "USED_IN_LOGIC", True,
     [("Prog_init_ConvSimple_v2.1.st:236", _RUNG_236)]),
    ("pe_latched", "vfd_run_permit", "CAUSES", True,
     [("Prog_init_ConvSimple_v2.1.st:214", _RUNG_214)]),
    # deliberately left PROPOSED (unapproved) -> must never reach a verified-only answer
    ("dust_collector_ok", "vfd_run_permit", "USED_IN_LOGIC", False,
     [("proposal:auto", "plausible but unverified permissive operand")]),
    ("upstream_jam", "motor_running", "CAUSES", False,
     [("proposal:auto", "unverified downstream cause")]),
]

_DDL = """
CREATE TEMP TABLE kg_entities (
    id text PRIMARY KEY, name text NOT NULL, uns_path ltree
) ON COMMIT DROP;
CREATE TEMP TABLE relationship_proposals (
    id text PRIMARY KEY, tenant_id text, status text DEFAULT 'proposed'
) ON COMMIT DROP;
CREATE TEMP TABLE relationship_evidence (
    id text PRIMARY KEY, proposal_id text, evidence_type text,
    page_or_location text, excerpt text
) ON COMMIT DROP;
CREATE TEMP TABLE kg_relationships (
    id text PRIMARY KEY, tenant_id text, source_id text, target_id text,
    relationship_type text, confidence real, evidence_summary text,
    approval_state text DEFAULT 'proposed', relationship_proposal_id text
) ON COMMIT DROP;
"""


def _entities():
    names = {s for e in _EDGES for s in (e[0], e[1])}
    return sorted(names)


# ---- always-on static guards (no DB needed) -------------------------------- #
def test_default_off_behaviour_preserved():
    """The engine gate stays default-OFF and the consume functions used here don't read it."""
    engine_src = (_REPO / "mira-bots" / "shared" / "engine.py").read_text(encoding="utf-8")
    assert 'os.getenv("MIRA_INTERLOCK_CONTEXT_ENABLED", "0")' in engine_src
    # the recall/answer path is flag-agnostic (the gate is engine-only) -> nothing here enables it
    ic_src = (_REPO / "mira-bots" / "shared" / "interlock_context.py").read_text(encoding="utf-8")
    assert "MIRA_INTERLOCK_CONTEXT_ENABLED" not in ic_src


def test_uses_real_production_path_no_plc_no_ui():
    """The symbols under test are the REAL production functions (not local reimplementations),
    and that production path carries no PLC-write / UI / live-Ask-MIRA wiring."""
    assert recall_interlocks.__module__ == "interlock_context"
    assert build_interlock_answer.__module__ == "interlock_context"
    assert apply_kg_approval.__module__ == "proposal_transition"
    for mod in ("interlock_context.py", "proposal_transition.py"):
        src = (_REPO / "mira-bots" / "shared" / mod).read_text(encoding="utf-8")
        for marker in ("pymodbus", "write_register", "write_coil", "webBrowser",
                       "/system/webdev", "/api/v1/ignition/chat", ":8094"):
            assert marker not in src, "%s must carry no %s" % (mod, marker)


# ---- the DB round-trip (skips without DATABASE_URL) ------------------------- #
@pytest.mark.skipif(not os.getenv("DATABASE_URL"),
                    reason="DATABASE_URL not set — DB round-trip skipped (CI/staging runs it)")
def test_cv200_interlock_db_roundtrip():
    try:
        import psycopg2  # noqa: PLC0415
    except ImportError:  # pragma: no cover
        pytest.skip("psycopg2 not installed")

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            try:
                cur.execute("CREATE EXTENSION IF NOT EXISTS ltree")
            except Exception:  # already installed on the real DB; ignore a perms notice
                conn.rollback()
            cur.execute(_DDL)

            # entities under the CV-200 subtree (uns_path <@ subtree matches on equality)
            for name in _entities():
                cur.execute(
                    "INSERT INTO kg_entities (id, name, uns_path) VALUES (%s, %s, %s::ltree)",
                    ("ent_%s" % name, name, _SUBTREE),
                )

            # PROPOSE: proposal + evidence + a 'proposed' kg_relationships row per edge
            rel_ids: list[tuple[str, bool]] = []
            for i, (src, tgt, rel, approve, evs) in enumerate(_EDGES):
                pid, rid = "prop_%d" % i, "rel_%d" % i
                cur.execute(
                    "INSERT INTO relationship_proposals (id, tenant_id, status) VALUES (%s,%s,'proposed')",
                    (pid, _TENANT),
                )
                for j, (loc, excerpt) in enumerate(evs):
                    cur.execute(
                        "INSERT INTO relationship_evidence "
                        "(id, proposal_id, evidence_type, page_or_location, excerpt) "
                        "VALUES (%s,%s,'plc_rung',%s,%s)",
                        ("ev_%d_%d" % (i, j), pid, loc, excerpt),
                    )
                cur.execute(
                    "INSERT INTO kg_relationships "
                    "(id, tenant_id, source_id, target_id, relationship_type, confidence, "
                    " evidence_summary, approval_state, relationship_proposal_id) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,'proposed',%s)",
                    (rid, _TENANT, "ent_%s" % src, "ent_%s" % tgt, rel, 1.0, None, pid),
                )
                rel_ids.append((rid, approve))

            # APPROVE the verified chain through the REAL helper (proposed -> verified)
            for rid, approve in rel_ids:
                if approve:
                    wrote = apply_kg_approval(cur, table="kg_relationships", row_id=rid,
                                              trigger="accept", tenant_id=_TENANT)
                    assert wrote is True

            # RECALL: verified-only (production default)
            recalled = recall_interlocks(cur, _TENANT, _SUBTREE)
            srcs = {e.source for e in recalled}
            assert len(recalled) == 4, "expected 4 approved edges, got %d" % len(recalled)
            assert "dust_collector_ok" not in srcs and "upstream_jam" not in srcs

            # the approval gate is what filters: include_unapproved surfaces the proposed edges
            with_proposed = recall_interlocks(cur, _TENANT, _SUBTREE, include_unapproved=True)
            assert {"dust_collector_ok", "upstream_jam"} <= {e.source for e in with_proposed}

            # ANSWER: grounded explanation of the blocked permissive, citations survive round-trip
            live = evaluate_permissive(photoeye_blocked=True)
            ans = build_interlock_answer(recalled, live, _ASSET)
            assert ans is not None
            assert ans["affected_signal"] == "motor_running"
            assert ans["permissive"] == "vfd_run_permit"
            assert ans["blocking_tag"] == "pe_latched" and ans["blocking_value"] is True
            assert ans["grounded"] is True
            kinds = {e["kind"] for e in ans["evidence"]}
            assert "plc_rung" in kinds
            locs = {e.get("location") for e in ans["evidence"]}
            assert any("Prog_init_ConvSimple" in (loc or "") for loc in locs)
    finally:
        conn.rollback()  # temp tables are ON COMMIT DROP + session-scoped; nothing persists
        conn.close()
