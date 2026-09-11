"""Guard: the Phase 1 design-system inventory stays complete.

Policy §7 requires a classification for each visual category before restyle.
This test locks the inventory path and required headings so a later agent
cannot invent a second library without first updating the map.
"""

from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
INVENTORY = REPO_ROOT / "docs" / "ux" / "FACTORYLM_UI_DESIGN_SYSTEM_INVENTORY.md"
CATALOG = REPO_ROOT / "wiki" / "references" / "unified-shell-catalog-2026-09-10.md"

REQUIRED_CATEGORIES = (
    "Typography",
    "Spacing",
    "Colors",
    "Borders",
    "Radii",
    "Shadows / elevation",
    "Icons",
    "Button",
    "Inputs",
    "Composer",
    "Sidebar / navigation",
    "Sheets / dialogs",
    "Messages / content",
    "Citations",
    "Machine / asset context",
    "Status presentation",
    "Empty states",
    "Loading states",
    "Error states",
    "Ask / Work transitions",
)

REQUIRED_DISPOSITIONS = ("KEEP", "CONSOLIDATE", "RETIRE", "DEFER")
CLASSIFICATION_KEYS = (
    "CANONICAL",
    "DUPLICATE",
    "LEGACY/FROZEN",
    "ONE-OFF",
    "UNKNOWN",
)


def test_inventory_exists_and_classifies_policy_categories() -> None:
    text = INVENTORY.read_text(encoding="utf-8")
    assert "Phase 1" in text
    for category in REQUIRED_CATEGORIES:
        assert f"| {category} |" in text, f"missing category row: {category}"
    for key in CLASSIFICATION_KEYS:
        assert key in text
    for heading in REQUIRED_DISPOSITIONS:
        assert f"### {heading}" in text
    assert "packages/factorylm-ui" in text
    assert "docs/design/factorylm-tokens.css" in text
    assert "Do not create another UI package" in text


def test_catalog_stub_does_not_invent_filenames_or_close_open_proofs() -> None:
    text = CATALOG.read_text(encoding="utf-8")
    assert "/Users/bravonode/mira-dogfood/ui-catalog-2026-09-10/" in text
    assert "PENDING Bravo ls" in text
    assert "f8913760b814d8edadf7375662605759215c7af6" in text
    assert "**OPEN** until a human tap" in text
    assert "**OPEN** until actually run" in text
    assert "not authorized" in text.lower() or "not authorized" in text
