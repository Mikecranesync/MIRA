"""Archived evaluation results must not masquerade as candidate acceptance."""

import hashlib
import json
import sys

import pytest

from evals.scripts import release_gate, report


CANDIDATE = "b" * 40
ARCHIVED = "a" * 9


def summary(sha=ARCHIVED, dangerous=0):
    return {"sha": sha, "technician_score": 56.4, "dangerous_count": dangerous}


def write_manifest(tmp_path, *, offline=True, baseline=None):
    release_gate.write_manifest(
        tmp_path / "manifest.json",
        CANDIDATE,
        1,
        "candidate-branch",
        "https://example.invalid",
        "current-keys",
        "judge",
        ["report"],
        offline_only=offline,
        baseline=baseline,
    )


@pytest.mark.parametrize("dangerous", [0, 1])
def test_offline_report_labels_archive_and_preserves_scored_identity(tmp_path, dangerous):
    archive = tmp_path / "archive"
    (archive / "scores").mkdir(parents=True)
    raw = json.dumps(summary(dangerous=dangerous)).encode()
    (archive / "scores" / "_summary.json").write_bytes(raw)
    write_manifest(tmp_path, baseline=archive)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["evaluation_mode"] == "offline_archive"
    assert manifest["archive_source"]["summary_sha256"] == hashlib.sha256(raw).hexdigest()
    assert manifest["archive_source"]["scored_answer_sha"] == ARCHIVED
    text = report.render(tmp_path, summary(dangerous=dangerous), None, None, None)
    assert "ARCHIVED SCORES" in text
    assert f"Requested candidate SHA: {CANDIDATE}" in text
    assert f"Scored answer SHA: {ARCHIVED}" in text
    assert "Current candidate technician/safety acceptance: NOT RUN" in text
    assert "RELEASE CANDIDATE" not in text
    assert "ARCHIVED CORPUS VERDICT" in text
    if dangerous:
        assert "HOLD" in text


def test_same_sha_does_not_make_archived_answers_fresh(tmp_path):
    write_manifest(tmp_path)
    text = report.render(tmp_path, summary(CANDIDATE), None, None, None)
    assert "ARCHIVED SCORES" in text
    assert "Current candidate technician/safety acceptance: NOT RUN" in text


def test_legacy_report_cannot_assert_confirmed_live_surfaces(tmp_path):
    text = report.render(tmp_path, summary(), None, None, None)
    assert "Evidence provenance: UNVERIFIED" in text
    assert "production API (technician/safety) + Android device" not in text
    assert "RELEASE CANDIDATE" not in text


def test_live_attempt_is_distinct_from_verified_runtime_identity(tmp_path):
    write_manifest(tmp_path, offline=False)
    text = report.render(tmp_path, summary(CANDIDATE), None, None, None)
    assert "LIVE RUN ATTEMPT" in text
    assert "Runtime/build identity: UNVERIFIED" in text
    assert "ARCHIVED SCORES" not in text
    assert "RELEASE CANDIDATE" in text


def test_live_attempt_with_mismatched_answer_sha_is_not_candidate_acceptance(tmp_path):
    write_manifest(tmp_path, offline=False)
    text = report.render(tmp_path, summary(), None, None, None)
    assert "ANSWER SHA MISMATCH" in text
    assert "RELEASE CANDIDATE" not in text


def test_orchestrator_records_offline_basis_before_report_without_model_calls(
    tmp_path, monkeypatch
):
    archive = tmp_path / "archive"
    (archive / "scores").mkdir(parents=True)
    (archive / "scores" / "_summary.json").write_text(json.dumps(summary(dangerous=1)))
    stages = []

    def stage(name, cmd, logs, offline):
        stages.append(name)
        assert offline
        if name == "report":
            manifest = json.loads((logs.parent / "manifest.json").read_text())
            assert manifest["evaluation_mode"] == "offline_archive"
            assert manifest["archive_source"]["scored_answer_sha"] == ARCHIVED
            assert json.loads((logs.parent / "scores" / "_summary.json").read_text()) == summary(
                dangerous=1
            )
            return 3, False
        return (2, True) if name == "judge_baseline" else (0, False)

    monkeypatch.setattr(release_gate, "run_stage", stage)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "release_gate",
            "--sha",
            CANDIDATE,
            "--offline-only",
            "--baseline",
            str(archive),
            "--out-root",
            str(tmp_path / "runs"),
            "--run-id",
            "test",
        ],
    )
    assert release_gate.main() == 3
    assert stages == ["drift_check", "judge_baseline", "report"]


@pytest.mark.parametrize("sha", [CANDIDATE[:9], CANDIDATE])
def test_live_runner_short_sha_matches_full_requested_sha(tmp_path, sha):
    write_manifest(tmp_path, offline=False)
    text = report.render(tmp_path, summary(sha), None, None, None)
    assert "RELEASE CANDIDATE" in text


@pytest.mark.parametrize("sha", ["unknown", "", "b", "b" * 41, None])
def test_missing_or_invalid_answer_identity_never_qualifies_candidate(tmp_path, sha):
    write_manifest(tmp_path, offline=False)
    text = report.render(tmp_path, summary(sha), None, None, None)
    assert "RELEASE CANDIDATE" not in text


@pytest.mark.parametrize("report_exit,expected", [(0, 0), (3, 3), (2, 4)])
def test_provenance_does_not_change_gate_exit_policy(tmp_path, monkeypatch, report_exit, expected):
    archive = tmp_path / "archive"
    (archive / "scores").mkdir(parents=True)
    (archive / "scores" / "_summary.json").write_text(json.dumps(summary()))
    monkeypatch.setattr(
        release_gate,
        "run_stage",
        lambda name, *_: (
            (report_exit, report_exit not in (0, 3)) if name == "report" else (0, False)
        ),
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "release_gate",
            "--sha",
            CANDIDATE,
            "--offline-only",
            "--baseline",
            str(archive),
            "--out-root",
            str(tmp_path / "runs"),
        ],
    )
    assert release_gate.main() == expected



def test_report_command_uses_run_stamp_instead_of_overwriting_old_archive():
    from pathlib import Path

    run_dir = Path("results/candidate-gate-run42")
    cmd = release_gate.build_report_cmd(run_dir, Path("archive"))
    assert cmd[cmd.index("--stamp") + 1] == "candidate-gate-run42"
    assert cmd[cmd.index("--baseline") + 1] == "archive"


def test_report_cli_keeps_original_scores_and_labels_output(tmp_path, monkeypatch):
    results = tmp_path / "run"
    (results / "scores").mkdir(parents=True)
    raw = json.dumps(summary(dangerous=1))
    (results / "scores" / "_summary.json").write_text(raw)
    write_manifest(results)
    monkeypatch.setattr(report, "__file__", str(tmp_path / "evals" / "scripts" / "report.py"))
    monkeypatch.setattr(sys, "argv", ["report", str(results), "--stamp", "candidate-run42"])
    assert report.main() == 3
    assert (results / "scores" / "_summary.json").read_text() == raw
    text = (results / "report.txt").read_text()
    assert "ARCHIVED SCORES" in text
    assert "Current candidate technician/safety acceptance: NOT RUN" in text
    assert (tmp_path / "evals" / "reports" / f"{ARCHIVED}-candidate-run42.txt").read_text() == text
