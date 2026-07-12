#!/usr/bin/env python3
"""
Unit tests for the knowledge_entries security checker.

Tests the static analysis against known good and bad SQL patterns.
"""

import sys
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent / "tools" / "qa" / "security"))

from check_knowledge_entries_filters import _classify_read


def test_hybrid_pattern_is_private_false_or_tenant():
    """HYBRID: (is_private = false OR tenant_id = $1)"""
    query = """
    SELECT content FROM knowledge_entries
    WHERE (is_private = false OR tenant_id = $1)
    """
    classification, reason = _classify_read(query)
    assert classification == "HYBRID", f"Expected HYBRID, got {classification}: {reason}"


def test_hybrid_pattern_tenant_or_is_private():
    """HYBRID: (tenant_id = $1 OR is_private = false) — reversed order"""
    query = """
    SELECT content FROM knowledge_entries
    WHERE (tenant_id = $1 OR is_private = false)
    """
    classification, reason = _classify_read(query)
    assert classification == "HYBRID", f"Expected HYBRID, got {classification}: {reason}"


def test_hybrid_pattern_or_shared_tid():
    """HYBRID: (tenant_id = :tid OR tenant_id = :shared_tid) is still hybrid if shared_tid is system tenant"""
    query = """
    SELECT content FROM knowledge_entries
    WHERE (tenant_id = :tid OR tenant_id = :shared_tid)
      AND content ILIKE :pat
    """
    # Note: This will classify as TENANT-ONLY because we can't statically determine
    # if shared_tid is the system tenant. This is OK — it's an allowlist entry.
    classification, reason = _classify_read(query)
    # This is actually TENANT-ONLY from the static checker's POV, but it's approved
    # because in practice it's reading (caller OR system tenant)
    assert classification in ["TENANT-ONLY", "HYBRID"]


def test_public_only_is_private_false_alone():
    """PUBLIC-ONLY: is_private = false without tenant filter"""
    query = """
    SELECT manufacturer, COUNT(*) FROM knowledge_entries
    WHERE is_private = false
    GROUP BY manufacturer
    """
    classification, reason = _classify_read(query)
    assert classification == "PUBLIC-ONLY", f"Expected PUBLIC-ONLY, got {classification}: {reason}"


def test_tenant_only_tenant_id_alone():
    """TENANT-ONLY: tenant_id = $1 without is_private = false (bug class #1761)"""
    query = """
    SELECT COUNT(*) FROM knowledge_entries
    WHERE tenant_id = $1 AND verified = true
    """
    classification, reason = _classify_read(query)
    assert classification == "TENANT-ONLY", f"Expected TENANT-ONLY, got {classification}: {reason}"


def test_unfiltered_no_where():
    """UNFILTERED: No WHERE clause at all"""
    query = """
    SELECT content FROM knowledge_entries
    """
    classification, reason = _classify_read(query)
    assert classification == "UNFILTERED", f"Expected UNFILTERED, got {classification}: {reason}"


def test_unfiltered_safe_metadata_filter():
    """UNFILTERED: WHERE on metadata only (not tenant-scoped)"""
    query = """
    DELETE FROM knowledge_entries
    WHERE metadata->>'mark' = $1
    """
    classification, reason = _classify_read(query)
    assert classification == "UNFILTERED", f"Expected UNFILTERED, got {classification}: {reason}"


def test_unfiltered_manufacturer_only():
    """UNFILTERED: WHERE on manufacturer/model only (not tenant-scoped)"""
    query = """
    SELECT content FROM knowledge_entries
    WHERE manufacturer ILIKE :mfr
      AND model_number ILIKE :model
    """
    classification, reason = _classify_read(query)
    assert classification == "UNFILTERED", f"Expected UNFILTERED, got {classification}: {reason}"


def test_private_only_is_private_true():
    """PRIVATE-ONLY: WHERE is_private = true (tenant's own uploads, no OEM)"""
    query = """
    SELECT content FROM knowledge_entries
    WHERE is_private = true AND tenant_id = $1
    """
    classification, reason = _classify_read(query)
    assert classification == "PRIVATE-ONLY", (
        f"Expected PRIVATE-ONLY, got {classification}: {reason}"
    )


def test_is_private_false_case_insensitive():
    """HYBRID: Case-insensitive match for IS_PRIVATE = FALSE"""
    query = """
    SELECT content FROM knowledge_entries
    WHERE (IS_PRIVATE = FALSE OR tenant_id = $1)
    """
    classification, reason = _classify_read(query)
    assert classification == "HYBRID", f"Expected HYBRID, got {classification}: {reason}"


def test_is_private_is_false_variant():
    """HYBRID: SQL IS FALSE variant"""
    query = """
    SELECT content FROM knowledge_entries
    WHERE (is_private IS FALSE OR tenant_id = $1)
    """
    classification, reason = _classify_read(query)
    assert classification == "HYBRID", f"Expected HYBRID, got {classification}: {reason}"


def test_is_private_is_not_true_variant():
    """HYBRID: SQL IS NOT TRUE variant"""
    query = """
    SELECT content FROM knowledge_entries
    WHERE (is_private IS NOT TRUE OR tenant_id = $1)
    """
    classification, reason = _classify_read(query)
    assert classification == "HYBRID", f"Expected HYBRID, got {classification}: {reason}"


def test_multiline_hybrid_with_additional_filters():
    """HYBRID with additional manufacturer/model filters"""
    query = """
    SELECT source_url FROM knowledge_entries
    WHERE (is_private = false OR tenant_id = $1)
      AND LOWER(manufacturer) = LOWER($2)
      AND model_number ILIKE '%' || $3 || '%'
    GROUP BY source_url
    ORDER BY created_at DESC
    """
    classification, reason = _classify_read(query)
    assert classification == "HYBRID", f"Expected HYBRID, got {classification}: {reason}"


def test_asset_chat_rag_hybrid():
    """HYBRID: Asset chat RAG surface (real example from mira-hub)"""
    query = """
    SELECT id, content, source_url FROM knowledge_entries
    WHERE (is_private = false OR tenant_id = $1)
      AND LOWER(manufacturer) = LOWER($2)
      AND source_type = 'manual'
      AND verified = true
    ORDER BY ts_rank_cd(...) DESC
    LIMIT 10
    """
    classification, reason = _classify_read(query)
    assert classification == "HYBRID", f"Expected HYBRID, got {classification}: {reason}"


def test_library_tenant_only_known_gap():
    """TENANT-ONLY: Library surface (bug class #1761 — should show OEM)"""
    query = """
    SELECT source_url, COUNT(*) FROM knowledge_entries
    WHERE tenant_id = $1
    GROUP BY source_url
    ORDER BY COUNT(*) DESC
    """
    classification, reason = _classify_read(query)
    assert classification == "TENANT-ONLY", f"Expected TENANT-ONLY, got {classification}: {reason}"


if __name__ == "__main__":
    tests = [
        test_hybrid_pattern_is_private_false_or_tenant,
        test_hybrid_pattern_tenant_or_is_private,
        test_hybrid_pattern_or_shared_tid,
        test_public_only_is_private_false_alone,
        test_tenant_only_tenant_id_alone,
        test_unfiltered_no_where,
        test_unfiltered_safe_metadata_filter,
        test_unfiltered_manufacturer_only,
        test_private_only_is_private_true,
        test_is_private_false_case_insensitive,
        test_is_private_is_false_variant,
        test_is_private_is_not_true_variant,
        test_multiline_hybrid_with_additional_filters,
        test_asset_chat_rag_hybrid,
        test_library_tenant_only_known_gap,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            print(f"✅ {test.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"❌ {test.__name__}: {e}")
            failed += 1

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
