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
import re
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
