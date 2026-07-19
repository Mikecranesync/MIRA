"""Regression tests for tools/codegraph-freshness.sh.

Guards the two bugs fixed 2026-07-14 (docs/tech-debt/2026-07-14-codegraph-benchmark.md):
  1. False-STALE: the preflight freshness scan counted generated / dependency /
     nested-worktree files (`.next/`, `node_modules/`, `.audit-worktrees/`, …) as
     "source newer than the index", producing a STALE verdict on a current index.
  2. Real-source staleness must STILL be detected — a genuinely modified indexed
     `.py`/`.ts`/`.tsx` under a module dir is reported.
Plus: cg_write_sync_marker writes the canonical `.last-sync` format (so the daily
force-reindex updates the marker instead of leaving it stale).

Pure-bash helpers, exercised via `bash -c 'source lib; fn ...'` — no live index / npx.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
LIB = REPO_ROOT / "tools" / "codegraph-freshness.sh"

# Newer-than-db files that must be EXCLUDED (CodeGraph never indexes these).
EXCLUDED = [
    ".next/types/routes.d.ts",
    ".next/standalone/server.ts",
    "node_modules/pkg/index.ts",
    ".audit-worktrees/cmms/mira-bots/shared/citation_compliance.py",
    ".claude/worktrees/wt/mira-bots/shared/engine.py",
    ".worktrees/x/foo.py",
    "dist/bundle.py",
    "build/out.ts",
    "coverage/cov.ts",
    ".venv/lib/mod.py",
    "__pycache__/cached.py",
    ".ruff_cache/r.py",
    "graphify-out/g.py",
    ".cleanup-rollback-2026-06-09/old.py",
]
# Newer-than-db files that MUST be reported (genuinely modified indexed source).
INCLUDED = [
    "mira-bots/shared/engine.py",
    "mira-hub/src/lib/session.ts",
    "mira-relay/tag_ingest.py",
    "simlab/api.py",
]


def _run(fn_call: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", "-c", f'set -euo pipefail; . "{LIB}"; {fn_call}'],
        cwd=cwd, capture_output=True, text=True,
    )


def _build_tree(root: Path) -> Path:
    """Create db (backdated) + all EXCLUDED/INCLUDED files (newer)."""
    db = root / ".codegraph" / "codegraph.db"
    db.parent.mkdir(parents=True)
    db.write_text("x")
    for rel in EXCLUDED + INCLUDED:
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("y")
    # Backdate the db so every source file is strictly newer than it.
    old = 946684800  # 2000-01-01
    os.utime(db, (old, old))
    return db


def test_excludes_generated_and_worktree_paths(tmp_path: Path):
    db = _build_tree(tmp_path)
    res = _run(f'cg_newer_indexed_sources "{db}" .', tmp_path)
    assert res.returncode == 0, res.stderr
    out = res.stdout
    for rel in EXCLUDED:
        assert rel not in out, f"excluded path leaked into freshness scan: {rel}\n{out}"


def test_detects_real_modified_source(tmp_path: Path):
    db = _build_tree(tmp_path)
    res = _run(f'cg_newer_indexed_sources "{db}" .', tmp_path)
    assert res.returncode == 0, res.stderr
    out = res.stdout
    for rel in INCLUDED:
        assert rel in out, f"real modified source NOT detected: {rel}\n{out}"


def test_not_stale_when_only_generated_changed(tmp_path: Path):
    """The exact false-STALE bug: only .next/ + node_modules newer -> report empty."""
    db = tmp_path / ".codegraph" / "codegraph.db"
    db.parent.mkdir(parents=True)
    db.write_text("x")
    for rel in EXCLUDED:  # only excluded files are newer
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("y")
    old = 946684800
    os.utime(db, (old, old))
    res = _run(f'cg_newer_indexed_sources "{db}" .', tmp_path)
    assert res.returncode == 0, res.stderr
    assert res.stdout.strip() == "", f"false STALE — reported: {res.stdout!r}"


def test_missing_db_returns_error(tmp_path: Path):
    res = _run(f'cg_newer_indexed_sources "{tmp_path}/nope.db" .', tmp_path)
    assert res.returncode == 2


def test_write_sync_marker_format(tmp_path: Path):
    cgdir = tmp_path / ".codegraph"
    cgdir.mkdir()
    res = _run(f'cg_write_sync_marker "{cgdir}" force-reindex healthy "{tmp_path}"', tmp_path)
    assert res.returncode == 0, res.stderr
    marker = (cgdir / ".last-sync").read_text()
    assert "event=force-reindex" in marker
    assert "canary=healthy" in marker
    assert "npx=ok" in marker
    assert "index=present" in marker
    assert marker.startswith("ts=")
    assert "head=" in marker
