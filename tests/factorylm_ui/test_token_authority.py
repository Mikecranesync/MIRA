"""Lock unified-shell token ownership without changing token values.

Answer: edit ``docs/design/factorylm-tokens.css``, sync the theme package
copy, consume via ``workspace.css`` aliases. Other ``*tokens.css`` files
are not the unified-shell source of truth (several have already drifted).
"""

from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
AUTHORITATIVE = REPO_ROOT / "docs" / "design" / "factorylm-tokens.css"
PACKAGE_COPY = REPO_ROOT / "packages" / "factorylm-theme" / "src" / "tokens.css"
WORKSPACE = REPO_ROOT / "packages" / "factorylm-theme" / "src" / "workspace.css"
INVENTORY = REPO_ROOT / "docs" / "ux" / "FACTORYLM_UI_DESIGN_SYSTEM_INVENTORY.md"

# Named like tokens, but not the unified-shell SoT. Existence is locked so
# agents cannot "forget" them and invent a fifth copy.
DRIFTED_OR_FOREIGN = (
    REPO_ROOT / "mira-contextualizer" / "mira_contextualizer" / "gui" / "factorylm-tokens.css",
    REPO_ROOT / "tools" / "factorylm_ai" / "review_console" / "factorylm-tokens.css",
    REPO_ROOT / "mira-web" / "public" / "_tokens.css",
    REPO_ROOT / "mira-mobile" / "src" / "tokens.css",
)


def test_authoritative_tokens_match_theme_package_copy() -> None:
    assert AUTHORITATIVE.is_file()
    assert PACKAGE_COPY.is_file()
    assert AUTHORITATIVE.read_bytes() == PACKAGE_COPY.read_bytes()


def test_workspace_aliases_import_the_package_copy() -> None:
    css = WORKSPACE.read_text(encoding="utf-8")
    assert '@import "./tokens.css"' in css
    assert "--fl-workspace-radius" in css
    assert "--fl-dark-bg-glass" not in css


def test_drifted_named_token_files_are_not_byte_identical_to_authoritative() -> None:
    canonical = AUTHORITATIVE.read_bytes()
    for path in DRIFTED_OR_FOREIGN:
        assert path.is_file(), f"missing tracked token-like file: {path}"
        assert path.read_bytes() != canonical, (
            f"{path} unexpectedly matches the SoT; update the inventory if it was resynced"
        )


def test_inventory_states_token_roles_and_policy_authority() -> None:
    text = INVENTORY.read_text(encoding="utf-8")
    assert "CURRENT IMPLEMENTATION MAP" in text
    assert "CONSTITUTION / durable design law" in text
    assert "docs/ux/FACTORYLM_UI_DESIGN_POLICY.md" in text
    assert "Do **not** duplicate or rewrite constitutional rules here" in text
    for phrase in (
        "AUTHORITATIVE SOURCE",
        "GENERATED/COPIED",
        "RUNTIME OVERRIDES",
        "CONSUMERS",
    ):
        assert phrase in text
    assert "docs/design/factorylm-tokens.css" in text
    assert "packages/factorylm-theme/src/tokens.css" in text
    assert "packages/factorylm-theme/src/workspace.css" in text
