"""Parity guard: manual source registry -> pack -> resolver match surface.

Drive Commander Phase 2 (issue #2561). Proves the invariant that a drive
model the manual-source registry (``tools/drive-pack-extract/registry/
sources.json``) declares *applicable* to a live pack is actually matchable
by that pack at runtime (``shared.drive_packs.loader`` / ``resolver``). If a
registry entry claims "GS11N" applies but the pack's ``family.aliases`` /
``nameplate.match_keywords`` don't contain it, a technician naming "GS11N"
would silently resolve to no pack at all -- applicability declared in the
registry would not have survived into the runtime match surface.

Pure, no-LLM, no-DB, no-network -- every case here is a plain function call
against the two real LIVE packs (``durapulse_gs10``, ``powerflex_525``), the
same convention as ``test_service_pack_resolver.py``.
"""

from __future__ import annotations

import importlib.util
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.drive_packs import list_packs, load_pack  # noqa: E402

# ``applicability.py`` lives under tools/drive-pack-extract/registry/, which
# is not on sys.path (it's a standalone tool dir, not an importable package
# rooted at repo root) -- load it by absolute file path instead.
_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_TEST_DIR, "..", ".."))
_APPLICABILITY_PATH = os.path.join(
    _REPO_ROOT, "tools", "drive-pack-extract", "registry", "applicability.py"
)

_spec = importlib.util.spec_from_file_location(
    "drive_pack_extract_registry_applicability", _APPLICABILITY_PATH
)
assert _spec is not None and _spec.loader is not None, (
    f"could not load applicability.py from {_APPLICABILITY_PATH}"
)
_applicability = importlib.util.module_from_spec(_spec)
# Register before exec so dataclasses' postponed-annotation resolution (which
# looks the module up in sys.modules by __module__ name) can find it.
sys.modules[_spec.name] = _applicability
_spec.loader.exec_module(_applicability)

applicability_from_source = _applicability.applicability_from_source
load_sources = _applicability.load_sources
ManualApplicability = _applicability.ManualApplicability


def _pack_match_haystack(pack) -> list[str]:
    """Every string (lowercased) the pack will match against free text."""
    return [a.lower() for a in pack.family.aliases] + [
        k.lower() for k in pack.nameplate.match_keywords
    ]


def _model_reaches_pack(model: str, pack) -> bool:
    """True when ``model`` (case-insensitive) is matchable by the pack --
    i.e. it appears as a substring of at least one family alias or
    nameplate match keyword."""
    needle = model.lower()
    return any(needle in hay for hay in _pack_match_haystack(pack))


def _sources_by_pack_id(pack_id: str) -> dict:
    sources = load_sources()
    matches = [s for s in sources if s.get("pack_id") == pack_id]
    assert matches, f"expected a sources.json manual entry with pack_id={pack_id!r}"
    return matches[0]


# --- Test 1: applicability survives from registry -> pack match surface ----


def test_gs10_registry_applicability_reaches_the_live_pack():
    """The concrete, must-hold invariant: every model the registry declares
    applicable to durapulse_gs10 (GS10, GS-10, GS11N, GS13N) is actually
    matchable by the live pack's family aliases / nameplate keywords."""
    assert "durapulse_gs10" in list_packs(), "durapulse_gs10 must be a live pack"
    entry = _sources_by_pack_id("durapulse_gs10")
    pack = load_pack("durapulse_gs10")

    models = entry.get("applicable_drive_models") or []
    assert models, "expected sources.json to declare applicable_drive_models for durapulse_gs10"
    # Lock in the known concrete set so this test can't silently degrade if
    # the registry entry is ever trimmed down to something trivial.
    assert {"GS10", "GS-10", "GS11N", "GS13N"}.issubset(set(models))

    unmatched = [m for m in models if not _model_reaches_pack(m, pack)]
    assert not unmatched, (
        f"registry declares {unmatched} applicable to durapulse_gs10 but "
        "pack.json's family.aliases / nameplate.match_keywords do not contain "
        "them -- applicability did not survive into the runtime match surface"
    )


def test_powerflex_525_registry_applicability_reaches_the_live_pack():
    """Companion check for the rockwell_powerflex_525_520-um001 manual entry
    (pack_id 'powerflex_525'). As authored today, pack.json's
    family.aliases/nameplate.match_keywords were written to mirror the
    registry's applicable_drive_models exactly ("PowerFlex 525",
    "PowerFlex 520-series", "25B" all appear verbatim), so parity holds and
    this asserts it for real -- it is NOT weakened to a no-op/skip.

    If a future edit to sources.json or pack.json ever breaks this parity,
    this test MUST fail loudly. Do not soften it back to informational
    without filing an issue documenting the gap and linking it here.
    """
    if "powerflex_525" not in list_packs():
        pytest.skip("powerflex_525 pack is not currently live")

    entry = _sources_by_pack_id("powerflex_525")
    pack = load_pack("powerflex_525")

    models = entry.get("applicable_drive_models") or []
    assert models, "expected sources.json to declare applicable_drive_models for powerflex_525"

    unmatched = [m for m in models if not _model_reaches_pack(m, pack)]
    assert not unmatched, (
        f"registry declares {unmatched} applicable to powerflex_525 but "
        "pack.json's family.aliases / nameplate.match_keywords do not contain "
        "them -- applicability did not survive into the runtime match surface "
        "(NOTE: as of writing this gap does not exist -- if you're seeing this "
        "failure, pack.json or sources.json changed; fix parity rather than "
        "weakening this assertion)"
    )


def test_all_live_pack_registry_entries_have_applicability_parity():
    """General sweep: for EVERY sources.json entry whose pack_id names a
    currently-live pack, every declared applicable model must be matchable
    by that pack. Skips entries whose pack_id isn't live (e.g. a
    manual-review-only registration with no generator wired up yet) --
    those have nothing to check against."""
    live_ids = set(list_packs())
    sources = load_sources()

    checked_any = False
    for entry in sources:
        pack_id = entry.get("pack_id")
        if pack_id not in live_ids:
            continue
        checked_any = True
        pack = load_pack(pack_id)
        models = entry.get("applicable_drive_models") or []
        unmatched = [m for m in models if not _model_reaches_pack(m, pack)]
        assert not unmatched, (
            f"registry entry {entry.get('manual_id')!r} declares {unmatched} "
            f"applicable to live pack {pack_id!r} but the pack's match surface "
            "does not contain them"
        )

    assert checked_any, "expected at least one sources.json entry to reference a live pack"


# --- Test 2: applicability_from_source() catalog-prefix derivation ---------


def test_applicability_from_source_derives_gs_catalog_prefixes():
    entry = _sources_by_pack_id("durapulse_gs10")
    applicability = applicability_from_source(entry)

    assert isinstance(applicability, ManualApplicability)
    assert applicability.manufacturer == "AutomationDirect"
    assert applicability.applies_to_models == ["GS10", "GS-10", "GS11N", "GS13N"]

    assert "GS11N" in applicability.applies_to_catalog_prefixes
    assert "GS13N" in applicability.applies_to_catalog_prefixes
    assert "GS10" not in applicability.applies_to_catalog_prefixes
    assert "GS-10" not in applicability.applies_to_catalog_prefixes


# --- Test 3: never fabricates ------------------------------------------------


def test_applicability_from_source_never_fabricates_on_missing_fields():
    assert applicability_from_source({}) == ManualApplicability()

    minimal = applicability_from_source({"vendor": "Acme"})
    assert minimal.manufacturer == "Acme"
    assert minimal.applies_to_models == []
    assert minimal.applies_to_catalog_prefixes == []
    assert minimal.excluded_models == []
    assert minimal.evidence_pages == []
    assert minimal.brand is None
    assert minimal.revision is None
    assert minimal.extraction_method == "registry"
    assert minimal.confidence == "medium"

    # None does not raise either -- degrades to all-empty defaults.
    assert applicability_from_source(None) == ManualApplicability()
