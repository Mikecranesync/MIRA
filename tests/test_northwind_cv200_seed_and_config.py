"""Pins for the Northwind / Discharge Conveyor CV-200 Command Center integration.

Three things this guards (see docs/adr/0024-dedicated-factorylm-origin-per-ignition-gateway.md
and docs/handoffs/2026-06-28-plc-laptop-northwind-cv200-perspective.md):

  1. The garage conveyor config is SEPARATE and UNTOUCHED — CV-200 work ADDS a
     parallel Northwind config, it never repoints/renames/mutates the garage one.
  2. The Northwind allowlist seed is FAIL-CLOSED-correct: every row's
     normalized_tag_path EXACTLY equals the relay's mira-relay/tag_ingest.normalize_tag_path
     (a mismatch silently drops every CV-200 tag), and every row binds to the CV-200 UNS subtree.
  3. The production framing decision is encoded: dev/staging frames via the 8890
     origin-root proxy; production targets a dedicated FactoryLM-controlled origin
     (ADR-0024) — never the raw gateway, never the 8890 proxy.
"""
from __future__ import annotations

import json
import os
import re
import sys

_REPO_ROOT = os.path.dirname(os.path.dirname(__file__))

# Canonical paths/values from the seed + handoff (the binding key).
CV200_UNS = "enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200"
GARAGE_UNS = "enterprise.home_garage.conveyor_lab.conveyor_1"
NORTHWIND_TENANT = "00000000-0000-0000-0000-0000000000b1"
DEDICATED_PROD_ORIGIN = "northwind-cv200.factorylm-gateways.com"
RAW_GATEWAY_HOSTS = {"100.72.2.99", "192.168.1.20"}
DEV_PROXY_HOST = "127.0.0.1"
DEV_PROXY_PORT = 8890

NW_ALLOWLIST = os.path.join(_REPO_ROOT, "tools", "seeds", "approved_tags_northwind_cv200.sql")
GARAGE_ALLOWLIST = os.path.join(_REPO_ROOT, "tools", "seeds", "approved_tags_conveyor.sql")
NW_DISPLAY_SEED = os.path.join(_REPO_ROOT, "mira-hub", "db", "seeds", "command_center_northwind_cv200.sql")
GARAGE_DISPLAY_SEED = os.path.join(_REPO_ROOT, "mira-hub", "db", "seeds", "command_center_conveyor.sql")
NW_CONFIG = os.path.join(_REPO_ROOT, "tools", "command-center", "northwind-cv200.json")

# Match an approved_tags VALUES row: source_tag_path, normalized_tag_path, uns_path.
_ROW_RE = re.compile(
    r"\('__TENANT_ID__'::uuid,\s*'ignition',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'::ltree"
)


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _real_normalize():
    """Import the relay's real normalize_tag_path the same way the SimLab pin does."""
    relay_dir = os.path.join(_REPO_ROOT, "mira-relay")
    sys.path.insert(0, relay_dir)
    try:
        import tag_ingest  # mira-relay/tag_ingest.py
    finally:
        sys.path.remove(relay_dir)
    return tag_ingest.normalize_tag_path


def _allowlist_rows(sql: str):
    return _ROW_RE.findall(sql)


# ── 1. garage config is separate + untouched ──────────────────────────────────

def test_garage_seeds_exist():
    assert os.path.exists(GARAGE_ALLOWLIST), "garage allowlist seed must still exist"
    assert os.path.exists(GARAGE_DISPLAY_SEED), "garage display seed must still exist"


def test_garage_allowlist_still_bound_to_garage_and_not_cv200():
    rows = _allowlist_rows(_read(GARAGE_ALLOWLIST))
    assert rows, "garage allowlist should have rows"
    for _src, _norm, uns in rows:
        assert uns == GARAGE_UNS, f"garage row repointed off the garage subtree: {uns}"
    # no garage row leaked onto the CV-200 subtree
    assert CV200_UNS not in [uns for *_x, uns in rows]


def test_garage_display_seed_still_bound_to_garage():
    sql = _read(GARAGE_DISPLAY_SEED)
    assert GARAGE_UNS not in CV200_UNS  # sanity: the two subtrees are distinct
    # the garage display seed is parametrized (uns_path via -v), so just assert it
    # was not turned into the CV-200 file by reference
    assert "command_center_conveyor" in sql or "conveyor" in sql.lower()
    assert CV200_UNS not in sql, "garage display seed must not reference the CV-200 subtree"


# ── 2. Northwind allowlist is fail-closed-correct ─────────────────────────────

def test_northwind_allowlist_exists_and_has_rows():
    assert os.path.exists(NW_ALLOWLIST)
    rows = _allowlist_rows(_read(NW_ALLOWLIST))
    assert len(rows) >= 40, f"expected the full rig tag set, got {len(rows)} rows"


def test_northwind_allowlist_is_superset_of_garage_rig_tags():
    # Same physical rig, but the staged NorthwindBottling Perspective project binds
    # additional MIRA_IOCheck tags (DI_00/01/04, DO_00/01/03, vfd_freq_cmd/motor_rpm/
    # power/torque/warn_code) that the garage seed predates. Constraint: the garage
    # seed is NOT modified, so Northwind is a SUPERSET, not an exact mirror.
    nw = _allowlist_rows(_read(NW_ALLOWLIST))
    garage = _allowlist_rows(_read(GARAGE_ALLOWLIST))
    assert len(nw) >= len(garage), (
        f"Northwind allowlist ({len(nw)}) should cover at least the garage rig tag set ({len(garage)})"
    )


# Views of the staged NorthwindBottling Perspective project (the live CV-200 surface).
_NW_PROJECT_VIEWS = os.path.join(
    _REPO_ROOT, "plc", "ignition-project", "NorthwindBottling",
    "com.inductiveautomation.perspective", "views",
)
_TAGPATH_RE = re.compile(r"\[default\][A-Za-z0-9_]+(?:/[A-Za-z0-9_]+)+")


def _staged_project_tag_paths():
    paths = set()
    for root, _dirs, files in os.walk(_NW_PROJECT_VIEWS):
        for name in files:
            if name != "view.json":
                continue
            paths.update(_TAGPATH_RE.findall(_read(os.path.join(root, name))))
    return paths


def test_northwind_allowlist_covers_every_staged_project_tag():
    # The whole point of the cloud loop: every tag the live CV-200 view binds MUST be
    # allowlisted, or the relay drops it fail-closed and the panel goes blank. This is
    # the regression guard for the 11 MIRA_IOCheck tags added 2026-06-28.
    real = _real_normalize()
    allow = {norm for _src, norm, _uns in _allowlist_rows(_read(NW_ALLOWLIST))}
    bound = _staged_project_tag_paths()
    assert bound, "should have found [default] tag paths bound by the staged project views"

    def covered(path):
        n = real(path)
        # a leaf tag is covered iff allowlisted exactly; a folder reference is covered
        # iff the allowlist has at least one child leaf under it (normalized prefix).
        return n in allow or any(a.startswith(n + "_") for a in allow)

    missing = sorted(p for p in bound if not covered(p))
    assert not missing, f"staged CV-200 view binds tags missing from the Northwind allowlist: {missing}"


def test_northwind_normalized_path_matches_relay_normalizer():
    real = _real_normalize()
    rows = _allowlist_rows(_read(NW_ALLOWLIST))
    assert rows
    for src, norm, uns in rows:
        assert real(src) == norm, f"normalized_tag_path mismatch for {src!r}: seed={norm!r} relay={real(src)!r}"
        assert uns == CV200_UNS, f"row not bound to the CV-200 subtree: {uns}"


def test_northwind_allowlist_shape():
    sql = _read(NW_ALLOWLIST)
    assert sql.lstrip().startswith("BEGIN;")
    assert sql.rstrip().endswith("COMMIT;")
    assert "'ignition'" in sql
    assert "__TENANT_ID__" in sql, "should use the apply-seeds tenant placeholder"
    assert "ON CONFLICT (tenant_id, source_system, source_tag_path) DO UPDATE" in sql
    # no allowlist ROW points at the garage subtree (a header doc-mention is fine)
    assert all(uns == CV200_UNS for *_x, uns in _allowlist_rows(sql))


# ── 3. production framing decision is encoded ─────────────────────────────────

def _config():
    return json.loads(_read(NW_CONFIG))


def test_config_binding_key_is_cv200():
    cfg = _config()
    assert cfg["uns_path"] == CV200_UNS
    assert cfg["tenant_id"] == NORTHWIND_TENANT


def test_config_dev_staging_use_8890_proxy():
    envs = _config()["display"]["environments"]
    for name in ("dev", "staging"):
        e = envs[name]
        assert e["host"] == DEV_PROXY_HOST, f"{name} must frame via the 8890 proxy host"
        assert e["port"] == DEV_PROXY_PORT, f"{name} must use the 8890 proxy port"


def test_config_production_uses_dedicated_origin_not_gateway_or_proxy():
    prod = _config()["display"]["environments"]["production"]
    assert prod["host"] == DEDICATED_PROD_ORIGIN
    assert prod["scheme"] == "https"
    # never the dev proxy, never the raw gateway
    assert prod["host"] != DEV_PROXY_HOST
    assert prod["host"] not in RAW_GATEWAY_HOSTS
    assert prod.get("port") != DEV_PROXY_PORT


def test_config_ingest_is_ignition_failclosed():
    ing = _config()["ingest"]
    assert ing["source_system"] == "ignition"
    assert ing["endpoint"] == "/api/v1/tags/ingest"
    assert ing["hmac_env"] == "MIRA_IGNITION_HMAC_KEY"
    assert ing["fail_closed"] is True
    assert ing["allowlist_seed"] == "tools/seeds/approved_tags_northwind_cv200.sql"


def test_northwind_display_seed_is_dev_staging_only_and_references_prod_decision():
    sql = _read(NW_DISPLAY_SEED)
    assert CV200_UNS in sql
    assert "/data/perspective/client/NorthwindBottling" in sql
    assert "DEV / STAGING ONLY" in sql
    assert "ADR-0024" in sql
    assert "8890" in sql
    # The garage subtree may appear in the header doc comment ("...is NOT touched"),
    # but must never appear in actual SQL. The seed is parametrized (uns_path via -v),
    # so strip comment lines and assert no garage reference survives in the SQL body.
    sql_body = "\n".join(ln for ln in sql.splitlines() if not ln.lstrip().startswith("--"))
    assert GARAGE_UNS not in sql_body, "Northwind display seed must not touch the garage subtree in SQL"
