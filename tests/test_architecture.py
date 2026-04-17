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
