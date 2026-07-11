"""Offline contract test for kb_has_pair_coverage's SQL (no NeonDB).

The pair-coverage probe must stay in parity with kb_has_coverage (#1308): NO
`embedding IS NOT NULL` filter. A freshly-seeded (vendor, model) pair whose
embeddings aren't backfilled yet is still KB coverage (reachable via BM25); the
filter made the resolver drop the model (UNS_PAIR_DROPPED) for a product the KB
does cover. Regression guard for the 2026-06-21 retrieval-grounding audit.
"""

from shared.neon_recall import _KB_PAIR_COVERAGE_SQL


def test_pair_coverage_sql_has_no_embedding_filter():
    assert "embedding is not null" not in _KB_PAIR_COVERAGE_SQL.lower()
    assert "embedding" not in _KB_PAIR_COVERAGE_SQL.lower()


def test_pair_coverage_sql_is_still_pair_scoped():
    sql = _KB_PAIR_COVERAGE_SQL.lower()
    assert "manufacturer" in sql
    assert "model_number" in sql
    assert ":vendor_pat" in sql
    assert ":model_pat" in sql


def test_pair_coverage_sql_keeps_tenant_predicate():
    sql = _KB_PAIR_COVERAGE_SQL.lower()
    assert ":tid" in sql and ":shared_tid" in sql
