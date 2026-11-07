"""Path scopes on .claude/rules/*.md (PR #5279).

Claude Code loads a rule with a `paths:` frontmatter list only when a matching
file is touched. These tests pin two things: safety/cross-module rules stay
always-on (no `paths:`), and each scoped rule still selects the files its own
text says it governs — including real files, so a stale glob fails here.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
RULES = REPO / ".claude" / "rules"

ALWAYS_ON = [
    "dangerous-commands-safety.md",
    "security-boundaries.md",
    "knowledge-entries-tenant-scoping.md",
    "fieldbus-readonly.md",
    "uns-confirmation-gate.md",
    "direct-connection-uns-certified.md",
    "uns-compliance.md",
    "train-before-deploy.md",
    "multi-session-protocol.md",
    "session-discipline.md",
    "subagent-worktree-isolation.md",
    "materialized-evidence.md",
    "factorylm-unified-ui-cutover.md",
]

# rule -> (files it must select, files it must not select)
SCOPED = {
    "commodity-before-custom.md": (
        [
            "packages/factorylm-ui/src/PhotoViewer.tsx",
            "packages/factorylm-ui/src/Overlay.tsx",
            "mira-mobile/src/unified/UnifiedProjectRoot.tsx",
        ],
        ["mira-bots/shared/engine.py"],
    ),
    "ui-style.md": (["packages/factorylm-theme/src/tokens.css"], ["mira-relay/tag_ingest.py"]),
    "mira-hub-migrations.md": (
        ["mira-hub/db/migrations/066_migration_ledger_content_sha.sql"],
        ["mira-hub/src/lib/db.ts"],
    ),
    "fast-path-optimization.md": (["mira-bots/shared/engine.py"], ["mira-hub/src/lib/db.ts"]),
    "oem-crawler-trusted.md": (["mira-crawler/ingest/store.py"], ["mira-bots/shared/engine.py"]),
    "one-pipeline-ingest.md": (
        ["mira-relay/ingest_contract.py", "simlab/publishers.py"],
        ["mira-bots/shared/engine.py"],
    ),
    "python-standards.md": (["mira-bots/shared/engine.py"], ["mira-hub/src/lib/db.ts"]),
    "codegraph-usage.md": (
        ["mira-bots/shared/engine.py", "mira-hub/src/lib/db.ts"],
        ["docs/environments.md"],
    ),
}


def _paths(rule: str) -> list[str]:
    text = (RULES / rule).read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return []
    front = text[4 : text.index("\n---", 4)]
    globs, in_paths = [], False
    for line in front.splitlines():
        if line.startswith("paths:"):
            in_paths = True
        elif in_paths and line.startswith("  - "):
            globs.append(line[4:].strip().strip('"'))
        else:
            in_paths = False
    return globs


def _matches(glob: str, path: str) -> bool:
    rx = (
        re.escape(glob).replace(r"\*\*/", "(?:.*/)?").replace(r"\*\*", ".*").replace(r"\*", "[^/]*")
    )
    return re.fullmatch(rx, path) is not None


@pytest.mark.parametrize("rule", ALWAYS_ON)
def test_safety_and_cross_module_rules_stay_always_on(rule: str) -> None:
    assert (RULES / rule).exists(), rule
    assert _paths(rule) == [], f"{rule} must load every session; do not add paths:"


@pytest.mark.parametrize("rule", sorted(SCOPED))
def test_scoped_rule_selects_its_own_files(rule: str) -> None:
    globs = _paths(rule)
    assert globs, f"{rule} lost its paths: scope"
    must, must_not = SCOPED[rule]
    for f in must:
        assert (REPO / f).exists(), f"representative file moved: {f}"
        assert any(_matches(g, f) for g in globs), f"{rule} no longer loads for {f}"
    for f in must_not:
        assert not any(_matches(g, f) for g in globs), f"{rule} unexpectedly loads for {f}"
