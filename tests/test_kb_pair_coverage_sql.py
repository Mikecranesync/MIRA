"""Offline contract test for kb_has_pair_coverage's SQL (no NeonDB).

The pair-coverage probe must stay in parity with kb_has_coverage: NO
``embedding IS NOT NULL`` filter. A freshly-seeded (vendor, model) pair whose
embeddings aren't backfilled yet is still KB coverage (reachable via BM25);
the filter made the resolver judge the pair chimeric and drop the model
(UNS_PAIR_DROPPED) for a product the KB does cover lexically — the
NULL-embedding bug class from #2085. Regression guard for #2213.
"""

from shared.neon_recall import _KB_PAIR_COVERAGE_SQL_TEMPLATE


def test_pair_coverage_sql_has_no_embedding_filter():
    assert "embedding" not in _KB_PAIR_COVERAGE_SQL_TEMPLATE.lower(), (
        "kb_has_pair_coverage must not filter on embedding presence — parity "
        "with kb_has_coverage; BM25-only rows are still coverage (#2213)"
    )


def test_pair_coverage_sql_keeps_the_pair_predicates():
    sql = _KB_PAIR_COVERAGE_SQL_TEMPLATE
    assert "{tenant_filter}" in sql
    assert "LOWER(manufacturer) LIKE LOWER(:vendor_pat)" in sql
    assert "LOWER(model_number) LIKE LOWER(:model_pat)" in sql
    assert "COUNT(*)" in sql
