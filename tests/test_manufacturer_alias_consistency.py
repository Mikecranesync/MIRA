"""Cross-service consistency tests for the manufacturer normalizer map (#1596).

The OCR-variant → canonical map is vendored in THREE places because build
contexts are per-container and the services cannot import across package
boundaries:

- ``mira-crawler/ingest/manufacturer_normalize.py`` — Python, source of truth.
- ``mira-core/mira-ingest/db/manufacturer_normalize.py`` — Python copy.
- ``mira-hub/src/lib/manufacturer-aliases.json`` — JSON copy.

If these drift, the same vendor groups differently depending on which service
ingested the chunk — re-fragmenting the catalog #1596 set out to consolidate.
These tests read each copy BY PATH (no cross-package imports) and assert they
stay byte-equal in meaning, and that the catalog side agrees with the
query-side resolver's ``VENDOR_ALIASES`` on every shared key.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

CRAWLER_MODULE = REPO_ROOT / "mira-crawler" / "ingest" / "manufacturer_normalize.py"
CORE_MODULE = REPO_ROOT / "mira-core" / "mira-ingest" / "db" / "manufacturer_normalize.py"
HUB_JSON = REPO_ROOT / "mira-hub" / "src" / "lib" / "manufacturer-aliases.json"
RESOLVER_MODULE = REPO_ROOT / "mira-bots" / "shared" / "uns_resolver.py"


def _parse_dict_assignment(path: Path, name: str) -> dict[str, str]:
    """Extract a module-level ``name: dict[str, str] = {...}`` literal via AST.

    The assignment is annotated, so it parses as an ``ast.AnnAssign`` (not a
    plain ``ast.Assign``). ``ast.literal_eval`` ignores comments, so the
    inline comments in these dict literals are harmless.
    """
    tree = ast.parse(path.read_text(), filename=str(path))
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id == name and node.value is not None:
                value = ast.literal_eval(node.value)
                if not isinstance(value, dict):
                    raise TypeError(f"{name} in {path} is not a dict literal")
                return value
    raise AssertionError(f"{name!r} (annotated assignment) not found in {path}")


def test_three_maps_are_equal() -> None:
    """Crawler, mira-core, and hub copies must be identical (keys AND values)."""
    crawler = _parse_dict_assignment(CRAWLER_MODULE, "OCR_VARIANT_ALIASES")
    core = _parse_dict_assignment(CORE_MODULE, "OCR_VARIANT_ALIASES")
    with HUB_JSON.open() as f:
        hub = json.load(f)

    assert crawler == core, (
        "OCR_VARIANT_ALIASES diverged between the crawler and mira-core copies. "
        f"crawler-only={set(crawler.items()) - set(core.items())}; "
        f"core-only={set(core.items()) - set(crawler.items())}. "
        "Keep both Python copies byte-identical."
    )
    assert crawler == hub, (
        "OCR_VARIANT_ALIASES diverged between the crawler copy and the hub JSON. "
        f"crawler-only={set(crawler.items()) - set(hub.items())}; "
        f"hub-only={set(hub.items()) - set(crawler.items())}. "
        "Regenerate mira-hub/src/lib/manufacturer-aliases.json from the crawler map."
    )
    # Transitively core == hub, but assert it explicitly for a clear message.
    assert core == hub, (
        "OCR_VARIANT_ALIASES diverged between the mira-core copy and the hub JSON. "
        f"core-only={set(core.items()) - set(hub.items())}; "
        f"hub-only={set(hub.items()) - set(core.items())}."
    )


def test_catalog_agrees_with_resolver_on_shared_keys() -> None:
    """Every key in BOTH the ingest map and the resolver's VENDOR_ALIASES must
    map to the same canonical, so the catalog and query sides group the same.

    Today the only overlap is ``allen-bradley`` (and its space variant) →
    "Rockwell Automation". This test makes that agreement permanent.
    """
    catalog = _parse_dict_assignment(CRAWLER_MODULE, "OCR_VARIANT_ALIASES")
    resolver = _parse_dict_assignment(RESOLVER_MODULE, "VENDOR_ALIASES")

    shared_keys = set(catalog) & set(resolver)
    # Guard against a vacuous pass: if a parse bug emptied either dict, the
    # intersection would be empty and this test would assert nothing. The
    # canonical #1596 overlap MUST be present.
    assert "allen-bradley" in shared_keys, (
        "Expected 'allen-bradley' in both OCR_VARIANT_ALIASES and the resolver's "
        f"VENDOR_ALIASES. shared_keys={sorted(shared_keys)}. A parse failure or a "
        "removed key would make this consistency check vacuous."
    )

    mismatches = {
        key: (catalog[key], resolver[key]) for key in shared_keys if catalog[key] != resolver[key]
    }
    assert not mismatches, (
        "Catalog vs resolver canonical disagreement on shared keys "
        "(key: (catalog, resolver)): "
        f"{mismatches}. Both sides must group the vendor identically."
    )
