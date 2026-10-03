"""Unit tests for tools/acceptance_receipt.py — the generation-bound acceptance
receipt contract (SDLC v1 Part B step 4, `docs/architecture/mira-sdlc-v1.md` §6.2).

Mirrors tests/test_staging_receipt.py: pure-core unit tests plus a thin CLI round
trip. Red-first — the module did not exist before this task. The verifier is
fail-closed: every field is mandatory, `overall` must be PASS (not SUPERSEDED /
INFRA_UNASSESSED), every required capability's scenarios must all PASS, and the
receipt must be fresh and untampered. stdlib + pytest only.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

_MOD_PATH = Path(__file__).resolve().parents[1] / "tools" / "acceptance_receipt.py"
_spec = importlib.util.spec_from_file_location("acceptance_receipt", _MOD_PATH)
ar = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ar)

SHA = "a" * 40
OTHER = "b" * 40
NOW = datetime(2026, 10, 3, 0, 0, 0, tzinfo=timezone.utc)


def _rows(n_pass: int, n_fail: int) -> dict:
    scenarios = [
        {"scenario": f"pass-{i}", "pass": True, "trace_id": f"t-pass-{i}"} for i in range(n_pass)
    ]
    scenarios += [
        {"scenario": f"fail-{i}", "pass": False, "trace_id": f"t-fail-{i}"} for i in range(n_fail)
    ]
    return {"base": "https://stg.example", "ran_at": NOW.isoformat(), "rows": scenarios}


def _staging_receipt() -> dict:
    return {
        "deployed_at": (NOW - timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "running_images": {"mira-hub": "sha256:" + "1" * 64, "mira-web": "sha256:" + "2" * 64},
    }


def _good(**overrides) -> dict:
    kwargs = dict(
        repository="Mikecranesync/MIRA",
        base_url="https://stg.example",
        deployed_sha=SHA,
        rows=_rows(2, 0),
        capture_status="PASS",
        identity_end=SHA,
        run_id="1",
        run_attempt=1,
        run_url="https://github.com/Mikecranesync/MIRA/actions/runs/1",
        staging_run_id=9,
        staging_receipt=_staging_receipt(),
        ran_at=NOW - timedelta(minutes=5),
    )
    kwargs.update(overrides)
    return ar.build_receipt(**kwargs)


def _verify(data: dict, **kw) -> list[str]:
    params = dict(approved_rc_sha=SHA, now=NOW, max_age_hours=1)
    params.update(kw)
    return ar.verify_receipt(data, **params)


# ── the one good shape ───────────────────────────────────────────────────────


def test_good_receipt_verifies():
    assert _verify(_good()) == []


def test_good_receipt_accepts_naive_now():
    assert _verify(_good(), now=NOW.replace(tzinfo=None)) == []


# ── every way to say less than the truth ─────────────────────────────────────


@pytest.mark.parametrize(
    ("field", "needle"),
    [
        ("schema", "schema"),
        ("repository", "repository"),
        ("environment", "environment"),
        ("git_sha", "git_sha"),
        ("identity_start", "identity_start"),
        ("identity_end", "identity_end"),
        ("overall", "overall"),
        ("authorizes", "authorizes"),
        ("generation", "generation"),
        ("staging_run_id", "staging_run_id"),
        ("scenarios", "scenarios"),
        ("acceptance_run_id", "acceptance_run_id"),
        ("run_url", "run_url"),
        ("ran_at", "ran_at"),
        ("expires_at", "expires_at"),
    ],
)
def test_each_mandatory_field_is_checked(field, needle):
    data = _good()
    del data[field]
    problems = _verify(data)
    assert any(needle in p for p in problems), (field, problems)


def test_git_sha_mismatch_is_named_per_service():
    data = _good()
    data["git_sha"] = {"mira-hub": OTHER}
    problems = _verify(data)
    assert any("git_sha[mira-hub]" in p and OTHER in p for p in problems), problems


def test_identity_end_infra_unassessed_sets_overall_and_is_named():
    data = _good(identity_end=ar.INFRA_UNASSESSED)
    assert data["overall"] == ar.INFRA_UNASSESSED
    problems = _verify(data)
    assert any(ar.INFRA_UNASSESSED in p for p in problems), problems


def test_identity_end_other_sha_sets_overall_superseded():
    data = _good(identity_end=OTHER)
    assert data["overall"] == "SUPERSEDED"
    problems = _verify(data)
    assert any("SUPERSEDED" in p for p in problems), problems


def test_any_fail_row_sets_overall_fail():
    data = _good(rows=_rows(1, 1))
    assert data["overall"] == "FAIL"
    assert _verify(data) != []


def test_capture_fail_sets_overall_fail():
    data = _good(capture_status="FAIL")
    assert data["overall"] == "FAIL"


def test_capture_skipped_overall_pass_but_blocks_when_capture_required():
    data = _good(capture_status="SKIPPED")
    assert data["overall"] == "PASS"
    problems = _verify(data, required_capabilities=("retrieval", "capture"))
    assert any("capability capture" in p and "SKIPPED" in p for p in problems), problems
    assert _verify(data, required_capabilities=("retrieval",)) == []


def test_no_staging_receipt_means_no_generation_and_no_authorization():
    data = _good(staging_receipt=None)
    assert data["generation"] is None
    assert data["authorizes"] is False
    problems = _verify(data)
    assert any("generation" in p for p in problems), problems
    assert any("authorizes" in p for p in problems), problems


def test_expected_staging_run_id_mismatch_is_rejected():
    data = _good()
    assert _verify(data, expected_staging_run_id=9) == []
    problems = _verify(data, expected_staging_run_id=99)
    assert any("staging_run_id" in p for p in problems), problems


def test_stale_receipt_is_rejected():
    data = _good(ran_at=NOW - timedelta(hours=200))
    problems = _verify(data, max_age_hours=168)
    assert any("too old" in p for p in problems), problems


def test_future_ran_at_beyond_skew_is_rejected():
    data = _good(ran_at=NOW + timedelta(hours=1))
    problems = _verify(data)
    assert any("future" in p for p in problems), problems


def test_expires_at_tampered_is_rejected():
    data = _good()
    data["expires_at"] = (NOW + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    problems = _verify(data)
    assert any("expires_at" in p and "tampered" in p for p in problems), problems


def test_zero_rows_raises_value_error():
    with pytest.raises(ValueError):
        _good(rows={"base": "x", "ran_at": "x", "rows": []})


@pytest.mark.parametrize(
    "overrides",
    [
        {"capture_status": "BOGUS"},
        {"identity_end": "not-a-sha"},
        {"deployed_sha": "short"},
    ],
    ids=["bad-capture-status", "bad-identity-end", "bad-deployed-sha"],
)
def test_bad_capture_status_or_identity_raises_value_error(overrides):
    with pytest.raises(ValueError):
        _good(**overrides)


# ── CLI ──────────────────────────────────────────────────────────────────────


def _cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(_MOD_PATH), *args], capture_output=True, text=True, timeout=30
    )


def _build_argv(rows_path, out, **extra) -> list[str]:
    flags = {
        "--repository": "Mikecranesync/MIRA",
        "--base-url": "https://stg.example",
        "--deployed-sha": SHA,
        "--rows": str(rows_path),
        "--capture-status": "PASS",
        "--identity-end": SHA,
        "--run-id": "1",
        "--run-attempt": "1",
        "--run-url": "https://github.com/Mikecranesync/MIRA/actions/runs/1",
        "--out": str(out),
    }
    flags.update(extra)
    argv = ["build"]
    for flag, value in flags.items():
        argv += [flag, value]
    return argv


def test_cli_build_then_verify_round_trip(tmp_path):
    rows_path = tmp_path / "rows.json"
    rows_path.write_text(json.dumps(_rows(2, 0)))
    staging_path = tmp_path / "staging-receipt.json"
    staging_path.write_text(json.dumps(_staging_receipt()))
    out = tmp_path / "acceptance-receipt.json"

    r = _cli(
        *_build_argv(
            rows_path, out, **{"--staging-run-id": "9", "--staging-receipt": str(staging_path)}
        )
    )
    assert r.returncode == 0, r.stderr
    data = json.loads(out.read_text())
    assert data["overall"] == "PASS"
    assert data["schema"] == ar.SCHEMA

    r = _cli("verify", "--receipt", str(out), "--approved-rc-sha", SHA, "--max-age-hours", "999999")
    assert r.returncode == 0, r.stderr


def test_cli_verify_exits_1_and_names_problems(tmp_path):
    data = _good(identity_end=OTHER)
    out = tmp_path / "receipt.json"
    out.write_text(json.dumps(data))
    r = _cli("verify", "--receipt", str(out), "--approved-rc-sha", SHA, "--max-age-hours", "999999")
    assert r.returncode == 1
    assert "SUPERSEDED" in r.stderr


def test_cli_build_exits_1_on_value_error(tmp_path):
    rows_path = tmp_path / "rows.json"
    rows_path.write_text(json.dumps({"base": "x", "ran_at": "x", "rows": []}))
    out = tmp_path / "acceptance-receipt.json"
    r = _cli(*_build_argv(rows_path, out))
    assert r.returncode == 1
    assert not out.exists()


def test_cli_verify_rejects_unparseable_receipt_json(tmp_path):
    out = tmp_path / "receipt.json"
    out.write_text("not json")
    r = _cli("verify", "--receipt", str(out), "--approved-rc-sha", SHA)
    assert r.returncode == 1
