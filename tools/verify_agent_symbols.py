#!/usr/bin/env python3
"""Flag first-party Python imports added in a diff whose symbol can't be found
anywhere in the repo — the "ConnectorService" class of agent fabrication.

Usage:
    tools/verify_agent_symbols.py                  # staged diff (pre-commit)
    tools/verify_agent_symbols.py --base origin/main  # PR diff (CI)

Exit 0 = nothing flagged. Exit 1 = unresolved symbol(s) found.

Scope (read this before trusting a clean run):
  - Only checks NEWLY ADDED `from <first-party-module> import <Name>` lines.
    Bare `import x` and third-party/stdlib imports are skipped — they're not
    where agents fabricate names.
  - "First-party" = the import path starts with a known repo package root
    (see FIRST_PARTY_ROOTS) or is a relative import (`from . import x`).
  - Resolution is a repo-wide index built in one pass: does `def Name` /
    `class Name` / a module-level `Name = ...` / a file `Name.py` / a package
    dir `Name/__init__.py` exist ANYWHERE in the tree? It does NOT verify the
    symbol lives in the specific module imported — a same-name symbol in the
    wrong module is a different (rarer) bug this script won't catch.
  - Does NOT catch non-import fabrication — e.g. an invented DB/enum/state
    string like `approved_state` that was never a real column value. That
    class of fabrication has no import to anchor on; it requires grepping
    migrations/enum definitions by hand (see .claude/rules/debugging-conventions.md).
  - Multi-line parenthesized `from x import (\n  A,\n  B,\n)` blocks are not
    parsed — single-line import statements only.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_DIR_NAMES = {
    ".venv", "node_modules", ".git", "__pycache__", ".ruff_cache",
    ".pytest_cache", ".hypothesis", "dist", "build", ".codegraph",
}

DEF_RE = re.compile(r"^\s*(?:def|class)\s+(\w+)\b")
CONST_RE = re.compile(r"^(\w+)\s*[:=]")

FIRST_PARTY_ROOTS = {
    "mira_bots", "mira_connectors", "mira_crawler", "mira_mcp",
    "mira_pipeline", "mira_bridge", "mira_cmms", "mira_core",
    "mira_relay", "mira_sidecar", "mira_connect", "shared", "core",
    "simlab", "plc",
}

IMPORT_LINE_RE = re.compile(r"^\+\s*from\s+([\w\.]+)\s+import\s+(.+)$")
IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# names too common/generic to be worth checking (submodule aliases, wildcards)
SKIP_NAMES = {"*"}


def is_first_party(module: str) -> bool:
    if module.startswith("."):
        return True
    root = module.split(".", 1)[0]
    return root in FIRST_PARTY_ROOTS


def parse_added_imports(diff_text: str) -> list[tuple[str, str, str, int]]:
    """Returns (file, module, symbol, hunk_line_hint) for first-party from-imports."""
    results = []
    current_file = None
    line_no = 0
    for line in diff_text.splitlines():
        if line.startswith("+++ b/"):
            current_file = line[len("+++ b/"):]
            line_no = 0
            continue
        if line.startswith("@@"):
            m = re.search(r"\+(\d+)", line)
            if m:
                line_no = int(m.group(1)) - 1
            continue
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            line_no += 1
        elif not line.startswith("-"):
            line_no += 1

        if not current_file or not current_file.endswith(".py"):
            continue
        if line.startswith("+++"):
            continue
        m = IMPORT_LINE_RE.match(line)
        if not m:
            continue
        module, names_part = m.group(1), m.group(2)
        if not is_first_party(module):
            continue
        if names_part.strip().startswith("("):
            # multi-line import block — not supported, see module docstring
            continue
        for raw_name in names_part.split(","):
            name = raw_name.strip().split(" as ")[0].strip().rstrip(")").strip()
            if not name or name in SKIP_NAMES or not IDENTIFIER_RE.match(name):
                continue
            results.append((current_file, module, name, line_no))
    return results


def iter_repo_py_files():
    for path in REPO_ROOT.rglob("*.py"):
        if any(part in EXCLUDE_DIR_NAMES for part in path.parts):
            continue
        yield path


def build_symbol_index() -> tuple[set[str], set[str], set[str]]:
    """One pass over the tree: (def/class names, module-level names, module/package stems)."""
    defs: set[str] = set()
    consts: set[str] = set()
    modules: set[str] = set()
    for path in iter_repo_py_files():
        modules.add(path.stem)
        if path.name == "__init__.py":
            modules.add(path.parent.name)
        try:
            text = path.read_text(errors="ignore")
        except OSError:
            continue
        for line in text.splitlines():
            m = DEF_RE.match(line)
            if m:
                defs.add(m.group(1))
                continue
            m = CONST_RE.match(line)
            if m:
                consts.add(m.group(1))
    return defs, consts, modules


def symbol_exists(name: str, index: tuple[set[str], set[str], set[str]]) -> bool:
    defs, consts, modules = index
    return name in defs or name in consts or name in modules


def get_diff(base: str | None) -> str:
    if base:
        cmd = ["git", "diff", "--no-color", "-U0", f"{base}...HEAD", "--", "*.py"]
    else:
        cmd = ["git", "diff", "--no-color", "-U0", "--cached", "--", "*.py"]
    result = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)
    return result.stdout


def main() -> int:
    base = None
    if "--base" in sys.argv:
        idx = sys.argv.index("--base")
        base = sys.argv[idx + 1]

    diff_text = get_diff(base)
    if not diff_text.strip():
        print("verify_agent_symbols: no staged/changed .py imports to check.")
        return 0

    candidates = parse_added_imports(diff_text)
    if not candidates:
        print("verify_agent_symbols: no new first-party imports in this diff.")
        return 0

    index = build_symbol_index()
    unresolved = []
    for file, module, name, line_hint in candidates:
        if not symbol_exists(name, index):
            unresolved.append((file, module, name, line_hint))

    if unresolved:
        print("verify_agent_symbols: UNRESOLVED first-party import(s) — possible fabrication:")
        for file, module, name, line_hint in unresolved:
            print(f"  ✗ {file}:~{line_hint}  from {module} import {name}")
        print()
        print("  Each name above was not found as a def/class/constant/module")
        print("  anywhere in the repo. If it's real, this check has a gap — fix")
        print("  the check. If it's not, the import is fabricated (or the symbol")
        print("  was renamed/removed) — regenerate the code, don't paper over it.")
        print()
        print("  NOTE: this only catches import-level fabrication. It does NOT")
        print("  catch invented DB/enum/state strings (e.g. a made-up status")
        print("  value) — verify those by hand against migrations/enum defs.")
        return 1

    print(f"verify_agent_symbols: {len(candidates)} first-party import(s) checked, all resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
