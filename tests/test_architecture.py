"""Architecture boundary tests — enforce module isolation contracts.

These tests verify that module boundaries are not violated by checking
import statements in source files. Replaces import-linter for monorepos
with non-standard Python package layouts.

Contracts:
  1. mira-bots cannot import from mira-crawler
  2. mira-crawler cannot import from mira-bots
  3. mira-mcp cannot import from mira-bots or mira-crawler
  4. No module imports from mira-core internal DB layer directly
"""

from __future__ import annotations

import ast
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# Match Python import lines: "import X" or "from X import Y"
_IMPORT_RE = re.compile(r"^\s*(?:from|import)\s+([\w.]+)", re.MULTILINE)

# Repo root
_ROOT = Path(__file__).resolve().parent.parent


def _collect_imports(module_dir: Path) -> list[tuple[Path, str]]:
    """Return [(file_path, imported_module), ...] for all .py files in a directory."""
    results = []
    for py_file in module_dir.rglob("*.py"):
        # Skip test files and __pycache__
        if "__pycache__" in str(py_file) or "/tests/" in str(py_file):
            continue
        text = py_file.read_text(errors="replace")
        for match in _IMPORT_RE.finditer(text):
            results.append((py_file.relative_to(_ROOT), match.group(1)))
    return results


def _assert_no_forbidden_imports(
    source_dir: str,
    forbidden_patterns: list[str],
    contract_name: str,
):
    """Assert that no file in source_dir imports from forbidden_patterns."""
    module_path = _ROOT / source_dir
    if not module_path.exists():
        return  # Module doesn't exist, nothing to check

    imports = _collect_imports(module_path)
    violations = []
    for file_path, imported in imports:
        for pattern in forbidden_patterns:
            if imported.startswith(pattern):
                violations.append(f"  {file_path}: imports '{imported}'")

    assert not violations, (
        f"Architecture violation: {contract_name}\n" + "\n".join(violations)
    )


# ---------------------------------------------------------------------------
# Contract 1: Bots cannot import from crawler
# ---------------------------------------------------------------------------

def test_bots_cannot_import_crawler():
    _assert_no_forbidden_imports(
        "mira-bots",
        ["mira_crawler", "crawler"],
        "Bots cannot import from crawler",
    )


# ---------------------------------------------------------------------------
# Contract 2: Crawler cannot import from bots
# ---------------------------------------------------------------------------

def test_crawler_cannot_import_bots():
    _assert_no_forbidden_imports(
        "mira-crawler",
        ["shared.engine", "shared.guardrails", "shared.inference", "shared.workers"],
        "Crawler cannot import from bots/shared",
    )


# ---------------------------------------------------------------------------
# Contract 3: MCP server cannot import from bots or crawler
# ---------------------------------------------------------------------------

def test_mcp_cannot_import_bots():
    _assert_no_forbidden_imports(
        "mira-mcp",
        ["shared.engine", "shared.guardrails", "shared.inference", "shared.workers"],
        "MCP cannot import from bots/shared",
    )


def test_mcp_cannot_import_crawler():
    _assert_no_forbidden_imports(
        "mira-mcp",
        ["mira_crawler", "crawler"],
        "MCP cannot import from crawler",
    )


# ---------------------------------------------------------------------------
# Contract 4: No module imports from mira-core internal DB layer
# ---------------------------------------------------------------------------

def test_bots_cannot_import_core_db():
    _assert_no_forbidden_imports(
        "mira-bots",
        ["db.neon", "mira_core.mira_ingest.db"],
        "Bots cannot import from mira-core DB internals",
    )


def test_mcp_cannot_import_core_db():
    _assert_no_forbidden_imports(
        "mira-mcp",
        ["db.neon", "mira_core.mira_ingest.db"],
        "MCP cannot import from mira-core DB internals",
    )


# ===========================================================================
# Contract 5: the ONE-PIPELINE law (FactoryLM/MIRA canonical ingest contract)
# ===========================================================================
#
#   Source → ingest_contract → ingest_batch → contextualization → MIRA
#
# Every factory data SOURCE (garage conveyor, MQTT devices, Sparkplug, Ignition,
# PLC feeds, customer factories) MUST enter through the ONE canonical contract.
# No transport/ingest module may create its OWN:
#   • tag-path normalizer        (the fail-closed allowlist match key)
#   • allowlist logic            (querying approved_tags itself)
#   • persistence path           (its own store / persist_batch)
#   • direct database write      (INSERT/UPDATE tag_events / live_signal_cache)
#   • rival ingest batch shape   (an inline {source_system, tags} dict)
#   • rival enforcement path     (its own ingest_batch / pipeline)
#
# The single allowed homes:
#   normalize_tag_path / build_tag_entry / build_ingest_batch → ingest_contract.py
#   ingest_batch / NeonTagStore.{load_allowlist,persist_batch} / store writes → tag_ingest.py
#
# Doctrine: .claude/rules/one-pipeline-ingest.md. This test is the enforcement.
# A SaaS-emit publisher pushing its own data to a broker (SimLab MqttPublisher)
# is a legitimate producer — emit is NOT forbidden; a rival LANDING path is.
# Plant/control writes are a separate concern (.claude/rules/fieldbus-readonly.md).

# The ingest "surface": production modules that are transports/inlets or could
# become one (Lane 3 lands in mira-relay/mqtt_ingest/). DEFAULT-DENY — every file
# here must conform unless explicitly allowlisted below, with a reason.
_INGEST_SURFACE_GLOBS = [
    "mira-relay/*.py",
    "mira-relay/**/*.py",   # future transports, e.g. mira-relay/mqtt_ingest/
    "simlab/publishers.py",
]

# The ONLY modules permitted to DEFINE the contract primitives. Each entry MUST
# carry a reason (acceptance criterion: legitimate modules allowlisted explicitly).
_ONE_PIPELINE_ALLOWLIST: dict[str, str] = {
    "mira-relay/ingest_contract.py":
        "THE canonical contract — the one allowed home for normalize_tag_path, "
        "build_tag_entry and build_ingest_batch (and the canonical {source_system, "
        "tags} shape they emit).",
    "mira-relay/tag_ingest.py":
        "THE canonical pipeline — defines ingest_batch (enforcement) + NeonTagStore "
        "(load_allowlist, persist_batch) and holds the ONLY writes to tag_events / "
        "live_signal_cache; re-exports the normalizer from ingest_contract.",
    "mira-relay/relay_server.py":
        "THE canonical HTTP route — authenticates and calls ingest_batch; mentions "
        "approved_tags only in its docstring.",
}

# Defining any of these (a FunctionDef / method) outside the canonical core is a
# rival primitive → forbidden.
_FORBIDDEN_DEFS = {
    "normalize_tag_path": "defines its own tag-path normalizer (import ingest_contract.normalize_tag_path)",
    "build_ingest_batch": "defines its own batch builder (import ingest_contract.build_ingest_batch)",
    "build_tag_entry": "defines its own tag-entry builder (import ingest_contract.build_tag_entry)",
    "ingest_batch": "defines its own ingest pipeline (call tag_ingest.ingest_batch)",
    "persist_batch": "defines its own persistence (use NeonTagStore via ingest_batch)",
    "load_allowlist": "defines its own allowlist (ingest_batch enforces approved_tags)",
}

# A write that lands the canonical stores directly (must go through ingest_batch).
_STORE_WRITE_RE = re.compile(
    r"\b(insert\s+into|update)\s+(public\.)?(tag_events|live_signal_cache)\b", re.IGNORECASE
)
# Querying the allowlist table directly (enforcement belongs to ingest_batch).
_ALLOWLIST_SQL_RE = re.compile(
    r"\b(from|into|join|update)\s+(public\.)?approved_tags\b", re.IGNORECASE
)


def _line_of(source: str, idx: int) -> int:
    return source[:idx].count("\n") + 1


def scan_ingest_module(rel_path: str, source: str) -> list[str]:
    """Return a list of ONE-PIPELINE violations in one module's source (empty = OK).

    Pure function — unit-tested directly against fixtures so the guard itself is
    proven to catch violations (not just trusted)."""
    violations: list[str] = []
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:  # pragma: no cover - shouldn't happen on repo code
        return [f"{rel_path}: unparseable ({exc})"]

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in _FORBIDDEN_DEFS:
            violations.append(f"{rel_path}:{node.lineno} {_FORBIDDEN_DEFS[node.name]}")
        # Rival batch shape: an inline {…"source_system"…"tags"…} dict literal.
        if isinstance(node, ast.Dict):
            keys = {k.value for k in node.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)}
            if {"source_system", "tags"} <= keys:
                violations.append(
                    f"{rel_path}:{node.lineno} builds an ingest batch inline "
                    f"(use ingest_contract.build_ingest_batch)"
                )
        # Rival persistence: calling .persist_batch( anywhere but the pipeline.
        if isinstance(node, ast.Attribute) and node.attr == "persist_batch":
            violations.append(
                f"{rel_path}:{node.lineno} calls persist_batch directly "
                f"(only tag_ingest.ingest_batch may persist)"
            )

    for m in _STORE_WRITE_RE.finditer(source):
        violations.append(
            f"{rel_path}:{_line_of(source, m.start())} writes a canonical store directly "
            f"(route through ingest_batch / NeonTagStore)"
        )
    for m in _ALLOWLIST_SQL_RE.finditer(source):
        violations.append(
            f"{rel_path}:{_line_of(source, m.start())} queries approved_tags directly "
            f"(allowlist enforcement belongs to ingest_batch)"
        )
    return violations


def _ingest_surface_files() -> list[Path]:
    seen: set[Path] = set()
    for pattern in _INGEST_SURFACE_GLOBS:
        for p in _ROOT.glob(pattern):
            if not p.is_file() or p.suffix != ".py":
                continue
            parts = p.parts
            if "__pycache__" in parts or "tests" in parts or p.name.startswith("test_"):
                continue
            seen.add(p)
    return sorted(seen)


def test_ingest_surface_obeys_one_pipeline():
    """No transport/ingest module forks the canonical contract.

    Protects: Source → ingest_contract → ingest_batch → contextualization → MIRA.
    Doctrine + how to fix: .claude/rules/one-pipeline-ingest.md."""
    offenders: list[str] = []
    for path in _ingest_surface_files():
        rel = path.relative_to(_ROOT).as_posix()
        if rel in _ONE_PIPELINE_ALLOWLIST:
            continue
        offenders.extend(scan_ingest_module(rel, path.read_text(errors="replace")))
    assert not offenders, (
        "ONE-PIPELINE law violated — a transport forked the canonical ingest contract.\n"
        "Route through mira-relay/ingest_contract.py + ingest_batch instead. See "
        ".claude/rules/one-pipeline-ingest.md.\n\n" + "\n".join(offenders)
    )


def test_one_pipeline_allowlist_is_honest():
    """Every allowlisted file must exist and carry a non-trivial reason."""
    for rel, reason in _ONE_PIPELINE_ALLOWLIST.items():
        assert (_ROOT / rel).is_file(), f"allowlisted file missing: {rel}"
        assert len(reason) >= 30, f"allowlist entry needs a real reason: {rel}"


def test_one_pipeline_checker_catches_violations():
    """The guard must FAIL on obvious forks (so a green run means something)."""
    bad_cases = {
        "own normalizer": "def normalize_tag_path(raw):\n    return raw.lower()\n",
        "own pipeline": "def ingest_batch(payload, tenant, store):\n    return None\n",
        "own persistence": "class S:\n    def persist_batch(self, e, s):\n        return 0\n",
        "rival batch shape": "payload = {'source_system': 'mqtt', 'tags': []}\n",
        "direct store write": "cur.execute('INSERT INTO tag_events (x) VALUES (1)')\n",
        "direct allowlist query": "cur.execute('SELECT 1 FROM approved_tags WHERE x=1')\n",
        "rival persist call": "store.persist_batch(events, state)\n",
    }
    for label, src in bad_cases.items():
        assert scan_ingest_module("bad.py", src), f"checker missed a violation: {label}"

    # A conforming transport (uses the canonical contract) is clean.
    good = (
        "from ingest_contract import build_ingest_batch, build_tag_entry\n"
        "from tag_ingest import ingest_batch\n"
        "def land(msgs, tenant, store):\n"
        "    tags = [build_tag_entry(m['p'], m['v']) for m in msgs]\n"
        "    return ingest_batch(build_ingest_batch('mqtt', tags), tenant, store)\n"
    )
    assert scan_ingest_module("good.py", good) == []


# ---------------------------------------------------------------------------
# Contract 6: KB write-sites never stamp the chunk ordinal into source_page
# ---------------------------------------------------------------------------
# knowledge_entries.source_page must hold the REAL document page (or NULL) —
# never the chunker's sequential chunk index. Legacy write-sites that did this
# mis-paginated ~73% of the corpus and made citations fabricate page numbers
# ("p. 47" meaning "chunk 47") — issue #2968, render guard PR #2967. The
# ordinal belongs in metadata.chunk_index (dedup key, migration 003 partial
# unique index). Model write-sites: mira-crawler/ingest/store.py and
# mira-hub/src/lib/node-knowledge-ingest.ts.

_KB_WRITE_SURFACE_GLOBS = [
    "mira-core/scripts/*.py",
    "mira-core/mira-ingest/db/*.py",
    "mira-crawler/ingest/*.py",
    "mira-bots/tools/*.py",
]


def scan_source_page_stamp(rel_path: str, source: str) -> list[str]:
    """Return violations where source_page is assigned a chunk-ordinal value.

    Pure function — unit-tested against fixtures below so the guard is proven
    to catch violations. Flags a dict literal or keyword argument that binds
    "source_page" to a name/attribute containing "chunk" (chunk_idx,
    chunk_index, self.chunk_index, ...)."""

    def _is_chunk_valued(node: ast.expr) -> bool:
        if isinstance(node, ast.Name):
            return "chunk" in node.id.lower()
        if isinstance(node, ast.Attribute):
            return "chunk" in node.attr.lower()
        return False

    violations: list[str] = []
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:  # pragma: no cover - shouldn't happen on repo code
        return [f"{rel_path}: unparseable ({exc})"]

    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if (
                    isinstance(key, ast.Constant)
                    and key.value == "source_page"
                    and _is_chunk_valued(value)
                ):
                    violations.append(
                        f"{rel_path}:{value.lineno} stamps a chunk ordinal into source_page "
                        f"(use the real page_num or None; ordinal goes in metadata.chunk_index)"
                    )
        elif isinstance(node, ast.Call):
            for kw in node.keywords:
                if kw.arg == "source_page" and _is_chunk_valued(kw.value):
                    violations.append(
                        f"{rel_path}:{kw.value.lineno} passes a chunk ordinal as source_page "
                        f"(use the real page_num or None; ordinal goes in metadata.chunk_index)"
                    )
    return violations


def _kb_write_surface_files() -> list[Path]:
    seen: set[Path] = set()
    for pattern in _KB_WRITE_SURFACE_GLOBS:
        for p in _ROOT.glob(pattern):
            if not p.is_file() or p.suffix != ".py":
                continue
            parts = p.parts
            if "__pycache__" in parts or "tests" in parts or p.name.startswith("test_"):
                continue
            seen.add(p)
    return sorted(seen)


def test_kb_writes_never_stamp_chunk_ordinal_as_source_page():
    """No KB ingest write-site stamps the chunk index into source_page (#2968)."""
    offenders: list[str] = []
    for path in _kb_write_surface_files():
        rel = path.relative_to(_ROOT).as_posix()
        offenders.extend(scan_source_page_stamp(rel, path.read_text(errors="replace")))
    assert not offenders, (
        "source_page must be the real document page (or None), never the chunk "
        "ordinal — see issue #2968 and Contract 6 in this file.\n\n" + "\n".join(offenders)
    )


def test_source_page_checker_catches_violations():
    """The Contract 6 guard must FAIL on the known bad shapes."""
    bad_cases = {
        "dict literal chunk_idx": 'row = {"source_page": chunk_idx}\n',
        "dict literal chunk_index": 'row = {"source_page": chunk_index}\n',
        "keyword arg": "insert(source_page=chunk_index)\n",
        "attribute value": 'row = {"source_page": self.chunk_index}\n',
    }
    for label, src in bad_cases.items():
        assert scan_source_page_stamp("bad.py", src), f"checker missed: {label}"

    good_cases = {
        "real page dict": 'row = {"source_page": chunk.get("page_num")}\n',
        "real page kwarg": "insert(source_page=page_num)\n",
        "null page": 'row = {"source_page": None}\n',
        "ordinal in metadata": 'meta = {"chunk_index": chunk_idx}\n',
    }
    for label, src in good_cases.items():
        assert scan_source_page_stamp("good.py", src) == [], f"false positive: {label}"


# ---------------------------------------------------------------------------
# Contract 7: no seed promotes knowledge_entries to verified=true on shape alone
# ---------------------------------------------------------------------------
# .claude/rules/oem-crawler-trusted.md, "The backfill selector is not a
# provenance test": source_type='equipment_manual' AND manufacturer<>'' is an
# output SHAPE shared by ManufacturerCrawler (curated, trusted), CSVCrawler
# (heuristic, untrusted), and tasks/ingest.py::ingest_url (untrusted). No
# column stored by insert_chunk records which writer produced a row, so a
# promotion keyed on that shape silently trusts untrusted content — the exact
# defect the 2026-07-29 audit found and pulled tools/seeds/backfill_oem_*.sql
# for (see SP1 commit 3b7cebdcb).
#
# FIX ROUND 1 (this comment documents the correction): the first version of
# this guard accepted ANY literal tenant_id anywhere in the statement as
# provable provenance, including one that appeared in the SET clause. The
# real pulled backfill (git show 0bde5f2e5:tools/seeds/backfill_oem_crawler_chunks.sql)
# does exactly that:
#     UPDATE knowledge_entries ke
#        SET tenant_id = '78917b56-...',   -- MOVES the row to the shared tenant
#            verified  = true
#      WHERE ke.tenant_id::text = 'e88bd0e8-...'   -- the row's OLD (garage) tenant
#        AND ke.source_type = 'equipment_manual'
#        AND ke.manufacturer <> '';
# The WHERE-clause tenant_id literal there identifies the tenant being moved
# FROM, not evidence about who wrote the row — the actual selector doing the
# work is the shape predicate (source_type/manufacturer). The old regex
# matched "tenant_id = '<uuid>'" wherever it appeared (including inside the
# SET clause, which isn't even a restriction) and let this straight through.
#
# The corrected rule distinguishes two genuinely different statement shapes:
#   - SAME-TENANT promotion (no `tenant_id` reassignment in SET): a literal
#     tenant_id in WHERE IS provable provenance — the row already lives in a
#     pinned trust-boundary tenant (tools/seeds/backfill_verified_corpus.sql:
#     `SET verified = true WHERE tenant_id = '<shared>'`). Accept source_url
#     OR a literal tenant_id in WHERE.
#   - CROSS-TENANT promotion (SET reassigns `tenant_id`): the statement moves
#     rows across the trust boundary AND trusts them in the same step. A
#     tenant_id literal in WHERE only ever describes the SOURCE tenant (the
#     untrusted side) — it can never justify the move. Only a source_url
#     restriction (the row's individually re-fetchable origin) is accepted.
# source_type / manufacturer, alone or together, are NEVER accepted in either
# shape — that is precisely the shape-only pattern the rule forbids.

_SEEDS_DIR = "tools/seeds"

# One UPDATE ... knowledge_entries ... ; statement, across lines.
_UPDATE_KE_STMT_RE = re.compile(
    r"UPDATE\s+(?:public\.)?knowledge_entries\b.*?;", re.IGNORECASE | re.DOTALL
)
# The statement promotes rows to verified = true (the SET clause, not a WHERE
# comparison like "verified IS DISTINCT FROM true", which this regex does not
# match because it requires the literal "= true"/"=true" shape).
_SETS_VERIFIED_TRUE_RE = re.compile(r"\bverified\s*=\s*true\b", re.IGNORECASE)
# The SET clause reassigns tenant_id — i.e. this statement moves rows across
# a tenant boundary, not merely promotes rows already inside one. Matched
# against the pre-WHERE portion of the statement only (see scan below) so a
# tenant_id literal that happens to live in a subquery's WHERE can't be
# mistaken for a SET-clause assignment.
_SET_TENANT_ID_RE = re.compile(r"\bSET\b.*?\btenant_id\s*=", re.IGNORECASE | re.DOTALL)
# Accepted provenance predicate #1 (either shape): a source_url host/domain
# restriction — the row's origin URL is directly checkable.
_SOURCE_URL_RESTRICTION_RE = re.compile(
    r"\bsource_url\s*(?:like|ilike|~|~\*|=)\s*'", re.IGNORECASE
)
# Accepted provenance predicate #2 (SAME-TENANT shape only): tenant_id pinned
# to a literal UUID in the WHERE clause. Optional ::type cast tolerated
# (e.g. "tenant_id::text = '...'", "tenant_id = '...'::uuid") since both
# forms appear in real seeds.
_TENANT_ID_LITERAL_RE = re.compile(
    r"\btenant_id\s*(?:::\w+)?\s*=\s*'[0-9a-fA-F-]{36}'", re.IGNORECASE
)


def scan_verified_promotion(rel_path: str, source: str) -> list[str]:
    """Return violations where a seed promotes knowledge_entries rows to
    verified=true without a provable-provenance predicate in the same
    statement.

    Pure function — unit-tested directly against fixtures below (including
    the REAL historical defect, recovered from git) so the guard is proven
    to catch a shape-only promotion, not just trusted. Text/regex scan, not
    a SQL parser: matches literal UPDATE...; statement bodies only
    (INSERT ... VALUES (..., true, ...) seeding rows one at a time is NOT in
    scope — the doctrine's "shape alone" defect is specifically a bulk
    backfill selector, which is always an UPDATE).

    A statement is split at its first top-level WHERE into `set_part` (used
    only to detect a cross-tenant SET tenant_id = ...) and `where_part` (used
    to look for the accepted provenance predicates). See the Contract 7
    comment block above for why a WHERE-clause tenant_id literal is valid
    provenance for a same-tenant promotion but NOT for a cross-tenant one."""
    violations: list[str] = []
    for m in _UPDATE_KE_STMT_RE.finditer(source):
        stmt = m.group(0)
        if not _SETS_VERIFIED_TRUE_RE.search(stmt):
            continue

        parts = re.split(r"\bWHERE\b", stmt, maxsplit=1, flags=re.IGNORECASE)
        set_part, where_part = parts[0], (parts[1] if len(parts) > 1 else "")

        cross_tenant = bool(_SET_TENANT_ID_RE.search(set_part))
        has_source_url = bool(_SOURCE_URL_RESTRICTION_RE.search(where_part))
        has_tenant_literal = bool(_TENANT_ID_LITERAL_RE.search(where_part))

        if cross_tenant:
            # Moves rows across the trust boundary AND trusts them in the
            # same step — only an individually re-fetchable source_url
            # counts. A WHERE tenant_id literal here names the untrusted
            # SOURCE tenant, never provenance for the promotion.
            ok = has_source_url
            reason = (
                "reassigns tenant_id (crosses a tenant boundary) while also "
                "setting verified=true, but has no source_url restriction — "
                "a WHERE tenant_id literal only identifies the untrusted "
                "source tenant here, it is not provenance for the move"
            )
        else:
            # Promotes rows already inside a pinned tenant — the tenant
            # literal genuinely is stored provenance.
            ok = has_source_url or has_tenant_literal
            reason = (
                "has no source_url or literal tenant_id restriction — shape "
                "predicates (source_type/manufacturer) alone are not "
                "provable provenance"
            )

        if ok:
            continue
        line = _line_of(source, m.start())
        violations.append(
            f"{rel_path}:{line} promotes knowledge_entries rows to "
            f"verified=true but {reason}. See .claude/rules/oem-crawler-trusted.md."
        )
    return violations


def _seed_sql_files() -> list[Path]:
    seeds_dir = _ROOT / _SEEDS_DIR
    if not seeds_dir.exists():
        return []
    return sorted(p for p in seeds_dir.rglob("*.sql") if p.is_file())


def test_seeds_never_promote_verified_on_shape_alone():
    """No tools/seeds/*.sql UPDATE promotes verified=true on shape alone.

    Doctrine: .claude/rules/oem-crawler-trusted.md. Currently zero offenders —
    the shape-only backfill was pulled in this branch (3b7cebdcb); the one
    remaining UPDATE...verified=true seed (backfill_verified_corpus.sql) is
    restricted by a literal tenant_id, which this repo's write path treats as
    a trust boundary, not by source_type/manufacturer shape."""
    offenders: list[str] = []
    for path in _seed_sql_files():
        rel = path.relative_to(_ROOT).as_posix()
        offenders.extend(scan_verified_promotion(rel, path.read_text(errors="replace")))
    assert not offenders, (
        "A seed promotes knowledge_entries to verified=true on shape alone — "
        "this is the exact defect .claude/rules/oem-crawler-trusted.md exists "
        "to prevent. Restrict the UPDATE by source_url or a literal tenant_id, "
        "or don't ship the backfill (re-acquire through the trusted crawler "
        "instead).\n\n" + "\n".join(offenders)
    )


# The REAL pulled backfill's UPDATE statement, verbatim, recovered via:
#   git show 0bde5f2e5:tools/seeds/backfill_oem_crawler_chunks.sql
# This is the actual historical defect .claude/rules/oem-crawler-trusted.md
# describes: it reassigns tenant_id (moves rows from the garage tenant into
# the shared OEM tenant) AND sets verified=true, selecting purely on shape
# (source_type/manufacturer) plus the SOURCE tenant's own id — never on
# anything that identifies who actually wrote the row. Fix-round-1 exists
# because the first version of scan_verified_promotion passed this exact
# statement (it matched the SET clause's destination tenant_id literal as if
# it were a WHERE-clause restriction).
_REAL_PULLED_BACKFILL_STMT = """\
UPDATE knowledge_entries ke
   SET tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',   -- MIRA_SHARED_TENANT_ID
       verified  = true,
       metadata  = ke.metadata || jsonb_build_object(
                     'backfilled_from', 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe',
                     'backfilled_at', now()::text)
 WHERE ke.tenant_id::text = 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe'  -- garage MIRA_TENANT_ID
   AND ke.metadata->>'source' = 'mira_crawler'
   AND ke.source_type = 'equipment_manual'
   AND ke.manufacturer <> ''
   AND NOT EXISTS (
     SELECT 1 FROM knowledge_entries dup
      WHERE dup.tenant_id::text = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
        AND dup.source_url = ke.source_url
        AND (dup.metadata->>'chunk_index')::int = (ke.metadata->>'chunk_index')::int
   );
"""


def test_verified_promotion_checker_catches_violations():
    """The Contract 7 guard must FAIL on the known bad shapes — most
    importantly the REAL historical defect, verbatim — and PASS on
    provenance-restricted promotions of both shapes (same-tenant and
    cross-tenant-with-source_url)."""
    bad_cases = {
        "the REAL pulled backfill, verbatim (0bde5f2e5, cross-tenant + shape-only)":
            _REAL_PULLED_BACKFILL_STMT,
        "source_type + manufacturer shape, no tenant reassignment": (
            "UPDATE knowledge_entries\n"
            "   SET verified = true\n"
            " WHERE source_type = 'equipment_manual'\n"
            "   AND manufacturer <> '';\n"
        ),
        "manufacturer alone": (
            "UPDATE knowledge_entries SET verified = true "
            "WHERE manufacturer = 'AutomationDirect';\n"
        ),
        "no predicate at all": "UPDATE knowledge_entries SET verified = true;\n",
        "cross-tenant move with a tenant_id literal but no source_url "
        "(the exact fix-round-1 gap)": (
            "UPDATE knowledge_entries ke\n"
            "   SET tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',\n"
            "       verified  = true\n"
            " WHERE ke.tenant_id::text = 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe';\n"
        ),
    }
    for label, sql in bad_cases.items():
        assert scan_verified_promotion("bad.sql", sql), f"checker missed a violation: {label}"

    good_cases = {
        "host-restricted promotion, no tenant reassignment": (
            "UPDATE knowledge_entries\n"
            "   SET verified = true\n"
            " WHERE source_url LIKE 'https://www.automationdirect.com/%';\n"
        ),
        # tools/seeds/backfill_verified_corpus.sql's real shape: promotes rows
        # ALREADY inside the shared tenant, no SET tenant_id reassignment.
        "literal tenant_id restriction, same-tenant (backfill_verified_corpus.sql shape)": (
            "UPDATE knowledge_entries\n"
            "   SET verified = true\n"
            " WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'::uuid\n"
            "   AND verified IS DISTINCT FROM true;\n"
        ),
        "cross-tenant move WITH a source_url restriction": (
            "UPDATE knowledge_entries ke\n"
            "   SET tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',\n"
            "       verified  = true\n"
            " WHERE ke.source_url LIKE 'https://www.automationdirect.com/%';\n"
        ),
        "no verified promotion at all": (
            "UPDATE knowledge_entries SET is_private = true WHERE tenant_id = 'x';\n"
        ),
    }
    for label, sql in good_cases.items():
        assert scan_verified_promotion("good.sql", sql) == [], f"false positive: {label}"


# ---------------------------------------------------------------------------
# Contract 10: no test bare-imports a top-level module name that two different
# tools/ directories both provide
# ---------------------------------------------------------------------------
# Python caches modules by top-level NAME in sys.modules, not by path. When two
# directories that tests push onto sys.path each contain a `runner.py`, the
# FIRST import of the bare name `runner` wins for the whole process and every
# later `import runner` silently gets the other file.
#
# That is not hypothetical — it broke `main`. #3074 added
# tools/routing_gauntlet/runner.py alongside the pre-existing
# tools/internet_print_test/runner.py. tests/test_routing_gauntlet.py imported
# its runner at COLLECTION time; tests/printsense/test_grader_gate.py imported
# at RUN time (inside a helper), and pytest finishes all collection before
# running anything — so the gauntlet always won and the printsense tests got a
# module with no TESTS_ROOT:
#
#   AttributeError: <module 'runner' from '.../tools/routing_gauntlet/runner.py'>
#                   has no attribute 'TESTS_ROOT'
#
# Bisected: 2666656b green -> 412a3464 (#3074) red, and every `main` run after.
# It was invisible to every BLOCKING check because `test-unit` runs
# `pytest tests/printsense/ -v` in ISOLATION, where the collision cannot happen;
# only the `test-eval-offline` sweep collects both files in one process, and
# that job is deliberately not in ci-gate. Isolation is exactly what hid it,
# so adding those suites to test-unit would NOT have caught this — a
# cross-file contract is the only thing that can. Contract 10 lives in
# architecture-check, which IS gated.
#
# Remedy when this fires: load the module by explicit path under a unique name
# (importlib.util.spec_from_file_location) instead of bare-importing the
# ambiguous one. Both call sites do this now. Keep the sys.path.insert — the
# tool's own modules still bare-import their siblings through it.
#
# SCOPE — deliberately narrowed to the tools/ family, and this was measured,
# not assumed. tests/** contains ~60 distinct sys.path.insert expressions, many
# built from local variables (relay_dir, bots_path, p, lead) that no static
# checker can resolve, covering mira-bots, mira-bots/shared, mira-mcp,
# mira-sidecar, mira-pipeline, mira-crawler, the repo root, ignition/ and plc/.
# A contract over all of that would be both unresolvable and noisy. Over the
# tools/-family dirs tests actually insert, exactly ONE name out of 85 is
# ambiguous — `runner`, i.e. the bug. So the narrow scope costs no real
# coverage and needs no allowlist. If a future collision lands outside tools/,
# widen this deliberately rather than by accident.

_AMBIGUITY_ROOTS = ("tools", "scripts")

# A pathlib chain rooted at a tools/-family segment: "tools" / "routing_gauntlet".
# Segments are [A-Za-z0-9_-] (same class as the literal form below) so a chain
# that ends in a FILE — `REPO / "tools" / "hooks" / "rm_guard.py"` — degrades to
# its containing directory (tools/hooks) instead of contributing a bogus
# "tools/hooks/rm_guard.py" entry. A permissive [^"/]+ here was the actual leak:
# it let ~15 file paths through even after the literal form was tightened.
_PATH_CHAIN_RE = re.compile(r'"(?:tools|scripts)"(?:\s*/\s*"[A-Za-z0-9_-]+")*')
# The same directory written as one literal: "tools/qa/security".
#   - Requires the slash: a bare "tools" is a one-segment CHAIN matched above, so
#     an optional slash would emit a spurious `tools` beside every chain.
#   - Segments are [A-Za-z0-9_-] only, so this matches DIRECTORIES and not the
#     many file paths and prose fragments that also start with "tools/" in this
#     tree ("tools/seeds/*.sql", "tools/hooks/rm_guard.py", "tools/…​ not found").
#     Those all carry a dot or a space. Without this, ~30 non-directories entered
#     the provider map; they were filtered later by is_dir(), but a *directory*
#     reached only through a file path (tools/lead-hunter via
#     "tools/lead-hunter/hunt.py") did not, and could manufacture a false
#     ambiguity against a dir no test ever puts on sys.path.
_PATH_LITERAL_RE = re.compile(r'"(?:tools|scripts)(?:/[A-Za-z0-9_-]+)+"')
_QUOTED_RE = re.compile(r'"([^"]+)"')


def referenced_tool_dirs(test_sources: list[tuple[str, str]]) -> set[str]:
    """Repo-relative tools/-family dirs that any test names as a path.

    Scans the WHOLE file, not just `sys.path.insert(...)` calls. Binding the
    scan to the insert call was refuted immediately: the fix for this very bug
    hoists the directory into a variable --

        _GAUNTLET_DIR = REPO / "tools" / "routing_gauntlet"
        sys.path.insert(0, str(_GAUNTLET_DIR))

    -- so the insert carries no literal and the dir vanished from discovery,
    silently un-guarding the exact collision this contract exists for. Matching
    the path literal wherever it appears is the fix.

    Over-matching is the correct bias, same as Contract 8's `_job_runs_tests`:
    a merely-mentioned dir only adds its module names to the provider map, and
    a violation still requires a test to actually bare-import a colliding name.
    A false negative silently un-guards a real collision.

    Pure: takes [(path, text), ...] so the self-test can drive it with fixtures.
    """
    found: set[str] = set()
    for _path, text in test_sources:
        for chain in _PATH_CHAIN_RE.findall(text):
            found.add("/".join(_QUOTED_RE.findall(chain)))
        for literal in _PATH_LITERAL_RE.findall(text):
            found.add(literal.strip('"').strip("/"))
    return {d for d in found if d.split("/")[0] in _AMBIGUITY_ROOTS}


def ambiguous_module_names(dir_to_modules: dict[str, set[str]]) -> dict[str, set[str]]:
    """{top-level module name -> providing dirs} for names provided by >1 dir.

    Dunders are excluded: `__init__` / `__main__` exist in most of these dirs but
    are never reachable as a bare top-level import, so counting them would put a
    permanent false entry in the failure message with no violation behind it.
    """
    providers: dict[str, set[str]] = {}
    for directory, names in dir_to_modules.items():
        for name in names:
            if name.startswith("__"):
                continue
            providers.setdefault(name, set()).add(directory)
    return {n: d for n, d in providers.items() if len(d) > 1}


def scan_bare_ambiguous_imports(
    path: str, text: str, ambiguous: set[str]
) -> list[str]:
    """Violations where `path` bare-imports one of the `ambiguous` names."""
    if not ambiguous:
        return []
    offenders = []
    for match in _IMPORT_RE.finditer(text):
        imported = match.group(1)
        # Only a bare top-level name collides; `tools.x.runner` resolves by path.
        if "." in imported:
            continue
        if imported in ambiguous:
            line = text[: match.start()].count("\n") + 1
            offenders.append(f"{path}:{line}: bare `{imported}` import")
    return offenders


def _test_sources() -> list[tuple[str, str]]:
    tests_dir = _ROOT / "tests"
    out = []
    for py_file in sorted(tests_dir.rglob("*.py")):
        if "__pycache__" in str(py_file):
            continue
        out.append((str(py_file.relative_to(_ROOT)), py_file.read_text(errors="replace")))
    return out


def test_no_test_bare_imports_an_ambiguous_tool_module():
    """Contract 10: a name two tools/ dirs both provide must not be bare-imported."""
    sources = _test_sources()

    # Vacuity guard — a broken regex must fail loudly, not pass over nothing.
    assert len(sources) > 100, f"only found {len(sources)} test files; discovery is broken"
    tool_dirs = referenced_tool_dirs(sources)
    assert "tools/internet_print_test" in tool_dirs and "tools/routing_gauntlet" in tool_dirs, (
        "tools/ path discovery failed to find the two known dirs; "
        f"found: {sorted(tool_dirs)}"
    )

    dir_to_modules = {
        d: {p.stem for p in (_ROOT / d).glob("*.py")}
        for d in sorted(tool_dirs)
        if (_ROOT / d).is_dir()
    }
    assert sum(len(v) for v in dir_to_modules.values()) > 20, "module discovery is broken"

    ambiguous = ambiguous_module_names(dir_to_modules)
    offenders = []
    for path, text in sources:
        offenders.extend(scan_bare_ambiguous_imports(path, text, set(ambiguous)))

    assert not offenders, (
        "A test bare-imports a module name that two tools/ directories both provide.\n"
        "Python caches by NAME, so whichever file is imported first wins sys.modules\n"
        "for the whole process and the other test silently gets the wrong module.\n"
        "Fix: load it by explicit path under a unique name --\n"
        "    spec = importlib.util.spec_from_file_location('my_unique_name', DIR / 'runner.py')\n"
        "    mod = importlib.util.module_from_spec(spec); sys.modules['my_unique_name'] = mod\n"
        "    spec.loader.exec_module(mod)\n"
        "Keep the sys.path.insert -- the tool's own modules bare-import their siblings.\n\n"
        "Ambiguous names: "
        + "; ".join(f"{n} -> {sorted(d)}" for n, d in sorted(ambiguous.items()))
        + "\n\nOffenders:\n" + "\n".join(offenders)
    )


def test_ambiguous_tool_import_checker_catches_violations():
    """The Contract 10 guard must FAIL on the known bad shapes and pass on the good ones."""
    # Discovery finds a tools/ dir from the shapes actually used in this repo.
    assert referenced_tool_dirs([("t.py", 'sys.path.insert(0, str(REPO / "tools" / "routing_gauntlet"))')]) == {
        "tools/routing_gauntlet"
    }
    assert referenced_tool_dirs([("t.py", 'sys.path.insert(0, str(P / "tools" / "qa" / "security"))')]) == {
        "tools/qa/security"
    }
    # The dir written as one literal (not a pathlib chain).
    assert referenced_tool_dirs([("t.py", 'P = "tools/qa/security"')]) == {"tools/qa/security"}
    # A dir hoisted into a variable is still found — binding discovery to the
    # sys.path.insert call missed exactly this and un-guarded the real bug.
    assert referenced_tool_dirs(
        [("t.py", '_D = REPO / "tools" / "routing_gauntlet"\nsys.path.insert(0, str(_D))')]
    ) == {"tools/routing_gauntlet"}
    # Non-tools dirs are out of scope; fully variable-built paths are skipped.
    assert referenced_tool_dirs([("t.py", 'sys.path.insert(0, "mira-bots")')]) == set()
    assert referenced_tool_dirs([("t.py", "sys.path.insert(0, str(SCRIPTS))")]) == set()
    # File paths and prose that merely start with "tools/" are NOT directories.
    assert referenced_tool_dirs([("t.py", 'X = "tools/hooks/rm_guard.py"')]) == set()
    assert referenced_tool_dirs([("t.py", 'M = "tools/seeds/a.sql is stale — "')]) == set()
    assert referenced_tool_dirs([("t.py", 'M = "tools/ path discovery failed"')]) == set()
    # A CHAIN ending in a file degrades to its containing directory.
    assert referenced_tool_dirs([("t.py", 'P = REPO / "tools" / "hooks" / "rm_guard.py"')]) == {
        "tools/hooks"
    }

    # The real collision: two dirs, one shared name.
    ambiguous = ambiguous_module_names(
        {
            "tools/internet_print_test": {"runner", "submit", "mailer", "safety"},
            "tools/routing_gauntlet": {"runner", "corpus"},
        }
    )
    assert set(ambiguous) == {"runner"}, ambiguous
    # Dunders are shared by most tool dirs but are never bare-importable.
    assert ambiguous_module_names(
        {"tools/a": {"__init__", "__main__"}, "tools/b": {"__init__", "__main__"}}
    ) == {}

    bad_cases = {
        "module-level bare import (test_routing_gauntlet's old shape)":
            "from runner import ADVERSARIAL_VOTES, apply_arbitration\n",
        "indented lazy bare import (test_grader_gate's old shape)":
            "def helper():\n    import runner\n",
        "aliased bare import":
            "import runner as r\n",
    }
    for label, src in bad_cases.items():
        assert scan_bare_ambiguous_imports("bad.py", src, set(ambiguous)), (
            f"checker missed a violation: {label}"
        )

    good_cases = {
        "unambiguous sibling stays bare (runner.run_one reaches the same object)":
            "import submit as submitmod\n",
        "dotted package path resolves without the bare name":
            "from tools.routing_gauntlet.runner import run_tier1\n",
        "explicit path load under a unique name":
            "spec = importlib.util.spec_from_file_location('print_test_runner', D / 'runner.py')\n",
        "a name that merely CONTAINS an ambiguous one":
            "import runner_utils\n",
    }
    for label, src in good_cases.items():
        assert scan_bare_ambiguous_imports("good.py", src, set(ambiguous)) == [], (
            f"false positive: {label}"
        )


# ---------------------------------------------------------------------------
# Contract 11: ONE asset-tag grammar — every regex copy byte-matches TAG-001
# ---------------------------------------------------------------------------
# The tag grammar is a cross-surface contract (docs/contracts/asset-tag-grammar
# .json, CU-P1 / drift finding D-5): a tag that parses on one surface but not
# another 404s the QR->asset product spine. The vitest suites lock *behavior*
# over the golden corpus, but (a) mobile's regex literal is pinned by nothing
# (a widened quantifier no corpus case distinguishes passes both suites), and
# (b) the third copy — mira-core/mira-ingest/asset_tag.py, the actual
# filesystem-traversal defense — is outside both suites entirely. This contract
# byte-locks every copy to the contract JSON, checks the corpus is
# self-consistent, and fails if the vitest suites or their CI path filters are
# unwired (vitest cannot fence its own deletion). Convergence unit CU-06.

_TAG_CONTRACT_PATH = "docs/contracts/asset-tag-grammar.json"

# rel path -> regex that captures the grammar literal in that file.
_TAG_REGEX_SITES: dict[str, str] = {
    "mira-hub/src/lib/asset-tag.ts": r"ASSET_TAG_REGEX\s*=\s*/(.*?)/;",
    "mira-mobile/src/lib/tags.ts": r"ASSET_TAG_REGEX\s*=\s*/(.*?)/;",
    "mira-core/mira-ingest/asset_tag.py": r'ASSET_TAG_RE\s*=\s*re\.compile\(r"(.*?)"\)',
}

# The behavior-lock suites CU-P1 wired; deleting/unwiring any of them must fail.
_TAG_SUITE_FILES = [
    "mira-hub/src/lib/__tests__/asset-tag-grammar-contract.test.ts",
    "mira-mobile/src/lib/__tests__/tag-grammar-contract.test.ts",
    "mira-mobile/src/lib/__tests__/tag-grammar-shadow.test.ts",
]


def extract_tag_regex(source: str, extractor: str) -> str | None:
    """Return the grammar literal found by `extractor`, or None if absent.

    Pure function — unit-tested against fixtures below so the guard is proven
    to catch a desynced or missing literal."""
    m = re.search(extractor, source)
    return m.group(1) if m else None


def _tag_contract() -> dict:
    return json.loads((_ROOT / _TAG_CONTRACT_PATH).read_text(encoding="utf-8"))


def test_tag_grammar_regex_locked_across_surfaces():
    """Every ASSET_TAG regex copy byte-matches the contract's canonical_regex."""
    canonical = _tag_contract()["canonical_regex"]
    offenders: list[str] = []
    for rel, extractor in _TAG_REGEX_SITES.items():
        path = _ROOT / rel
        if not path.is_file():
            offenders.append(f"{rel}: file missing — grammar site moved without updating Contract 11")
            continue
        literal = extract_tag_regex(path.read_text(encoding="utf-8", errors="replace"), extractor)
        if literal is None:
            offenders.append(f"{rel}: grammar literal not found — extractor or file drifted")
        elif literal != canonical:
            offenders.append(f"{rel}: regex {literal!r} != contract {canonical!r}")
    assert not offenders, (
        "The asset-tag grammar is ONE contract (docs/contracts/asset-tag-grammar.json, "
        "TAG-001). Change the contract JSON and every consumer in the same PR — see "
        "units/CU-P1.md.\n\n" + "\n".join(offenders)
    )


def test_tag_grammar_corpus_selfconsistent():
    """The golden corpus itself cannot silently rot (Contract 11)."""
    data = _tag_contract()
    canonical = re.compile(data["canonical_regex"])  # must compile
    cases = data["cases"]
    assert cases, "corpus has no cases"
    names = [c["name"] for c in cases]
    assert len(names) == len(set(names)), "duplicate case names in the corpus"
    for case in cases:
        assert "input" in case and "expect" in case, f"case {case.get('name')!r} missing input/expect"
        for key in ("expect", "mobile_expect"):
            value = case.get(key)
            if value is not None:
                assert canonical.match(value), (
                    f"case {case['name']!r}: {key}={value!r} does not satisfy the canonical "
                    "grammar — the corpus asserts an output the grammar rejects"
                )


def test_tag_grammar_suites_still_wired():
    """The vitest suites and their CI path filters cannot be silently unwired."""
    offenders: list[str] = []
    for rel in _TAG_SUITE_FILES:
        path = _ROOT / rel
        if not path.is_file():
            offenders.append(f"{rel}: suite file deleted")
        elif "asset-tag-grammar" not in path.read_text(encoding="utf-8", errors="replace"):
            offenders.append(f"{rel}: no longer imports the contract corpus")
    ci = (_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8", errors="replace")
    if ci.count(_TAG_CONTRACT_PATH) < 2:
        offenders.append(
            "ci.yml: the corpus path must appear in BOTH the hub and mobile path filters "
            f"(found {ci.count(_TAG_CONTRACT_PATH)} occurrence(s))"
        )
    for watched in ("mira-hub/src/lib/asset-tag.ts", "mira-hub/src/lib/scan-target.ts"):
        if watched not in ci:
            offenders.append(f"ci.yml: mobile filter no longer watches {watched}")
    assert not offenders, (
        "TAG-001 enforcement got unwired — a PR editing one grammar surface would no "
        "longer re-run the cross-surface suites.\n\n" + "\n".join(offenders)
    )


def test_tag_regex_extractor_catches_desync():
    """The Contract 11 extractor must see a changed or missing literal."""
    ts = "export const ASSET_TAG_REGEX = /^[A-Za-z0-9_-]{1,64}$/;\n"
    assert extract_tag_regex(ts, _TAG_REGEX_SITES["mira-hub/src/lib/asset-tag.ts"]) == "^[A-Za-z0-9_-]{1,64}$"
    widened = "const ASSET_TAG_REGEX = /^[A-Za-z0-9._-]{1,128}$/;\n"
    assert extract_tag_regex(widened, _TAG_REGEX_SITES["mira-mobile/src/lib/tags.ts"]) == "^[A-Za-z0-9._-]{1,128}$"
    py = 'ASSET_TAG_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")\n'
    assert extract_tag_regex(py, _TAG_REGEX_SITES["mira-core/mira-ingest/asset_tag.py"]) == "^[A-Za-z0-9_-]{1,64}$"
    assert extract_tag_regex("const OTHER = 1;\n", _TAG_REGEX_SITES["mira-mobile/src/lib/tags.ts"]) is None


# ---------------------------------------------------------------------------
# Contract 12: the CLAUDE.md Container Map matches the compose files
# ---------------------------------------------------------------------------
# Drift finding D-2 (CU-02): the hand-kept container map rotted (phantom
# mira-docling, wrong mira-mcp ports) and agents planned against it. CU-02 made
# the map GENERATED (tools/gen_container_map.py, doctrine section 11 — prefer
# machine-validated facts); this contract is the permanent re-drift fence CU-06
# wires into CI: any compose change that is not re-rendered into CLAUDE.md
# fails here. Runs the script's --check mode via subprocess (sys.executable,
# the repo's established cross-platform shape — see tests/test_machine_print_pack.py).

_GEN_CONTAINER_MAP = "tools/gen_container_map.py"


def test_container_map_matches_compose():
    """CLAUDE.md's generated Container Map is byte-identical to regeneration."""
    result = subprocess.run(
        [sys.executable, str(_ROOT / _GEN_CONTAINER_MAP), "--check"],
        capture_output=True,
        encoding="utf-8",
        errors="replace",  # the child's stderr may be cp1252 on Windows (em-dash in WARN)
        cwd=str(_ROOT),
    )
    assert result.returncode == 0, (
        "The root CLAUDE.md Container Map disagrees with the compose files. "
        "Regenerate it (never hand-edit): python3 tools/gen_container_map.py --write\n\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )


def _load_gen_container_map():
    spec = importlib.util.spec_from_file_location(
        "gen_container_map_contract12", _ROOT / _GEN_CONTAINER_MAP
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_container_map_checker_catches_drift():
    """The Contract 12 comparison must FAIL on a mutated map (red-first proof)."""
    mod = _load_gen_container_map()
    text = (_ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    section = mod.generate_section()
    parts = mod._split_claude_md(text)
    assert parts is not None, "CLAUDE.md lost its Container Map section/markers"
    _, current, _ = parts
    # The committed section matches regeneration (same equality --check uses)...
    assert current.strip("\n") == section.strip("\n")
    # ...and a single-token mutation is caught by that same equality.
    corrupted = current.replace("core-net", "bork-net", 1)
    assert corrupted != current, "fixture mutation was a no-op"
    assert corrupted.strip("\n") != section.strip("\n")
    # Malformed inputs are refused, not corrupted:
    assert mod._split_claude_md("no map heading here") is None
    assert mod._split_claude_md(mod.END_MARK + "\nx\n" + mod.BEGIN_MARK) is None


# ---------------------------------------------------------------------------
# Contract 13: no writer INSERTs into knowledge_entries without is_private
# ---------------------------------------------------------------------------
# knowledge_entries is a HYBRID corpus (.claude/rules/knowledge-entries-tenant-
# scoping.md): shared OEM rows are is_private=false, per-tenant uploads MUST be
# is_private=true. A writer that omits the column silently relies on the
# default (false) — the exact shape that leaked tenant uploads (#1833, #1903).
# This fence is default-deny for NEW writers: every INSERT INTO
# knowledge_entries must state is_private (either value — the OEM/tenant choice
# is the writer's, per the rule) or be allowlisted here with a reason.
# NOTE: the BACKLOG.md CU-06 bullet says "ast-grep rule"; this lives here
# instead because .ast-grep-rules/ is not executed by any CI job today
# (code-review.yml greps with rg; sgconfig's testDir does not exist) — a fence
# that doesn't run is not a fence. Recorded in units/CU-06.md.
# The known writers' semantics (insert_chunk hardcoding false = I-1, learning_
# ingester visibility, etc.) are CU-03's job — this contract only stops the
# population of writers from growing without an explicit is_private decision.

_KE_INSERT_RE = re.compile(
    r'INSERT\s+INTO\s+(?:public\s*\.\s*)?"?knowledge_entries', re.IGNORECASE
)
_KE_WRITE_SUFFIXES = {".py", ".ts", ".tsx", ".sql"}
_KE_EXCLUDED_DIRS = {
    "node_modules", ".git", "__pycache__", ".next", "dist", "build",
    ".claude", ".codegraph", ".venv", "venv", "out",
}
# Chars after the INSERT keyword within which is_private must appear. The
# largest real statement in this repo declares it at offset 241; 600 leaves
# headroom while keeping a following comment/UPDATE from masking an omission
# (Gate 7 finding F5).
_KE_WINDOW = 600

# Files whose INSERT legitimately omits is_private today. Each entry MUST carry
# a reason; the honesty test below fails if an entry stops violating (remove it
# then) or stops existing.
_KE_INSERT_ALLOWLIST: dict[str, str] = {
    "tools/seeds/gs11-field-guide-knowledge.sql":
        "OEM seed; omits the column so rows take the DB default false (correct for "
        "shared corpus). Explicit is_private false preferred on next touch.",
    "mira-hub/scripts/verify-node-subtree-retrieval.ts":
        "verification script writing node_attachment probe rows; default-false today. "
        "Flagged for the CU-03 visibility audit — do not silently bless.",
    "mira-hub/tests/e2e/folder-brain-proof.spec.ts":
        "e2e fixture rows (cleaned up in-test); default-false today. Flagged for the "
        "CU-03 visibility audit.",
    "mira-hub/src/lib/__tests__/node-knowledge-ingest-batching.test.ts":
        "not a writer — asserts on mock-captured SQL via .includes('INSERT INTO "
        "knowledge_entries'); the real writer (node-knowledge-ingest.ts) pins true.",
    "mira-hub/src/lib/__tests__/node-knowledge-ingest-empty.test.ts":
        "not a writer — same mock-capture assertion string as the batching test.",
    "mira-hub/src/app/api/documents/upload/__tests__/route.test.ts":
        "not a writer — regex assertion on mock-captured SQL; the test itself ASSERTS "
        "is_private true is present (the #1833 guard), just >600 chars after the match.",
}


def scan_knowledge_entries_insert(rel_path: str, source: str) -> list[str]:
    """Return violations where an INSERT INTO knowledge_entries omits is_private.

    Pure function — unit-tested against fixtures below so the guard is proven
    to catch violations. is_private must appear within _KE_WINDOW chars of the
    INSERT keyword (the statement's column list / VALUES / kwargs)."""
    violations: list[str] = []
    for m in _KE_INSERT_RE.finditer(source):
        window = source[m.start(): m.start() + _KE_WINDOW]
        if "is_private" not in window:
            line = source.count("\n", 0, m.start()) + 1
            violations.append(
                f"{rel_path}:{line} INSERT INTO knowledge_entries without an is_private "
                "decision (shared OEM rows: false; per-tenant uploads: true — "
                ".claude/rules/knowledge-entries-tenant-scoping.md)"
            )
    return violations


def _is_nested_worktree(d: Path) -> bool:
    """True for a git worktree checked out inside the repo.

    A linked worktree has `.git` as a *file* (a gitdir pointer), not a directory
    — which is why no `.gitignore` glob can express this and the exclusion has
    to live in code (same reasoning as the nested-worktree check in
    `tools/codegraph-preflight.sh`).

    Without this, Contract 13 scans every duplicate copy of the repo under
    `.worktrees/`, `.audit-worktrees/`, or an ad-hoc `git worktree add` path and
    reports their files as violations — a false RED on any developer machine
    that has one, while CI's clean checkout stays green. Found while running
    this contract for CU-03.
    """
    return (d / ".git").is_file()


def _knowledge_entries_write_candidates() -> list[Path]:
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(_ROOT):
        dirnames[:] = [
            d for d in dirnames
            if d not in _KE_EXCLUDED_DIRS
            and not _is_nested_worktree(Path(dirpath) / d)
        ]
        for name in filenames:
            p = Path(dirpath) / name
            if p.suffix in _KE_WRITE_SUFFIXES:
                out.append(p)
    return sorted(out)


def test_knowledge_entries_writers_declare_is_private():
    """No file INSERTs into knowledge_entries without an is_private decision."""
    offenders: list[str] = []
    for path in _knowledge_entries_write_candidates():
        rel = path.relative_to(_ROOT).as_posix()
        if rel == "tests/test_architecture.py" or rel in _KE_INSERT_ALLOWLIST:
            continue
        source = path.read_text(encoding="utf-8", errors="replace")
        if "knowledge_entries" not in source:
            continue
        offenders.extend(scan_knowledge_entries_insert(rel, source))
    assert not offenders, (
        "New knowledge_entries writers must state is_private explicitly — omitting it "
        "silently takes the default (false) and is the #1833/#1903 leak shape. Either "
        "set the column, or (for a legitimately-default OEM seed) add an allowlist "
        "entry with a reason in Contract 13.\n\n" + "\n".join(offenders)
    )


def test_ke_insert_allowlist_is_honest():
    """Every Contract 13 allowlist entry still exists and still omits is_private."""
    for rel, reason in _KE_INSERT_ALLOWLIST.items():
        assert reason.strip(), f"allowlist entry {rel} has no reason"
        path = _ROOT / rel
        assert path.is_file(), f"allowlisted {rel} no longer exists — remove the entry"
        violations = scan_knowledge_entries_insert(rel, path.read_text(encoding="utf-8", errors="replace"))
        assert violations, (
            f"allowlisted {rel} now declares is_private — remove its Contract 13 "
            "allowlist entry so the fence stays tight"
        )


def test_ke_insert_checker_catches_violations():
    """The Contract 13 guard must FAIL on the known bad shapes."""
    bad_cases = {
        "sql column list omits it":
            "INSERT INTO knowledge_entries (id, tenant_id, content) VALUES (:i, :t, :c)\n",
        "lowercase sql":
            "insert into knowledge_entries (id, content) values (1, 'x')\n",
        "ts template literal":
            "await sql`INSERT INTO knowledge_entries (id, tenant_id) VALUES (${a}, ${b})`\n",
        "schema-qualified table (Gate 7 F6)":
            "INSERT INTO public.knowledge_entries (id, content) VALUES (:i, :c)\n",
        "quoted table (Gate 7 F6)":
            'INSERT INTO "knowledge_entries" (id, content) VALUES (:i, :c)\n',
        "is_private only in a later statement (Gate 7 F5)":
            "INSERT INTO knowledge_entries (id, content) VALUES (:i, :c);\n"
            + "-- filler\n" * 80
            + "UPDATE knowledge_entries SET is_private = false;\n",
    }
    for label, src in bad_cases.items():
        assert scan_knowledge_entries_insert("bad.py", src), f"checker missed: {label}"

    good_cases = {
        "explicit false (OEM)":
            "INSERT INTO knowledge_entries (id, is_private) VALUES (:i, false)\n",
        "explicit true (tenant)":
            "INSERT INTO knowledge_entries (id, is_private) VALUES (:i, true)\n",
        "bound param":
            "INSERT INTO knowledge_entries (id, is_private) VALUES (:id, :is_private)\n",
        "non-INSERT statement (UPDATE)":
            "UPDATE knowledge_entries SET is_private = true WHERE id = :i\n",
    }
    for label, src in good_cases.items():
        assert scan_knowledge_entries_insert("good.py", src) == [], f"false positive: {label}"


# ---------------------------------------------------------------------------
# Contract 15: every ingest_url dispatch declares its corpus visibility
# ---------------------------------------------------------------------------
# `tasks.ingest.ingest_url` takes `is_private` with a default of True, because a
# Celery signature is a wire contract and in-flight messages from the previous
# release carry no such kwarg (CU-03/I-2). That default is the right *floor* for
# an unknown caller, but it is the wrong answer for a known one: a feeder that
# forgets it silently privatizes public OEM content.
#
# Gate 7 caught exactly this on CU-03's own PR — four in-repo dispatch sites
# (foundational, rss, freshness, ingest_pending_urls) had been missed, and the
# freshness one would have privatized shared-corpus rows one refresh cycle at a
# time. Point-fixing those four does not stop the fifth. This contract does.


def _ingest_url_dispatch_sites() -> list[tuple[str, int, ast.Call]]:
    """Every `ingest_url(...)` / `ingest_url.delay(...)` call under mira-crawler."""
    out: list[tuple[str, int, ast.Call]] = []
    tasks_dir = _ROOT / "mira-crawler" / "tasks"
    for py in sorted(tasks_dir.rglob("*.py")):
        rel = py.relative_to(_ROOT).as_posix()
        try:
            tree = ast.parse(py.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            name = None
            if isinstance(fn, ast.Name):
                name = fn.id
            elif isinstance(fn, ast.Attribute):
                if fn.attr in {"delay", "apply_async"} and isinstance(fn.value, ast.Name):
                    name = fn.value.id
                else:
                    name = fn.attr
            if name == "ingest_url":
                out.append((rel, node.lineno, node))
    return out


def test_ingest_url_dispatches_declare_visibility():
    """No mira-crawler feeder may queue an ingest without stating is_private."""
    offenders: list[str] = []
    sites = _ingest_url_dispatch_sites()
    for rel, lineno, call in sites:
        # The definition itself, and recursive self-dispatch inside ingest.py's
        # own retry paths, are not feeders.
        if any(kw.arg == "is_private" for kw in call.keywords):
            continue
        offenders.append(
            f"{rel}:{lineno} queues ingest_url without an is_private argument — it "
            "would inherit the fail-closed default (private) and silently drop "
            "public content out of the shared corpus "
            "(.claude/rules/knowledge-entries-tenant-scoping.md, CU-03/I-2)"
        )
    assert not offenders, "\n".join(offenders)


def test_ingest_url_dispatch_scanner_finds_the_known_sites():
    """Honesty check: the scanner must actually be finding call sites.

    Without this, deleting or breaking `_ingest_url_dispatch_sites` turns the
    contract above into a vacuous pass — the false-green shape Gate 7 hunts.
    """
    sites = _ingest_url_dispatch_sites()
    files = {rel for rel, _, _ in sites}
    for expected in (
        "mira-crawler/tasks/sitemaps.py",
        "mira-crawler/tasks/gdrive.py",
        "mira-crawler/tasks/rss.py",
        "mira-crawler/tasks/freshness.py",
        "mira-crawler/tasks/foundational.py",
        "mira-crawler/tasks/discover.py",
        "mira-crawler/tasks/playwright_crawler.py",
    ):
        assert expected in files, f"scanner no longer sees {expected}"


# ---------------------------------------------------------------------------
# Contract 14: every Architecture Registry entry carries valid taxonomy tags
# ---------------------------------------------------------------------------
# Doctrine section 6 defines the architecture tag taxonomy (type:*, domain:*).
# CU-06 adopts it in docs/architecture/convergence/REGISTRY.yaml as an inline
# `tags: [...]` line per module entry. This contract validates the vocabulary
# by REGEX OVER RAW TEXT, deliberately not yaml.safe_load: the registry has 5
# duplicate top-level keys (docs/infra/scripts/tests/tools appear for both the
# MIRA and factorylm repos) which a YAML parser silently last-wins-shadows —
# recorded as a CU-06 discovery finding; renaming keys is out of scope here.
# Vocabulary = the section-6 advisory sets plus two CU-06 extensions the real
# module population needs (the doctrine list is "such as", i.e. extensible):
#   type:docs   — documentation/knowledge dirs (wiki/, docs/, prompts)
#   domain:platform — cross-cutting platform/dev-infra modules with no single
#                     product domain (tools/, tests/, deployment/, ...)

_REGISTRY_REL = "docs/architecture/convergence/REGISTRY.yaml"
_ALLOWED_TAGS: dict[str, set[str]] = {
    "type": {"presentation", "adapter", "engine", "domain", "infra", "test",
             "simulation", "docs"},
    "domain": {"assets", "identity", "knowledge", "diagnostics", "cmms",
               "telemetry", "mobile", "platform"},
}
_TOP_KEY_RE = re.compile(r"^[A-Za-z0-9_.-]+:\s*(?:#.*)?$")  # tolerate a trailing comment
_TAGS_LINE_RE = re.compile(r"^\s{2}tags:\s*\[(.*)\]\s*$")


def scan_registry_tags(text: str) -> tuple[int, int, list[str]]:
    """Return (entry_count, tags_line_count, violations) for registry text.

    Pure function — unit-tested against fixtures below so the guard is proven
    to catch violations."""
    entries = 0
    tag_lines = 0
    violations: list[str] = []
    for lineno, line in enumerate(text.splitlines(), 1):
        if _TOP_KEY_RE.match(line):
            entries += 1
            continue
        m = _TAGS_LINE_RE.match(line)
        if not m:
            continue
        tag_lines += 1
        namespaces: set[str] = set()
        for raw in m.group(1).split(","):
            tag = raw.strip().strip("\"'")
            if not tag:
                continue
            ns, sep, value = tag.partition(":")
            if not sep:
                violations.append(f"line {lineno}: malformed tag {tag!r} (want ns:value)")
                continue
            namespaces.add(ns)
            allowed = _ALLOWED_TAGS.get(ns)
            if allowed is None:
                violations.append(f"line {lineno}: unknown tag namespace {ns!r}")
            elif value not in allowed:
                violations.append(f"line {lineno}: {ns}:{value} not in the Contract 14 vocabulary")
        if not {"type", "domain"} <= namespaces:
            violations.append(f"line {lineno}: tags must include one type:* and one domain:*")
    return entries, tag_lines, violations


def test_registry_entries_all_tagged():
    """Every REGISTRY.yaml module entry carries a valid inline tags line."""
    text = (_ROOT / _REGISTRY_REL).read_text(encoding="utf-8", errors="replace")
    entries, tag_lines, violations = scan_registry_tags(text)
    assert entries > 0, "registry parse found no module entries — scanner broke"
    problems = list(violations)
    if tag_lines != entries:
        problems.append(
            f"{entries} module entries but {tag_lines} tags lines — every entry needs "
            'an inline `  tags: ["type:<v>", "domain:<v>"]` line (doctrine section 6)'
        )
    assert not problems, (
        "Architecture Registry taxonomy violation(s) — vocabulary and rationale live "
        "in Contract 14 of this file.\n\n" + "\n".join(problems)
    )


def test_registry_tags_checker_catches_violations():
    """The Contract 14 guard must FAIL on the known bad shapes."""
    good = 'mod-a:\n  path: a/\n  tags: ["type:engine", "domain:diagnostics"]\n'
    entries, tag_lines, violations = scan_registry_tags(good)
    assert (entries, tag_lines, violations) == (1, 1, [])

    bad_cases = {
        "unknown namespace": '  tags: ["tier:gold", "domain:assets"]\n',
        "unknown value": '  tags: ["type:blockchain", "domain:assets"]\n',
        "missing domain": '  tags: ["type:engine"]\n',
        "malformed tag": '  tags: ["engine", "domain:assets"]\n',
    }
    for label, src in bad_cases.items():
        _, _, violations = scan_registry_tags(src)
        assert violations, f"checker missed: {label}"

    untagged = "mod-a:\n  path: a/\nmod-b:\n  path: b/\n"
    entries, tag_lines, violations = scan_registry_tags(untagged)
    assert entries == 2 and tag_lines == 0, "entry counting broke"

    # A trailing comment must not hide an entry from the count (Gate 7 F9).
    commented = "mod-a: # note\n  path: a/\n"
    entries, tag_lines, _ = scan_registry_tags(commented)
    assert entries == 1 and tag_lines == 0, "trailing-comment key evaded the entry count"
