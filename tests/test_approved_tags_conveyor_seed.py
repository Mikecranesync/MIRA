"""Drift guard for tools/seeds/approved_tags_conveyor.sql (the CV-101 / Home
Garage Conveyor allowlist seed).

mira-relay's ``POST /api/v1/tags/ingest`` (mira-relay/tag_ingest.py::ingest_batch)
enforces the ``approved_tags`` allowlist FAIL-CLOSED, matching on
``normalized_tag_path`` produced by ``mira-relay/ingest_contract.normalize_tag_path``.
If this seed's ``normalized_tag_path`` column ever drifts from what the real
normalizer produces for the same ``source_tag_path``, every CV-101 tag
silently bounces (``rejected: not_allowlisted``) the next time the seed is
(re)applied — see docs/runbooks/cv101-bench-to-cloud-first-tag-row.md
Troubleshooting table.

This test parses the committed seed file directly (no DB, no network) and
pins two invariants, mirroring the parsing approach of
tests/simlab/test_approved_tags_seed.py and
tests/test_northwind_cv200_seed_and_config.py (which guard the SimLab and
Northwind CV-200 seeds the same way):

  1. normalized_tag_path == normalize_tag_path(source_tag_path) for every row.
  2. every row is bound to the CV-101 UNS subtree
     (enterprise.home_garage.conveyor_lab.conveyor_1).
"""

from __future__ import annotations

import os
import re
import sys

_REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
_SEED_PATH = os.path.join(_REPO_ROOT, "tools", "seeds", "approved_tags_conveyor.sql")
_CV101_UNS = "enterprise.home_garage.conveyor_lab.conveyor_1"

# Match one VALUES row: source_tag_path, normalized_tag_path, uns_path.
_ROW_RE = re.compile(r"'ignition',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'::ltree")


def _read_seed() -> str:
    with open(_SEED_PATH, encoding="utf-8") as fh:
        return fh.read()


def _rows() -> list[tuple[str, str, str]]:
    return _ROW_RE.findall(_read_seed())


def _real_normalize():
    """Import the relay's real normalize_tag_path (same sys.path-insert/remove
    pattern as tests/test_northwind_cv200_seed_and_config.py::_real_normalize
    and tests/simlab/test_approved_tags_seed.py::_real_normalize)."""
    relay_dir = os.path.join(_REPO_ROOT, "mira-relay")
    sys.path.insert(0, relay_dir)
    try:
        import ingest_contract  # mira-relay/ingest_contract.py
    finally:
        sys.path.remove(relay_dir)
    return ingest_contract.normalize_tag_path


def test_seed_file_exists_and_has_rows():
    assert os.path.exists(_SEED_PATH)
    rows = _rows()
    assert len(rows) >= 50, f"expected the full CV-101 tag set, got {len(rows)} rows"


def test_normalized_tag_path_matches_the_real_normalizer():
    real = _real_normalize()
    rows = _rows()
    assert rows
    for src, norm, _uns in rows:
        assert real(src) == norm, (
            f"normalized_tag_path drift for {src!r}: seed={norm!r} relay={real(src)!r}"
        )


def test_every_row_is_bound_to_the_cv101_uns_subtree():
    rows = _rows()
    assert rows
    for src, _norm, uns in rows:
        assert uns == _CV101_UNS, f"row {src!r} not bound to the CV-101 subtree: {uns}"


def test_seed_shape():
    sql = _read_seed()
    assert sql.lstrip().startswith("BEGIN;")
    assert sql.rstrip().endswith("COMMIT;")
    assert "'ignition'" in sql
    assert "__TENANT_ID__" in sql, "should use the apply-seeds tenant placeholder"
    assert "ON CONFLICT (tenant_id, source_system, source_tag_path) DO UPDATE" in sql
