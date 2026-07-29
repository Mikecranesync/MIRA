"""Guard: MODULES.md lifecycle manifest stays in sync with top-level module dirs.

Fails if:
  1. A qualifying top-level directory is missing from the MODULES.md table.
  2. A module listed in MODULES.md no longer exists as a top-level directory.

Qualifying = top-level dirs matching ``mira-*`` plus the explicit extras below.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "MODULES.md"

# Non-module top-level dirs matching nothing here are simply ignored; this set
# documents dirs one might *think* qualify (repo plumbing, docs, scratch output,
# archives) so the qualifying rule stays intentional. `mira_copy` uses an
# underscore, so it does not match the `mira-*` glob and is excluded as a
# scratch copy, not a module.
EXCLUDED = {
    "docs",
    "wiki",
    "tests",
    "tools",
    "scripts",
    "deployment",
    "install",
    "config",
    "marketing",
    "evals",
    "contracts",
    "research",
    "reports",
    "samples",
    "outputs",
    "infra",
    "calendar",
    "bravo",
    "device-profiles",
    "content_strategy",
    "PRDS",
    "Mira-BizDev",
    "dogfood-output",
    "graphify-out",
    "mira_copy",
}

# Non-mira-* dirs that DO qualify as modules.
EXTRA_MODULES = {"plc", "simlab", "ignition", "paperclip", "nango-integrations"}

VALID_STATUSES = {"DEPLOYED", "BENCH", "CI", "DEFERRED", "LEGACY", "ORPHAN"}


def qualifying_dirs() -> set[str]:
    out: set[str] = set()
    for p in REPO_ROOT.iterdir():
        if not p.is_dir() or p.name.startswith("."):
            continue
        if p.name in EXCLUDED:
            continue
        if p.name.startswith("mira-") or p.name in EXTRA_MODULES:
            out.add(p.name)
    return out


def manifest_rows() -> dict[str, str]:
    """Parse the MODULES.md table -> {module: status}."""
    assert MANIFEST.exists(), "MODULES.md is missing at repo root"
    rows: dict[str, str] = {}
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\|\s*([A-Za-z0-9_-]+)\s*\|\s*([A-Z]+)\s*\|", line)
        if not m:
            continue
        name, status = m.group(1), m.group(2)
        if name.lower() == "module":  # header row
            continue
        rows[name] = status
    assert rows, "MODULES.md contains no parseable table rows"
    return rows


def test_every_qualifying_dir_is_in_manifest():
    missing = sorted(qualifying_dirs() - set(manifest_rows()))
    assert not missing, (
        f"Top-level module dir(s) missing from MODULES.md: {missing}. "
        "Add a row (module | status | evidence | note) or add the dir to "
        "EXCLUDED in this test with a justification."
    )


def test_every_manifest_module_exists():
    stale = sorted(
        name for name in manifest_rows() if not (REPO_ROOT / name).is_dir()
    )
    assert not stale, (
        f"MODULES.md lists module dir(s) that no longer exist: {stale}. "
        "Remove the row or restore the directory."
    )


def test_statuses_are_valid():
    bad = {n: s for n, s in manifest_rows().items() if s not in VALID_STATUSES}
    assert not bad, f"Invalid status value(s) in MODULES.md: {bad} (valid: {sorted(VALID_STATUSES)})"
