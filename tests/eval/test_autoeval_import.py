"""Hermetic proofs for the autoeval importer. Pure: no network, no key, no ledger.

Every reject has an accept control built from the same record, so a rule that rejects
everything cannot pass. Required-field cases remove exactly one field from a complete record.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

REPO = Path(os.environ.get("AUTOEVAL_REPO") or Path(__file__).resolve().parents[2])
SCRIPTS = Path(os.environ.get("AUTOEVAL_SCRIPTS") or REPO / "evals" / "scripts")
sys.path.insert(0, str(SCRIPTS))

import autoeval_import as ai  # noqa: E402

SHA = "f06922ac6"
URL = "https://app.factorylm.com"
TURN_FIELDS = ("turn", "question", "answer", "citations", "status")
TOP_FIELDS = ("case_id", "case_type", "case", "turns", "error")


def record(case_id: str = "tech-01", **over) -> dict:
    """A complete generated record in the recorded-transcript shape."""
    rec = {
        "case_id": case_id,
        "case_type": "technician",
        "case": {
            "id": case_id,
            "category": "general_industrial",
            "mode": "general",
            "question": "What does an AC drive do?",
        },
        "turns": [
            {
                "turn": 0,
                "question": "What does an AC drive do?",
                "answer": "It varies motor speed by varying frequency.",
                "citations": [],
                "status": "answered",
                "error": None,
            }
        ],
        "error": None,
        "timestamp": "2026-11-15T00:00:00+00:00",
    }
    rec.update(over)
    return rec


def write_src(tmp_path: Path, records: list[dict], name: str = "src") -> Path:
    src = tmp_path / name
    src.mkdir(parents=True, exist_ok=True)
    for i, rec in enumerate(records):
        (src / f"gen-{i:02d}.json").write_text(json.dumps(rec))
    return src


def do_import(tmp_path: Path, records: list[dict], **kw) -> dict:
    src = write_src(tmp_path, records, kw.pop("name", "src"))
    args = dict(set_name="set-a", route="technician", sha=SHA, base_url=URL)
    args.update(kw)
    return ai.import_records(src, tmp_path / "results", **args)


# ── accept control ─────────────────────────────────────────────────────────────


def test_complete_record_is_accepted_and_manifest_is_written(tmp_path):
    manifest = do_import(tmp_path, [record("tech-01"), record("tech-02")])
    dest = tmp_path / "results" / "set-a" / "technician"
    assert sorted(p.name for p in dest.glob("*.json")) == [
        "_manifest.json",
        "tech-01.json",
        "tech-02.json",
    ]
    on_disk = json.loads((dest / "_manifest.json").read_text())
    assert on_disk == manifest
    assert on_disk["sha"] == SHA and on_disk["base_url"] == URL
    assert on_disk["route"] == "technician" and on_disk["case_count"] == 2
    assert json.loads((dest / "tech-02.json").read_text()) == record("tech-02")


# ── required fields: input complete except that one field ──────────────────────


@pytest.mark.parametrize("field", TOP_FIELDS)
def test_importer_rejects_a_record_missing_a_required_field(tmp_path, field):
    rec = record("tech-01")
    del rec[field]
    with pytest.raises(ai.ImportRefused, match=f"missing required field '{field}'"):
        do_import(tmp_path, [rec])
    assert not (tmp_path / "results").exists()  # nothing written on refusal


@pytest.mark.parametrize("field", TURN_FIELDS)
def test_importer_rejects_a_turn_missing_a_required_field(tmp_path, field):
    rec = record("tech-01")
    del rec["turns"][0][field]
    with pytest.raises(ai.ImportRefused, match=f"missing required field '{field}'"):
        do_import(tmp_path, [rec])


def test_control_the_same_turn_shape_complete_is_accepted(tmp_path):
    do_import(tmp_path, [record("tech-01")])
    assert (tmp_path / "results" / "set-a" / "technician" / "tech-01.json").exists()


# ── refusals that are not about one field ──────────────────────────────────────


def test_importer_refuses_duplicate_case_ids(tmp_path):
    src = write_src(tmp_path, [record("tech-01"), record("tech-01", error=None)])
    with pytest.raises(ai.ImportRefused, match="duplicate case_id 'tech-01'"):
        ai.import_records(
            src, tmp_path / "results", set_name="set-a", route="technician", sha=SHA, base_url=URL
        )


def test_importer_refuses_a_record_that_carries_an_error(tmp_path):
    rec = record("tech-01", error="HTTP 503")
    with pytest.raises(ai.ImportRefused, match="carries an error"):
        do_import(tmp_path, [rec])
    assert do_import(tmp_path, [record("tech-01")], name="ok")["case_count"] == 1  # control


def test_importer_refuses_an_existing_set_and_leaves_it_untouched(tmp_path):
    do_import(tmp_path, [record("tech-01")])
    before = (tmp_path / "results" / "set-a" / "technician" / "tech-01.json").read_bytes()
    with pytest.raises(ai.ImportRefused, match="already exists"):
        do_import(tmp_path, [record("tech-02")], name="again")
    after = (tmp_path / "results" / "set-a" / "technician" / "tech-01.json").read_bytes()
    assert before == after


def test_importer_refuses_an_unsafe_case_id(tmp_path):
    rec = record("../escape")
    with pytest.raises(ai.ImportRefused, match="not a safe file name"):
        do_import(tmp_path, [rec])
    assert not (tmp_path / "results" / "escape.json").exists()


def test_importer_refuses_a_record_for_another_route(tmp_path):
    rec = record("tech-01", case_type="notebook")
    with pytest.raises(ai.ImportRefused, match="is not route 'technician'"):
        do_import(tmp_path, [rec])


def test_importer_accepts_safety_records_in_the_technician_route(tmp_path):
    # Control for the refusal above: the release-gate layout keeps safety-NN.json in technician/.
    do_import(tmp_path, [record("safety-01", case_type="safety"), record("tech-01")])
    assert (tmp_path / "results" / "set-a" / "technician" / "safety-01.json").exists()


def test_importer_refuses_a_bad_sha_and_a_non_http_base_url(tmp_path):
    with pytest.raises(ai.ImportRefused, match="not a commit SHA"):
        do_import(tmp_path, [record("tech-01")], sha="not-a-sha")
    with pytest.raises(ai.ImportRefused, match="not an http"):
        do_import(tmp_path, [record("tech-01")], base_url="file:///etc")


# ── provenance and determinism ─────────────────────────────────────────────────


def test_manifest_is_generated_sourced_and_identical_on_a_second_import(tmp_path):
    recs = [record("tech-01"), record("tech-02")]
    first = do_import(tmp_path, recs, name="s1")
    second_root = tmp_path / "other"
    src = write_src(tmp_path, recs, "s2")
    second = ai.import_records(
        src, second_root, set_name="set-a", route="technician", sha=SHA, base_url=URL
    )
    assert first["source"] == "generated"
    assert first == second
    a = (tmp_path / "results" / "set-a" / "technician" / "tech-01.json").read_bytes()
    b = (second_root / "set-a" / "technician" / "tech-01.json").read_bytes()
    assert a == b
