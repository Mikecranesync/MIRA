"""Discover every configured feeder origin, structurally.

The consistency test that guards the provenance policy is only as good as this
discovery. A hardcoded list of manifests is the failure mode: a new feeder — or
a renamed constant — escapes silently and the test still passes, which is worse
than no test because it reads as coverage.

So nothing here is hardcoded. It walks `mira-crawler/tasks/*.py` and picks up
**any module-level constant whose value contains http(s) URLs**, whether that is
a plain assignment, an annotated one, a list of strings, or a list of dicts.
Writing this the naive way already missed two of five real manifests:

* `RSS_FEEDS: list[dict] = [...]` is an ``ast.AnnAssign``, not an ``ast.Assign``.
* `foundational.py` has **two** manifests (`DIRECT_TARGETS`, `APIFY_TARGETS`);
  a per-file assumption of one would have dropped the second.

`test_provenance_policy.py` asserts the discovered population against the
manifests known to exist, so a regression in this walker fails loudly instead of
quietly shrinking the set it is supposed to police.
"""

from __future__ import annotations

import ast
from pathlib import Path
from urllib.parse import urlparse

__all__ = ["TASKS_DIR", "discover_feeder_origins", "discover_manifests"]

TASKS_DIR = Path(__file__).resolve().parents[1] / "tasks"


def _urls_in(node: ast.AST) -> list[str]:
    return [
        n.value
        for n in ast.walk(node)
        if isinstance(n, ast.Constant)
        and isinstance(n.value, str)
        # Scheme match is case-insensitive (Gate 7 round-12 group A on #3268):
        # a constant written `HTTPS://...` is still a configured origin, and a
        # manifest discovery that missed it would leave the policy consistency
        # test vacuous for that origin.
        and n.value.lower().startswith(("http://", "https://"))
    ]


def discover_manifests(tasks_dir: Path | None = None) -> dict[str, list[str]]:
    """Return ``{"<module>.<CONSTANT>": [url, ...]}`` for every URL manifest.

    Module-level only: a URL built inside a function is a runtime value, not a
    configured origin, and cannot be classified ahead of time.
    """
    tasks_dir = tasks_dir or TASKS_DIR
    found: dict[str, list[str]] = {}
    for py in sorted(tasks_dir.glob("*.py")):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            continue
        for node in tree.body:
            if isinstance(node, ast.Assign):
                targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
                value = node.value
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                targets = [node.target.id]
                value = node.value
            else:
                continue
            if value is None:
                continue
            urls = _urls_in(value)
            if not urls:
                continue
            for name in targets:
                found[f"{py.stem}.{name}"] = urls
    return found


def discover_feeder_origins(tasks_dir: Path | None = None) -> dict[str, set[str]]:
    """Return ``{host: {"<module>.<CONSTANT>", ...}}`` — origin to its sources."""
    origins: dict[str, set[str]] = {}
    for manifest, urls in discover_manifests(tasks_dir).items():
        for url in urls:
            host = (urlparse(url).hostname or "").lower()
            if host:
                origins.setdefault(host, set()).add(manifest)
    return origins
