"""SimLab `simulator` allowlist seed generator (Gap C, Lane 2).

The relay ingest endpoint is FAIL-CLOSED: a tag whose normalized path is not in
`approved_tags` for (tenant, source_system='simulator') is rejected. So two
things MUST hold for SimLab data to land:

  1. The generator's normalizer must EXACTLY equal the relay's
     `mira-relay/tag_ingest.normalize_tag_path` — a mismatch means the seeded
     `normalized_tag_path` never matches incoming traffic and every tag bounces.
  2. The committed seed file must be in sync with the current SimLab snapshot —
     a stale seed silently drops the tags added since it was generated.

This test pins both.
"""
from __future__ import annotations

import importlib.util
import os
import sys

from simlab import SIMLAB_TENANT_ID
from simlab.engine import SimEngine
from simlab.lines.juice_bottling import build_line

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))


def _load_generator():
    path = os.path.join(_REPO_ROOT, "tools", "seeds", "gen_approved_tags_simulator.py")
    spec = importlib.util.spec_from_file_location("gen_approved_tags_simulator", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def _real_normalize():
    relay_dir = os.path.join(_REPO_ROOT, "mira-relay")
    sys.path.insert(0, relay_dir)
    try:
        import tag_ingest  # mira-relay/tag_ingest.py
    finally:
        sys.path.remove(relay_dir)
    return tag_ingest.normalize_tag_path


def test_generator_normalizer_matches_the_real_relay_function():
    gen = _load_generator()
    real = _real_normalize()
    readings = SimEngine(build_line()).snapshot()
    assert readings, "snapshot should not be empty"
    for r in readings:
        assert gen.normalize_tag_path(r.uns_path) == real(r.uns_path), r.uns_path


def test_committed_seed_is_in_sync_with_the_snapshot():
    gen = _load_generator()
    expected = gen.build_sql()
    with open(gen._OUT, encoding="utf-8") as fh:
        committed = fh.read()
    assert committed == expected, (
        "tools/seeds/approved_tags_simulator.sql is stale — "
        "re-run `python tools/seeds/gen_approved_tags_simulator.py`"
    )


def test_seed_shape():
    gen = _load_generator()
    sql = gen.build_sql()
    n_tags = len(SimEngine(build_line()).snapshot())
    assert sql.startswith("BEGIN;")
    assert sql.rstrip().endswith("COMMIT;")
    assert "source_system" in sql
    assert sql.count("'simulator'") == n_tags + 1  # one per row + the comment line
    assert SIMLAB_TENANT_ID in sql
    assert "ON CONFLICT (tenant_id, source_system, source_tag_path) DO UPDATE" in sql
