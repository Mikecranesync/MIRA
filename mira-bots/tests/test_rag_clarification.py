"""Regression tests for _build_clarification_request.

Covers:
- Brand-neutral examples in the no-asset template (gs3/pf40 keyword leak)
- Regression guard: vendor+fault combo returns None (2026-05-12)
- Asset-identified path does not emit the manufacturer/model examples
"""

from shared.workers.rag_worker import _build_clarification_request

# Brands that must NEVER appear in the template text — they trip forbidden-keyword
# checkpoints in eval scenarios where that brand is not the equipment under test.
FORBIDDEN_TEMPLATE_BRANDS = {"Rockwell", "PowerFlex", "Allen-Bradley"}


class TestBuildClarificationRequestBrandNeutral:
    def test_no_asset_template_has_no_forbidden_brands(self):
        """Clarification template for unknown equipment must not name competitor brands.

        Regression: lines 141/144 in rag_worker.py previously contained
        'Rockwell' and 'PowerFlex 40', which caused cp_keyword_match failures
        in gs3_ground_fault_14 (forbidden=['PowerFlex','Rockwell']).
        """
        result = _build_clarification_request("ground fault", "")
        assert result is not None, "Expected a clarification request for 'ground fault' with no asset"
        for brand in FORBIDDEN_TEMPLATE_BRANDS:
            assert brand not in result, (
                f"'{brand}' found in clarification template — will trip forbidden-keyword "
                f"checkpoints in eval scenarios where this brand is not the equipment under test"
            )

    def test_no_asset_template_has_neutral_manufacturer_examples(self):
        """Manufacturer example in the template must use neutral brands."""
        result = _build_clarification_request("showing fault code", "")
        assert result is not None
        assert "Manufacturer" in result
        # Check examples are present and brand-neutral
        assert "AutomationDirect" in result or "Yaskawa" in result or "Danfoss" in result

    def test_no_asset_template_has_neutral_model_example(self):
        """Model example must not include PowerFlex."""
        result = _build_clarification_request("alarm tripped", "")
        assert result is not None
        assert "Model number" in result
        assert "PowerFlex" not in result

    def test_asset_identified_path_omits_manufacturer_model_examples(self):
        """When asset is known, template only asks for fault code + activity."""
        result = _build_clarification_request("fault code showing", "AutomationDirect GS3")
        # The asset-identified path doesn't show manufacturer/model examples
        if result is not None:
            assert "Manufacturer" not in result
            assert "Model number" not in result
            assert "AutomationDirect GS3" in result

    def test_vendor_plus_fault_returns_none(self):
        """Regression guard (2026-05-12): known vendor + fault code → None, not clarification."""
        # These should return None because vendor+fault combo is already identified
        assert _build_clarification_request("PowerFlex 525 F004", "") is None
        assert _build_clarification_request("GS10 overcurrent fault", "") is None

    def test_non_fault_message_returns_none(self):
        """Messages without fault signals should not trigger the clarification template."""
        result = _build_clarification_request("how do I set the speed", "")
        assert result is None, "Generic config question should not trigger clarification request"
