"""Tests for the kg-write-guard CI check (#1722)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import kg_write_guard as g  # noqa: E402


def test_repo_is_clean_against_committed_allowlist():
    """Every direct kg_relationships insert in the tree is allowlisted."""
    violations = g.find_violations()
    assert violations == [], (
        "Unguarded kg_relationships inserts found — propose instead, or "
        f"allowlist with a reason: {violations}"
    )


def test_detects_new_unguarded_insert(tmp_path):
    (tmp_path / "rogue_worker.ts").write_text(
        "await client.query(`INSERT INTO kg_relationships (a) VALUES (1)`);\n"
    )
    violations = g.find_violations(root=tmp_path, allowlist=set())
    assert "rogue_worker.ts" in violations


def test_allowlisted_file_is_not_flagged(tmp_path):
    (tmp_path / "ok.ts").write_text("INSERT INTO kg_relationships ...\n")
    assert g.find_violations(root=tmp_path, allowlist={"ok.ts"}) == []


def test_match_is_case_and_whitespace_insensitive(tmp_path):
    (tmp_path / "x.py").write_text("cur.execute('Insert    INTO     kg_relationships ...')\n")
    assert "x.py" in g.find_violations(root=tmp_path, allowlist=set())


def test_skips_node_modules_and_non_source(tmp_path):
    nm = tmp_path / "node_modules" / "pkg"
    nm.mkdir(parents=True)
    (nm / "index.ts").write_text("INSERT INTO kg_relationships ...\n")
    (tmp_path / "notes.md").write_text("INSERT INTO kg_relationships ...\n")
    assert g.find_insert_sites(root=tmp_path) == []
