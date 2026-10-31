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
    assert "CURRENT IMPLEMENTATION MAP" in text
    assert "FACTORYLM_UI_DESIGN_POLICY.md" in text
    assert "Read-only consumer inspection" in text
    assert "Button-like treatments" in text
    assert "FactoryLMShell.tsx" in text


def test_catalog_stub_does_not_invent_filenames_or_close_open_proofs() -> None:
    text = CATALOG.read_text(encoding="utf-8")
    assert "/Users/bravonode/mira-dogfood/ui-catalog-2026-09-10/" in text
    assert "PENDING Bravo ls" in text
    assert "f8913760b814d8edadf7375662605759215c7af6" in text
    assert "**FAIL** — human tap: `+` → Add sources, not Camera" in text
    assert "**PASS** — L0 still educational on this tip" in text
    assert "Harrington UMS3-0335" in text
    assert "not authorized" in text.lower() or "not authorized" in text
    camera_row = next(line for line in text.splitlines() if line.startswith("| Camera-open"))
    assert "FAIL" in camera_row and "PASS" not in camera_row
