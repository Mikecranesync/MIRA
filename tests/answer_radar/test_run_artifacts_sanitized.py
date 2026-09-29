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


def _row(source_doc: str) -> dict:
    return {
        "question": {
            "question_id": "S1",
            "normalized_question": "q",
            "manufacturer": "",
            "model": "",
        },
        "evaluation": {"answer_text": "a", "citations": [], "source_documents": [source_doc]},
        "hub": {"condition": "new_chat", "retrieval": {}},
    }


def test_a_fresh_ungraded_batch_is_sanitized(tmp_path: Path):
    """#4100 F3: before grading, an identity-bound UUID is simply pseudonymized."""
    batch = tmp_path / "batch.json"
    batch.write_text(json.dumps([_row(TENANT)]))
    assert sanitize.sanitize_paths([tmp_path], {}) == [batch]
    assert sanitize.raw_ids(sanitize.load(batch)) == []


def test_a_rewrite_that_would_orphan_an_existing_grade_is_refused(tmp_path: Path):
    """#4100 F1: once a grade binds the raw-id identity, rewriting it is refused
    and nothing in the run is touched."""
    from answer_radar.score import answer_identity

    row = _row(TENANT)
    batch = tmp_path / "batch.json"
    batch.write_text(json.dumps([row]))
    grades = tmp_path / "grades"
    grades.mkdir()
    (grades / "grade-A-S1.json").write_text(json.dumps({"answer_sha256": answer_identity(row)}))
    other = tmp_path / "notes.jsonl"
    other.write_text(json.dumps({"trace_id": TRACE}) + "\n")
    before = (batch.read_text(), other.read_text())
    with pytest.raises(SystemExit, match="already has grades"):
        sanitize.sanitize_paths([tmp_path], {})
    assert (batch.read_text(), other.read_text()) == before


def test_a_grader_packet_binding_the_old_identity_also_refuses(tmp_path: Path):
    from answer_radar.score import answer_identity

    row = _row(TENANT)
    (tmp_path / "batch.json").write_text(json.dumps([row]))
    (tmp_path / "packet.json").write_text(
        json.dumps({"S1__new_chat": {"answer_sha256": answer_identity(row)}})
    )
    with pytest.raises(SystemExit, match="already has grades"):
        sanitize.sanitize_paths([tmp_path], {})


def test_ids_outside_the_identity_are_still_sanitized(tmp_path: Path):
    """Control: a trace id in a batch row's notes does not affect its identity."""
    row = _row("doc-without-id")
    row["evaluation"]["notes"] = f"trace={TRACE}"
    batch = tmp_path / "batch.json"
    batch.write_text(json.dumps([row]))
    assert sanitize.sanitize_paths([tmp_path], {}) == [batch]
    assert sanitize.raw_ids(sanitize.load(batch)) == []


def test_a_grade_bound_with_reference_notes_still_refuses(tmp_path: Path):
    """#4100 F4: a packet built with reference notes binds a hash the batch row alone
    does not reproduce. Any existing grade in the run refuses, whatever its hash."""
    batch = tmp_path / "batch.json"
    batch.write_text(json.dumps([_row(TENANT)]))
    grades = tmp_path / "grades"
    grades.mkdir()
    (grades / "grade-A-S1.json").write_text(json.dumps({"answer_sha256": "f" * 64}))
    before = batch.read_bytes()
    with pytest.raises(SystemExit, match="already has grades"):
        sanitize.sanitize_paths([tmp_path], {})
    assert batch.read_bytes() == before


@pytest.mark.parametrize("as_dir", [False, True])
def test_a_standalone_packet_carrying_a_raw_id_is_never_rewritten(tmp_path: Path, as_dir: bool):
    """#4100 F5: rewriting a packet would keep its answer_sha256 while changing the
    evidence a grader sees. Refused whether the file or its directory is given."""
    export = tmp_path / "export"
    export.mkdir()
    packet = export / "packet.json"
    packet.write_text(
        json.dumps({"S1__new_chat": {"answer_sha256": "a" * 64, "source_documents": [TENANT]}})
    )
    before = packet.read_bytes()
    with pytest.raises(SystemExit, match="rebuild it from a sanitized batch"):
        sanitize.sanitize_paths([export if as_dir else packet], {})
    assert packet.read_bytes() == before
