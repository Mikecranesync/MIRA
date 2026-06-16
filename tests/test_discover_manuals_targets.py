"""Tests for the CRAWL_TARGETS registry in discover_manuals.py (#142)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
SCRIPTS = REPO_ROOT / "mira-core" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def test_automationdirect_is_registered():
    """GS10 / GS20 centerpiece models need a crawl target (#142)."""
    from discover_manuals import CRAWL_TARGETS
    mfrs = {t["manufacturer"] for t in CRAWL_TARGETS}
    assert "AutomationDirect" in mfrs


def test_all_fleet_vendors_registered():
    """Each fleet-registry vendor has a crawl target."""
    from discover_manuals import CRAWL_TARGETS
    mfrs = {t["manufacturer"] for t in CRAWL_TARGETS}
    expected = {
        "AutomationDirect",   # Pump-001
        "SEW-Eurodrive",      # Conv-001
        "Ingersoll Rand",     # Comp-001
        "Dake",               # Press-001
        "FANUC",              # Robot-001
    }
    missing = expected - mfrs
    assert not missing, f"Missing fleet vendors: {missing}"


def test_new_vfd_vendors_registered():
    """VFD vendors backing the structured fault-code table have crawl targets."""
    from discover_manuals import CRAWL_TARGETS
    mfrs = {t["manufacturer"] for t in CRAWL_TARGETS}
    for mfr in ("Yaskawa", "Danfoss"):
        assert mfr in mfrs, f"Missing {mfr} — needed for fault-code seed coverage"


def test_every_target_has_required_fields():
    """Every crawl target has the 4 required fields."""
    from discover_manuals import CRAWL_TARGETS
    required = {"manufacturer", "start_url", "crawler_type", "max_pages"}
    for target in CRAWL_TARGETS:
        missing = required - set(target.keys())
        assert not missing, f"{target.get('manufacturer')} missing: {missing}"


def test_crawler_type_is_valid():
    """crawler_type is 'cheerio' or 'playwright[:<browser>]' (e.g. 'playwright:chrome')."""
    from discover_manuals import CRAWL_TARGETS
    valid = {"cheerio", "playwright"}
    for target in CRAWL_TARGETS:
        # Allow "playwright:<browser>" variants per Apify crawler_type convention
        base_type = target["crawler_type"].split(":", 1)[0]
        assert base_type in valid, (
            f"{target['manufacturer']} has invalid crawler_type: "
            f"{target['crawler_type']}"
        )


def test_start_url_is_https():
    """All start_urls are HTTPS."""
    from discover_manuals import CRAWL_TARGETS
    for target in CRAWL_TARGETS:
        assert target["start_url"].startswith("https://"), (
            f"{target['manufacturer']} start_url not HTTPS: {target['start_url']}"
        )


def test_no_duplicate_manufacturers():
    from discover_manuals import CRAWL_TARGETS
    mfrs = [t["manufacturer"] for t in CRAWL_TARGETS]
    assert len(mfrs) == len(set(mfrs)), "Duplicate manufacturer entries"


def test_max_pages_reasonable():
    """max_pages is between 50 and 300 (not zero, not runaway)."""
    from discover_manuals import CRAWL_TARGETS
    for target in CRAWL_TARGETS:
        assert 50 <= target["max_pages"] <= 300, (
            f"{target['manufacturer']} max_pages out of range: "
            f"{target['max_pages']}"
        )
