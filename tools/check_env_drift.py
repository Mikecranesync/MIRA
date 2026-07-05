#!/usr/bin/env python3
"""Env-var drift checker (docs/known-issues.md).

Keeps the env vars actually referenced by the SaaS/staging docker-compose
files in sync with the two documented sources of truth:

  - docs/env-vars.md   (the full reference table)
  - .env.template      (the template every deployer copies to .env)

Today that sync is manual dual-maintenance; this script makes drift a fast,
greppable, CI-enforced check instead of a silent gap.

What it checks
--------------
(a) used-but-undocumented -- a var is referenced via `${VAR}` / `${VAR:-...}`
    inside an `environment:` block in a compose file, but appears in neither
    docs/env-vars.md nor .env.template.
(b) documented-but-unused -- a var is documented in one of the two doc files
    but never referenced via `${VAR}` in any scanned compose file.

Only `${VAR}` shell-substitution references inside `environment:` blocks are
collected as "used" -- plain literal environment keys (e.g. `POSTGRES_DB: atlas`,
container-internal values that are never Doppler-injected) are not env vars in
the drift sense and are intentionally not flagged.

Exit status
-----------
0 if no drift, or all drift is covered by tools/env_drift_allowlist.txt.
1 if there is uncovered drift.

Usage
-----
    python3 tools/check_env_drift.py
    python3 tools/check_env_drift.py --compose docker-compose.yml docker-compose.saas.yml
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_COMPOSE_FILES = [
    "docker-compose.saas.yml",
    "docker-compose.staging-vps.yml",
]

DEFAULT_DOC_FILES = [
    "docs/env-vars.md",
    ".env.template",
]

DEFAULT_ALLOWLIST = "tools/env_drift_allowlist.txt"

# ${VAR}, ${VAR:-default}, ${VAR:?msg}, ${VAR:=default}, ${VAR-default}, ${VAR:+alt}
VAR_REF_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?[-=?+][^}]*)?\}")

# A markdown table row's first backticked identifier, and a `~~`removed`~~` var.
DOC_MD_ROW_RE = re.compile(r"^\|\s*~{0,2}`([A-Za-z_][A-Za-z0-9_]*)`")

# .env.template: `# VAR=...` (documented, Doppler-managed) or `VAR=value` (local config).
DOC_ENV_LINE_RE = re.compile(r"^#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=")


def extract_environment_blocks(text: str) -> list[str]:
    """Return the text of every top-level `environment:` block in a compose file.

    A block runs from the `environment:` line until a sibling key at the same
    or lesser indentation (or EOF). This is a lightweight indentation scan, not
    a full YAML parse -- good enough for `${VAR}` extraction and robust to the
    anchors/merge-key (`<<: *common_env`) style used in these compose files.
    """
    lines = text.splitlines()
    blocks: list[str] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        stripped = line.lstrip(" ")
        indent = len(line) - len(stripped)
        if re.match(r"environment\s*:\s*(#.*)?$", stripped) or re.match(
            r"^x-[\w-]+\s*:\s*&[\w-]+\s*$", stripped
        ):
            # Also treat YAML anchor blocks like `x-common-env: &common_env` as
            # an environment-shaped block, since compose files commonly define
            # shared env fragments this way and reference them via `<<: *name`.
            block_lines: list[str] = []
            j = i + 1
            while j < n:
                nxt = lines[j]
                nxt_stripped = nxt.lstrip(" ")
                if nxt_stripped == "" or nxt_stripped.startswith("#"):
                    block_lines.append(nxt)
                    j += 1
                    continue
                nxt_indent = len(nxt) - len(nxt_stripped)
                if nxt_indent <= indent:
                    break
                block_lines.append(nxt)
                j += 1
            blocks.append("\n".join(block_lines))
            i = j
        else:
            i += 1
    return blocks


def used_vars_in_compose(path: Path) -> set[str]:
    text = path.read_text()
    used: set[str] = set()
    for block in extract_environment_blocks(text):
        used.update(VAR_REF_RE.findall(block))
    return used


def documented_vars_in_env_vars_md(path: Path) -> set[str]:
    documented: set[str] = set()
    for line in path.read_text().splitlines():
        m = DOC_MD_ROW_RE.match(line.strip())
        if m:
            documented.add(m.group(1))
    return documented


def documented_vars_in_env_template(path: Path) -> set[str]:
    documented: set[str] = set()
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("# ==="):
            continue
        m = DOC_ENV_LINE_RE.match(stripped)
        if m:
            documented.add(m.group(1))
    return documented


def load_allowlist(path: Path) -> set[str]:
    if not path.exists():
        return set()
    names: set[str] = set()
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        names.add(stripped)
    return names


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--compose",
        nargs="+",
        default=DEFAULT_COMPOSE_FILES,
        help="compose files to scan for ${VAR} usage (default: %(default)s)",
    )
    parser.add_argument(
        "--docs",
        nargs="+",
        default=DEFAULT_DOC_FILES,
        help="doc files that declare the documented var set (default: %(default)s)",
    )
    parser.add_argument(
        "--allowlist",
        default=DEFAULT_ALLOWLIST,
        help="file listing pre-existing drift names to not fail on (default: %(default)s)",
    )
    args = parser.parse_args()

    compose_paths = [REPO_ROOT / p for p in args.compose]
    doc_paths = [REPO_ROOT / p for p in args.docs]
    allowlist_path = REPO_ROOT / args.allowlist

    missing_files = [p for p in compose_paths + doc_paths if not p.exists()]
    if missing_files:
        for p in missing_files:
            print(f"check_env_drift: ERROR file not found: {p}", file=sys.stderr)
        return 1

    used: set[str] = set()
    for p in compose_paths:
        used |= used_vars_in_compose(p)

    documented: set[str] = set()
    for p in doc_paths:
        if p.name == "env-vars.md":
            documented |= documented_vars_in_env_vars_md(p)
        elif p.name == ".env.template":
            documented |= documented_vars_in_env_template(p)
        else:
            # Fallback: try both extraction styles for an unrecognized doc file.
            documented |= documented_vars_in_env_vars_md(p)
            documented |= documented_vars_in_env_template(p)

    allowlist = load_allowlist(allowlist_path)

    used_undocumented = sorted(used - documented)
    documented_unused = sorted(documented - used)

    uncovered_used_undocumented = [v for v in used_undocumented if v not in allowlist]
    uncovered_documented_unused = [v for v in documented_unused if v not in allowlist]

    print("=== env-var drift report ===")
    print(f"compose files scanned : {', '.join(str(p.relative_to(REPO_ROOT)) for p in compose_paths)}")
    print(f"doc files scanned     : {', '.join(str(p.relative_to(REPO_ROOT)) for p in doc_paths)}")
    print(f"vars used in compose  : {len(used)}")
    print(f"vars documented       : {len(documented)}")
    print()

    print(f"(a) used-but-undocumented: {len(used_undocumented)}")
    for v in used_undocumented:
        flag = " [allowlisted]" if v in allowlist else ""
        print(f"  USED_UNDOCUMENTED  {v}{flag}")
    print()

    print(f"(b) documented-but-unused: {len(documented_unused)}")
    for v in documented_unused:
        flag = " [allowlisted]" if v in allowlist else ""
        print(f"  DOCUMENTED_UNUSED  {v}{flag}")
    print()

    total_uncovered = len(uncovered_used_undocumented) + len(uncovered_documented_unused)
    if total_uncovered:
        print(
            f"DRIFT: {total_uncovered} uncovered offender(s) "
            f"({len(uncovered_used_undocumented)} used-but-undocumented, "
            f"{len(uncovered_documented_unused)} documented-but-unused)."
        )
        print(
            f"Fix by documenting/removing the var, or add it to {args.allowlist} "
            "(only for genuine pre-existing drift being burned down)."
        )
        return 1

    print("OK: no uncovered env-var drift.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
