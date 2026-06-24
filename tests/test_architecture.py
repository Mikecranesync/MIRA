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
