"""The Print of the Day image copies a hand-picked slice of mira-bots/shared, not
the whole package. This pins that the slice is a closed import set: every
module the copied files import relatively — transitively — is copied too, so
`import shared.inference.router` cannot fail inside the built image (Codex r1 F5
on #4355: a new sibling import made the judge unavailable).

Docker is not needed: the check reads the Dockerfile's COPY lines and the
copied modules' own import statements.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = ROOT / "tools" / "print_of_day" / "Dockerfile"
SRC_PREFIX = "mira-bots/shared/"


def _copied_shared_modules(dockerfile: str) -> set[str]:
    """Repo-relative paths of mira-bots/shared files the image COPYs."""
    out: set[str] = set()
    for m in re.finditer(r"^COPY\s+(\S+)\s+\S+\s*$", dockerfile, re.MULTILINE):
        src = m.group(1)
        if src.startswith(SRC_PREFIX) and src.endswith(".py"):
            out.add(src)
    return out


def _relative_imports(path: Path) -> set[str]:
    """Repo-relative module files a module imports with a relative import."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    pkg = path.parent
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level:
            base = pkg
            for _ in range(node.level - 1):
                base = base.parent
            if node.module:
                target = base.joinpath(*node.module.split("."))
                found.add(str(target.with_suffix(".py").relative_to(ROOT)))
            else:
                for alias in node.names:
                    found.add(str((base / f"{alias.name}.py").relative_to(ROOT)))
    return found


def _missing(copied: set[str]) -> set[str]:
    missing: set[str] = set()
    seen: set[str] = set()
    todo = [p for p in copied if p.endswith("router.py")]
    while todo:
        rel = todo.pop()
        if rel in seen:
            continue
        seen.add(rel)
        for dep in _relative_imports(ROOT / rel):
            if dep not in copied:
                missing.add(dep)
            else:
                todo.append(dep)
    return missing


def test_the_router_import_closure_is_fully_copied_into_the_image():
    copied = _copied_shared_modules(DOCKERFILE.read_text(encoding="utf-8"))
    assert "mira-bots/shared/inference/router.py" in copied  # precondition
    assert _missing(copied) == set()


def test_control_a_missing_sibling_is_detected():
    copied = _copied_shared_modules(DOCKERFILE.read_text(encoding="utf-8"))
    copied.discard("mira-bots/shared/inference/run_budget.py")
    assert _missing(copied) == {"mira-bots/shared/inference/run_budget.py"}
