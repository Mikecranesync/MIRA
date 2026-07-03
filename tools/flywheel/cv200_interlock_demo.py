"""
Weekend CV-200 interlock demo -- LOCAL, replayable, no DB / no PLC / no cloud.
=============================================================================
Proves the CONSUME side of the interlock flywheel (PR #2391): MIRA explains *why
CV-200 will not run* by grounding in APPROVED `kg_relationships` interlock edges --
factory context, not isolated tag values.

It reuses the production consume module `mira-bots/shared/interlock_context.py`
UNCHANGED. The only thing swapped for the store is an in-memory fake cursor that
serves the deterministic fixture through the REAL `recall_interlocks` -- so the
verified-only approval gate, tenant scope, and ltree subtree filter are all
genuinely exercised, without a Neon DB.

Guardrails: read-only (`evaluate_permissive` is a pure model; no PLC writes), no
Ignition, no live device, no secrets. The interlock feature flag
`MIRA_INTERLOCK_CONTEXT_ENABLED` stays DEFAULT-OFF: this runner gates inclusion on
a call-time `enabled` param (default = the env flag) and NEVER mutates os.environ.

    python tools/flywheel/cv200_interlock_demo.py --enable-interlock            # blocked (default)
    python tools/flywheel/cv200_interlock_demo.py --enable-interlock --clear    # running
    python tools/flywheel/cv200_interlock_demo.py                               # flag off -> no context
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "mira-bots" / "shared"))

from interlock_context import (  # noqa: E402
    build_interlock_answer,
    evaluate_permissive,
    recall_interlocks,
)

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "northwind_cv200_interlocks.json"
_DEFAULT_OUT = _REPO / "out" / "demo" / "cv200_interlock"
# mirrors engine._INTERLOCK_CONTEXT_ENABLED (default OFF); read at call-time, never flipped.
_ENV_FLAG = os.getenv("MIRA_INTERLOCK_CONTEXT_ENABLED", "0") == "1"


# --------------------------------------------------------------------------- #
# in-memory store + fake cursor (drives the REAL recall_interlocks)
# --------------------------------------------------------------------------- #
def _under_subtree(uns_path, subtree):
    """ltree <@ : descendant-or-equal (dot notation)."""
    return uns_path == subtree or uns_path.startswith(subtree + ".")


class InMemoryInterlockStore:
    """Deterministic, idempotent stand-in for kg_relationships + evidence.

    Seeding the same fixture twice yields the same edge set (keyed by
    (tenant, source, target, relationship_type)) -- proves seeder idempotency."""

    def __init__(self):
        self._edges: dict[tuple, dict] = {}

    def seed(self, fixture: dict) -> int:
        tenant = fixture["tenant_id"]
        for e in fixture["edges"]:
            key = (tenant, e["source"], e["target"], e["relationship_type"])
            self._edges[key] = {**e, "tenant_id": tenant}  # upsert -> idempotent
        return len(self._edges)

    def cursor(self):
        return _FakeCursor(self._edges)


class _FakeCursor:
    """Enough of a psycopg2 cursor for recall_interlocks: execute(sql, params) then
    fetchall() returns 8-col rows in the SELECT order, one per (edge, evidence)."""

    def __init__(self, edges: dict):
        self._edges = edges
        self._rows: list[tuple] = []

    def execute(self, sql, params):
        tenant = params["tenant"]
        subtree = params["subtree"]
        allow_proposed = "proposed" in sql  # include_unapproved rewrites the approval clause
        rows: list[tuple] = []
        for e in self._edges.values():
            if e["tenant_id"] != tenant:
                continue
            if not _under_subtree(e["uns_path"], subtree):
                continue
            if e["approval_state"] != "verified" and not allow_proposed:
                continue
            ev_list = e.get("evidence") or []
            if not ev_list:  # LEFT JOIN -> one row, evidence cols NULL
                rows.append((e["source"], e["target"], e["relationship_type"],
                             e.get("confidence"), e.get("evidence_summary"), None, None, None))
            for ev in ev_list:
                rows.append((e["source"], e["target"], e["relationship_type"],
                             e.get("confidence"), e.get("evidence_summary"),
                             ev.get("type"), ev.get("location"), ev.get("excerpt")))
        rows.sort(key=lambda r: (r[0], r[1]))  # ORDER BY se.name, te.name
        self._rows = rows

    def fetchall(self):
        return self._rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


# --------------------------------------------------------------------------- #
# demo orchestration
# --------------------------------------------------------------------------- #
def load_fixture(path=_FIXTURE) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def run_demo(enabled=None, photoeye_blocked=True, fixture_path=_FIXTURE,
             include_unapproved=False):
    """Run the local interlock demo. `enabled` gates interlock-context inclusion
    exactly like engine._build_interlock_context (default = the env flag)."""
    if enabled is None:
        enabled = _ENV_FLAG
    fx = load_fixture(fixture_path)
    asset, tenant, subtree = fx["asset"], fx["tenant_id"], fx["uns_subtree"]

    live = evaluate_permissive(photoeye_blocked=photoeye_blocked)

    if not enabled:
        # mirrors the engine gate: flag off -> no interlock context at all.
        return {"enabled": False, "included": False, "asset": asset, "tenant_id": tenant,
                "uns_subtree": subtree, "live_state": live, "recalled_edges": [],
                "answer": None, "note": "interlock context suppressed (MIRA_INTERLOCK_CONTEXT_ENABLED off)",
                "source": "local replay fixture (no DB, no PLC)"}

    store = InMemoryInterlockStore()
    store.seed(fx)
    with store.cursor() as cur:
        recalled = recall_interlocks(cur, tenant, subtree, include_unapproved=include_unapproved)
    answer = build_interlock_answer(recalled, live, asset)
    return {
        "enabled": True,
        "included": bool(recalled),
        "asset": asset, "tenant_id": tenant, "uns_subtree": subtree,
        "live_state": live,
        "recalled_edges": [{"source": e.source, "target": e.target,
                            "relationship_type": e.relationship_type} for e in recalled],
        "answer": answer,
        "source": "local replay fixture (no DB, no PLC)",
    }


def _report_md(r):
    L = ["# CV-200 interlock demo — grounded in approved factory context\n",
         "**Asset:** %s  " % r["asset"],
         "**UNS:** `%s`  " % r["uns_subtree"],
         "**Source:** %s  " % r["source"],
         "**Interlock context (`MIRA_INTERLOCK_CONTEXT_ENABLED`):** %s\n"
         % ("ON (scoped to this run)" if r["enabled"] else "OFF (default)")]
    if not r["enabled"]:
        L.append("> Flag off → MIRA surfaces **no** interlock context (isolated tags only). "
                 "This is the default-off baseline.\n")
        return "\n".join(L)
    L.append("## Approved interlock edges recalled (verified only)\n")
    for e in r["recalled_edges"]:
        L.append("- `%s -[%s]-> %s`" % (e["source"], e["relationship_type"], e["target"]))
    a = r["answer"]
    if a is None:
        L.append("\n## Answer\n\nNothing is blocked in the current live state.\n")
        return "\n".join(L)
    L.append("\n## MIRA answer (grounded)\n")
    L.append(a["why"] + "\n")
    L.append("- **Affected signal:** %s" % a["affected_signal"])
    L.append("- **Permissive FALSE:** %s" % a["permissive"])
    L.append("- **Active blocker:** %s = %s" % (a["blocking_tag"], a["blocking_value"]))
    L.append("\n## Evidence / citations\n")
    for ev in a["evidence"]:
        L.append("- **%s** `%s` — %s  \n  (edge: `%s`)"
                 % (ev.get("kind"), ev.get("location"), ev.get("excerpt"), ev.get("edge")))
    L.append("\n## Next checks\n")
    for c in a["next_checks"]:
        L.append("- " + c)
    L.append("")
    return "\n".join(L)


def write_artifacts(r, out_dir=_DEFAULT_OUT):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "interlock_answer.json", "w", encoding="utf-8") as f:
        json.dump(r, f, indent=2)
    with open(out_dir / "interlock_report.md", "w", encoding="utf-8") as f:
        f.write(_report_md(r))
    return str(out_dir)


def main():
    ap = argparse.ArgumentParser(description="Local CV-200 interlock demo (no DB/PLC/cloud)")
    ap.add_argument("--enable-interlock", action="store_true",
                    help="enable interlock context for THIS run only (flag stays default-off globally)")
    ap.add_argument("--clear", action="store_true", help="photoeye clear (conveyor runs) instead of blocked")
    ap.add_argument("--out", default=str(_DEFAULT_OUT))
    ap.add_argument("--no-write", action="store_true")
    args = ap.parse_args()

    r = run_demo(enabled=True if args.enable_interlock else None,
                 photoeye_blocked=not args.clear)
    print("=" * 70)
    print("CV-200 interlock demo — %s" % ("context ON (scoped)" if r["enabled"] else "context OFF (default)"))
    print("=" * 70)
    print("live state:", {k: r["live_state"][k] for k in ("photoeye_blocked", "vfd_run_permit", "motor_running")})
    if r["enabled"]:
        print("recalled approved edges:", len(r["recalled_edges"]))
        a = r["answer"]
        print("ANSWER:", a["why"] if a else "(nothing blocked)")
        if a:
            print("  citations:", len(a["evidence"]), "| grounded:", a["grounded"])
    else:
        print(r["note"])
    if not args.no_write:
        print("artifacts ->", write_artifacts(r, args.out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
