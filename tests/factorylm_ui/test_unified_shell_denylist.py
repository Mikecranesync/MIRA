"""Lock the unified-shell stylesheets against policy §5 decorative slop.

Does not restyle anything. Reads the CSS that actually paints
``packages/factorylm-ui`` and fails if a denylisted technique appears there.
Marketing tokens such as ``--fl-dark-bg-glass`` may remain in
``docs/design/factorylm-tokens.css``; they must not be *used* by the shell.
"""

from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SHELL_CSS = (
    REPO_ROOT / "packages" / "factorylm-ui" / "src" / "shell.css",
    REPO_ROOT / "packages" / "factorylm-ui" / "src" / "conversation.css",
)
WORKSPACE_CSS = REPO_ROOT / "packages" / "factorylm-theme" / "src" / "workspace.css"

DENYLIST = (
    re.compile(r"linear-gradient\s*\(", re.I),
    re.compile(r"radial-gradient\s*\(", re.I),
    re.compile(r"conic-gradient\s*\(", re.I),
    re.compile(r"backdrop-filter\s*:", re.I),
    re.compile(r"(?<![-\\w])blur\s*\(", re.I),
    re.compile(r"drop-shadow\s*\(", re.I),
    re.compile(r"sparkle", re.I),
    re.compile(r"\bglow\b", re.I),
)


def _strip_comments(css: str) -> str:
    return re.sub(r"/\*[\s\S]*?\*/", "", css)


def test_unified_shell_stylesheets_have_no_denylisted_decoration() -> None:
    for path in SHELL_CSS:
        body = _strip_comments(path.read_text(encoding="utf-8"))
        for pattern in DENYLIST:
            match = pattern.search(body)
            assert match is None, f"{path.name} matches {pattern.pattern!r} at {match.group(0)!r}"


def test_workspace_aliases_do_not_bind_glass_or_literal_color() -> None:
    css = _strip_comments(WORKSPACE_CSS.read_text(encoding="utf-8"))
    assert "--fl-dark-bg-glass" not in css
    assert "glass" not in css.lower()
    assert re.search(r"#[0-9a-f]{3,8}\b", css, re.I) is None
