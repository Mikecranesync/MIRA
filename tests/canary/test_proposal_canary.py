"""Pure unit tests for the ADR-0017 canary runner (#1723) — no DB."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from run_proposal_canary import SQL_PATH, parse_checks  # noqa: E402

EXPECTED = [
    "accepted_suggestion_pairs_unverified_proposal",
    "verified_edge_links_unverified_proposal",
]


def test_parses_every_check_block():
    checks = parse_checks(SQL_PATH.read_text())
    assert [name for name, _ in checks] == EXPECTED


def test_each_query_is_a_clean_select():
    for name, query in parse_checks(SQL_PATH.read_text()):
        upper = query.upper()
        assert upper.startswith("SELECT"), name
        assert "FROM" in upper, name
        # comment lines stripped, no trailing semicolon
        assert not any(ln.strip().startswith("--") for ln in query.splitlines()), name
        assert not query.rstrip().endswith(";"), name


def test_parse_checks_handles_no_blocks():
    assert parse_checks("-- just a comment, no @check markers\n") == []


if __name__ == "__main__":
    # Runnable without pytest (the canary workflow has no pytest/conftest deps).
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} checks passed")
