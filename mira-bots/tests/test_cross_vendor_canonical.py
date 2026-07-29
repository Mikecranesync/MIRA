"""Cross-vendor filter must treat brand variants of the SAME OEM as one vendor.

Regression for the silent-drop bug: the retrieval cross-vendor filter compared
the resolved query vendor against each chunk's ``manufacturer`` with a raw
lowercased substring. The UNS resolver canonicalizes a PowerFlex query to
``"Rockwell Automation"``, but ~300 of the corpus's PowerFlex chunks are tagged
with the Allen-Bradley brand label ``"Allen-Bradley"``. ``"rockwell automation"
in "allen-bradley"`` is False, so the filter DROPPED exactly the on-equipment
chunks before they reached the prompt — same OEM, different brand label.

The fix canonicalizes both sides through ``uns_resolver.canonical_vendor`` (the
same table the citation-relevance gate already used), so Allen-Bradley ≡
Rockwell Automation. The change is additive: any chunk the old substring filter
kept is still kept; only same-vendor-different-brand chunks are rescued, and
genuinely different vendors are still dropped.

Verified against the staging corpus 2026-06-17: a PowerFlex-content query
dropped 315 ``Allen-Bradley`` chunks under the old filter; 0 under the fix.
"""

from __future__ import annotations

from shared.uns_resolver import canonical_vendor
from shared.workers.rag_worker import chunk_matches_vendor


class TestCanonicalVendor:
    def test_rockwell_brand_variants_collapse(self):
        rockwell = canonical_vendor("Rockwell Automation")
        assert rockwell == "Rockwell Automation"
        # Allen-Bradley and bare "Rockwell" are the same OEM.
        assert canonical_vendor("Allen-Bradley") == rockwell
        assert canonical_vendor("Rockwell") == rockwell
        # PowerFlex is a Rockwell product line.
        assert canonical_vendor("PowerFlex") == rockwell

    def test_automationdirect_spacing_variants_collapse(self):
        ad = canonical_vendor("AutomationDirect")
        assert ad == "AutomationDirect"
        assert canonical_vendor("Automation Direct") == ad  # space variant

    def test_yaskawa_long_form_collapses(self):
        assert canonical_vendor("Yaskawa Electric Corporation") == canonical_vendor("Yaskawa")

    def test_case_insensitive(self):
        assert canonical_vendor("siemens") == canonical_vendor("Siemens")

    def test_distinct_vendors_stay_distinct(self):
        assert canonical_vendor("Rockwell Automation") != canonical_vendor("Yaskawa")
        assert canonical_vendor("AutomationDirect") != canonical_vendor("Rockwell Automation")
        assert canonical_vendor("Siemens") != canonical_vendor("ABB")

    def test_unknown_vendor_is_none(self):
        # Fail-open: an unrecognized vendor name canonicalizes to None so callers
        # never treat it as a confident mismatch.
        assert canonical_vendor("Magnetek") is None
        assert canonical_vendor("") is None
        assert canonical_vendor(None) is None


class TestChunkMatchesVendor:
    def test_allen_bradley_chunk_kept_for_rockwell_query(self):
        # THE BUG: PowerFlex query → "Rockwell Automation"; chunk tagged the
        # Allen-Bradley brand. Same OEM — must be KEPT.
        assert chunk_matches_vendor("Allen-Bradley", "Rockwell Automation") is True

    def test_spacing_variant_kept(self):
        assert chunk_matches_vendor("Automation Direct", "AutomationDirect") is True
        assert chunk_matches_vendor("AutomationDirect", "AutomationDirect") is True

    def test_different_vendor_still_dropped(self):
        # A Yaskawa chunk on a Rockwell query is genuine contamination — DROP.
        assert chunk_matches_vendor("Yaskawa", "Rockwell Automation") is False
        assert chunk_matches_vendor("Siemens", "AutomationDirect") is False

    def test_untagged_chunk_always_kept(self):
        # Generic content (no manufacturer) is kept — fault tables, app notes.
        assert chunk_matches_vendor(None, "Rockwell Automation") is True
        assert chunk_matches_vendor("", "Rockwell Automation") is True

    def test_no_query_vendor_keeps_everything(self):
        # When the query didn't resolve a vendor, the filter doesn't run.
        assert chunk_matches_vendor("Yaskawa", None) is True

    def test_substring_behavior_preserved(self):
        # Additive: the old substring match still keeps what it always kept
        # (e.g. a richer corporate suffix on the same name).
        assert chunk_matches_vendor("Rockwell Automation Inc.", "Rockwell Automation") is True

    def test_unknown_chunk_vendor_dropped_like_before(self):
        # An unrecognized, non-substring manufacturer is still dropped — the fix
        # only rescues recognized same-vendor brands, it does not loosen to
        # keep arbitrary unknown vendors (preserves prior precision).
        assert chunk_matches_vendor("Magnetek", "Rockwell Automation") is False
