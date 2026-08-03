#!/usr/bin/env python3
"""
Unit tests for the knowledge_entries security checker.

Tests the static analysis against known good and bad SQL patterns.
"""

import sys
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent / "tools" / "qa" / "security"))

from check_knowledge_entries_filters import _classify_read, check_reads, context_sha256


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


# ── allowlist key integrity (#3053) ───────────────────────────────────────────
#
# The allowlist key is `file:line`, which is NOT stable under edits. Inserting or
# deleting lines above a read slides it onto a NEIGHBOUR's approved line; when the
# classifications match, nothing else in the checker notices and the read runs
# under a review written for a different query.
#
# The security discriminator is `query_sha256` — a hash of the read's FULL
# normalized context, salted with its source path. `query_snippet` is retained in
# the allowlist as human-readable EVIDENCE ONLY and is never compared. This closes
# the collision the earlier first-line/short-prefix comparison left open: many real
# entries begin `FROM knowledge_entries`, and a neighbour that shared only that
# first line was silently accepted.


def _read(line_num, sql, classification="TENANT-ONLY", file="svc.py"):
    return {
        "file": file,
        "line_num": line_num,
        "query": sql,
        "classification": classification,
        "reason": "test",
    }


def _entry(sql, classification="TENANT-ONLY", file="svc.py"):
    """An approved entry carrying the real discriminator (query_sha256) the way the
    template/backfill produce it; query_snippet is evidence only."""
    return {
        "approved_classification": classification,
        "reason": "reviewed",
        "query_snippet": sql,
        "query_sha256": context_sha256(file, sql),
    }


SQL_A = 'cur.execute("SELECT title FROM knowledge_entries WHERE tenant_id = %s")'
SQL_B = 'cur.execute("SELECT source_url FROM knowledge_entries WHERE tenant_id = %s")'

# The #3053 reproducer: two reads that share their FIRST line but differ in the
# WHERE below — exactly the shape the first-line matcher could not tell apart.
SHARED_FIRST_LINE_A = "FROM knowledge_entries\n        WHERE tenant_id = $1\n          AND asset_id = $2"
SHARED_FIRST_LINE_B = (
    "FROM knowledge_entries\n        WHERE is_private = false\n          AND manufacturer ILIKE $1"
)


def test_matching_query_is_clean():
    errors, code = check_reads([_read(4, SQL_A)], {"approved": {"svc.py:4": _entry(SQL_A)}})
    assert code == 0, errors
    assert errors == [], errors


def test_a_shifted_read_cannot_inherit_a_neighbours_approval():
    """The defect: read B slides onto read A's approved line. Same classification,
    so the pre-existing checks stay silent — the hash discriminator must be loud."""
    errors, code = check_reads([_read(4, SQL_B)], {"approved": {"svc.py:4": _entry(SQL_A)}})
    assert code == 1, "a misattributed approval must fail the build"
    assert any("DIFFERENT query" in e for e in errors), errors


def test_shared_first_line_different_where_fails_closed():
    """#3053: two reads sharing `FROM knowledge_entries` as their first line but
    differing on the WHERE below, SAME classification. The first-line/short-prefix
    matcher approved the neighbour; the full-context hash must fail closed."""
    errors, code = check_reads(
        [_read(9, SHARED_FIRST_LINE_B)],
        {"approved": {"svc.py:9": _entry(SHARED_FIRST_LINE_A)}},
    )
    assert code == 1, "a neighbour sharing only the first line must NOT inherit the approval"
    assert any("DIFFERENT query" in e for e in errors), errors


def test_one_line_from_knowledge_entries_prefix_does_not_match_longer_query():
    """A 1-line approved context (`FROM knowledge_entries`) must NOT cover a longer
    read that merely starts with it — the exact short-prefix hole in #3084 rev 1."""
    one_line = "FROM knowledge_entries"
    errors, code = check_reads(
        [_read(4, SHARED_FIRST_LINE_A)],
        {"approved": {"svc.py:4": _entry(one_line)}},
    )
    assert code == 1, errors
    assert any("DIFFERENT query" in e for e in errors), errors


def test_yaml_block_indentation_is_not_a_difference():
    """The snippet round-trips through a YAML `|` block, so the read's context can
    carry different indentation. Whitespace-normalized hashing must ignore that."""
    reindented = SQL_A.replace("WHERE", "\n        WHERE")
    assert context_sha256("svc.py", SQL_A) == context_sha256("svc.py", "      " + SQL_A)
    errors, code = check_reads([_read(4, reindented)], {"approved": {"svc.py:4": _entry(reindented)}})
    assert code == 0, errors


def test_source_identity_prevents_cross_file_collision():
    """Two identical short contexts in DIFFERENT files must not share a hash, so an
    approval for one file can never transfer to another."""
    assert context_sha256("a.py", SQL_A) != context_sha256("b.py", SQL_A)


def test_an_entry_without_a_hash_is_still_accepted():
    """A ratchet, not a flag day: an entry with no query_sha256 (hand-added, or
    predating the field) cannot be verified and must not fail the ~135 live entries
    — all of which are backfilled by --backfill-hashes."""
    entry = {"approved_classification": "TENANT-ONLY", "reason": "reviewed"}
    errors, code = check_reads([_read(4, SQL_A)], {"approved": {"svc.py:4": entry}})
    assert code == 0, errors


def test_query_snippet_is_evidence_only_not_the_discriminator():
    """If query_snippet were the gate, a matching snippet + WRONG hash would pass.
    The hash must win: matching evidence cannot rescue a mismatched discriminator."""
    entry = _entry(SQL_A)
    entry["query_snippet"] = SQL_B  # evidence deliberately disagrees with the hash
    # read is SQL_A → hash matches → clean, regardless of the (wrong) snippet text
    errors, code = check_reads([_read(4, SQL_A)], {"approved": {"svc.py:4": entry}})
    assert code == 0, errors
    # read is SQL_B → snippet "matches" but hash does not → must fail
    errors, code = check_reads([_read(4, SQL_B)], {"approved": {"svc.py:4": entry}})
    assert code == 1, errors


def test_classification_mismatch_still_wins():
    """The stronger, pre-existing signal must not be masked by the new one."""
    errors, _ = check_reads(
        [_read(4, SQL_B, "UNFILTERED")], {"approved": {"svc.py:4": _entry(SQL_A)}}
    )
    assert any("Classification mismatch" in e for e in errors), errors


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
        test_matching_query_is_clean,
        test_a_shifted_read_cannot_inherit_a_neighbours_approval,
        test_shared_first_line_different_where_fails_closed,
        test_one_line_from_knowledge_entries_prefix_does_not_match_longer_query,
        test_yaml_block_indentation_is_not_a_difference,
        test_source_identity_prevents_cross_file_collision,
        test_an_entry_without_a_hash_is_still_accepted,
        test_query_snippet_is_evidence_only_not_the_discriminator,
        test_classification_mismatch_still_wins,
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
