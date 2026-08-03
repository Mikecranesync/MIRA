"""Regression tests for the knowledge_entries allowlist snippet matcher (#3053).

The allowlist key is `file:line`, which slides onto a neighbour when lines are
inserted/deleted above a read. `_snippet_matches` is the content check that keeps
an approval from being accepted for a DIFFERENT query at the same line. Before
#3053 it compared only the first non-empty line, so two reads that both start
`FROM knowledge_entries` and share a classification matched each other. These
tests pin the multi-line behaviour.

Run: pytest tools/qa/security/test_snippet_match.py
"""

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "_ke_checker", Path(__file__).with_name("check_knowledge_entries_filters.py")
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

_snippet_matches = _mod._snippet_matches
_norm_lines = _mod._norm_lines


# The #3053 scenario: same first line + same classification, different WHERE.
APPROVED_TENANT = (
    "FROM knowledge_entries\n"
    "        WHERE tenant_id = $1\n"
    "          AND asset_id = $2"
)
NEIGHBOUR_PRIVATE = (
    "FROM knowledge_entries\n"
    "        WHERE is_private = false\n"
    "          AND manufacturer ILIKE $1"
)


def test_shared_first_line_different_where_does_not_match():
    """Two reads sharing `FROM knowledge_entries` but differing on WHERE must NOT match."""
    assert _snippet_matches(APPROVED_TENANT, NEIGHBOUR_PRIVATE) is False


def test_identical_query_matches():
    assert _snippet_matches(APPROVED_TENANT, APPROVED_TENANT) is True


def test_yaml_block_indentation_is_not_a_difference():
    """A stored snippet re-indented by YAML block-scalar loading still matches."""
    reindented = "FROM knowledge_entries\n  WHERE tenant_id = $1\n  AND asset_id = $2"
    assert _snippet_matches(APPROVED_TENANT, reindented) is True


def test_adaptive_length_shorter_stored_snippet_still_matches():
    """A historically-stored 1-line snippet matches the found query's leading line.

    The generator used to store only the first 3 lines; the matcher compares as
    many leading lines of the found context as the stored snippet has, so old
    short entries keep matching without a data migration.
    """
    one_line = "FROM knowledge_entries"
    assert _snippet_matches(one_line, APPROVED_TENANT) is True
    # ...but a shorter stored snippet whose one line differs must still fail.
    assert _snippet_matches("FROM kg_entities", APPROVED_TENANT) is False


def test_missing_snippet_is_accepted_ratchet():
    """No stored snippet (pre-check or hand-added) is accepted — the ratchet."""
    assert _snippet_matches(None, APPROVED_TENANT) is True
    assert _snippet_matches("", APPROVED_TENANT) is True


def test_first_line_only_would_have_missed_this():
    """Guard the fix itself: first-line comparison would have WRONGLY matched."""
    a_first = _norm_lines(APPROVED_TENANT)[0]
    n_first = _norm_lines(NEIGHBOUR_PRIVATE)[0]
    assert a_first == n_first  # both are `FROM knowledge_entries`
    assert _snippet_matches(APPROVED_TENANT, NEIGHBOUR_PRIVATE) is False
