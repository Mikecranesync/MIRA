"""Committed Answer Radar run artifacts carry no raw staging identifiers (#4100).

The guard walks every committed JSON/JSONL artifact under answer_radar/runs/ and fails
on any UUID or 32-hex id. Fix a failure with `python -m answer_radar.sanitize <dir>`.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from answer_radar import sanitize

ROOT = Path(__file__).resolve().parents[2] / "answer_radar" / "runs"
TENANT = "eb2f1891-54b8-4ed6-bd6e-aca005851a97"
TRACE = "b2b0c0dd3b18b48631aa15706dde74ce"
SHA256 = "a" * 64
GIT_SHA = "ae03a3877912c7c1242e18fdd84e0dea39df15ab"


def test_committed_run_artifacts_have_no_raw_ids():
    files = sanitize.artifact_files(ROOT)
    assert files, "no run artifacts found: the guard would pass vacuously"
    leaks = {
        str(f.relative_to(ROOT)): ids for f in files if (ids := sanitize.raw_ids(sanitize.load(f)))
    }
    assert not leaks, f"raw staging ids committed; run python -m answer_radar.sanitize: {leaks}"


def test_scrub_replaces_ids_and_keeps_hashes_and_shas():
    row = {
        "ids": {"tenant_id": TENANT, "trace_id": TRACE},
        "notes": f"condition=new_chat trace={TRACE}",
        "answer_sha256": SHA256,
        "git_sha": GIT_SHA,
    }
    seen: dict[str, str] = {}
    out = sanitize.scrub(row, seen)
    assert sanitize.raw_ids(out) == []
    assert out["ids"]["trace_id"] == out["notes"].split("trace=")[1]  # joins survive
    assert (out["answer_sha256"], out["git_sha"]) == (SHA256, GIT_SHA)
    assert seen == {TENANT: sanitize.pseudonym(TENANT), TRACE: sanitize.pseudonym(TRACE)}
    assert sanitize.scrub(out, {}) == out  # idempotent


@pytest.mark.parametrize("suffix", [".json", ".jsonl"])
def test_the_guard_catches_a_raw_id(tmp_path: Path, suffix: str):
    """Negative control: the check the first test relies on does fire."""
    f = tmp_path / f"a{suffix}"
    row = {"diagnostics": {"packet": {"ids": {"owner_user_id": TENANT}}}}
    f.write_text(json.dumps(row) + "\n" if suffix == ".jsonl" else json.dumps(row))
    assert sanitize.raw_ids(sanitize.load(f)) == [TENANT]
    sanitize.sanitize_paths([tmp_path], {})
    assert sanitize.raw_ids(sanitize.load(f)) == []
