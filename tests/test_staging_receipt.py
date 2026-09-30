"""Unit tests for tools/staging_receipt.py — the deployed-receipt contract (#3910 / #3911).

Red-first at the RC (the module did not exist). The verifier is fail-closed: the
tests below pin every way a receipt can say less than "this exact SHA is built,
running and reporting itself on every required surface". Two cases came from the
independent reviewer's adversarial probes (one matching surface masking a
mismatching one; missing runtime/images/timestamp passing).

pytest only — no third-party deps beyond the stdlib module under test.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

_MOD_PATH = Path(__file__).resolve().parents[1] / "tools" / "staging_receipt.py"
_spec = importlib.util.spec_from_file_location("staging_receipt", _MOD_PATH)
receipt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(receipt)

SHA = "a" * 40
OTHER = "b" * 40
IMG_HUB = "sha256:" + "1" * 64
IMG_WEB = "sha256:" + "2" * 64
NOW = datetime(2026, 9, 21, 0, 0, 0, tzinfo=timezone.utc)


def _good(**overrides) -> dict:
    data = {
        "schema": receipt.RECEIPT_SCHEMA,
        "environment": "staging",
        "approved_rc_sha": SHA,
        "runtime": {"mira-hub": SHA, "mira-web": SHA},
        "built_images": {"mira-hub": IMG_HUB, "mira-web": IMG_WEB},
        "running_images": {"mira-hub": IMG_HUB, "mira-web": IMG_WEB},
        "target": {"host": "165.245.138.91", "compose": "docker-compose.staging-vps.yml"},
        "deployed_at": (NOW - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "run_url": "https://github.com/Mikecranesync/MIRA/actions/runs/1",
        "run_id": "1",
    }
    data.update(overrides)
    return data


def _verify(data: dict, **kw) -> list[str]:
    params = dict(approved_rc_sha=SHA, environment="staging", now=NOW, max_age_hours=1)
    params.update(kw)
    return receipt.verify_receipt(data, **params)


# ── extract_receipt_line ─────────────────────────────────────────────────────


def test_extract_finds_the_single_line():
    text = "noise\nFACTORYLM_DEPLOY_RECEIPT_JSON=" + json.dumps(_good()) + "\nmore noise\n"
    assert receipt.extract_receipt_line(text)["approved_rc_sha"] == SHA


@pytest.mark.parametrize(
    "text",
    [
        "no receipt here\n",
        "FACTORYLM_DEPLOY_RECEIPT_JSON={}\nFACTORYLM_DEPLOY_RECEIPT_JSON={}\n",
        "FACTORYLM_DEPLOY_RECEIPT_JSON={not json\n",
        "FACTORYLM_DEPLOY_RECEIPT_JSON=[1,2]\n",
    ],
    ids=["zero-lines", "two-lines", "bad-json", "not-an-object"],
)
def test_extract_fails_closed(text):
    with pytest.raises(ValueError):
        receipt.extract_receipt_line(text)


# ── verify_receipt: the one good shape ───────────────────────────────────────


def test_good_receipt_verifies():
    assert _verify(_good()) == []


def test_good_receipt_accepts_naive_now():
    assert _verify(_good(), now=NOW.replace(tzinfo=None)) == []


# ── verify_receipt: every way to say less than the truth ─────────────────────


@pytest.mark.parametrize(
    ("overrides", "needle"),
    [
        ({"schema": "something/else"}, "schema"),
        ({"environment": "production"}, "environment mismatch"),
        ({"approved_rc_sha": OTHER}, "approved_rc_sha mismatch"),
        ({"approved_rc_sha": "A" * 40}, "malformed"),
        ({"approved_rc_sha": None}, "malformed"),
        ({"target": {}}, "target.host"),
        ({"run_url": ""}, "run_url"),
        ({"run_id": None}, "run_id"),
    ],
)
def test_each_field_is_mandatory_and_checked(overrides, needle):
    problems = _verify(_good(**overrides))
    assert any(needle in p for p in problems), (needle, problems)


def test_one_matching_runtime_never_masks_a_mismatching_one():
    """Reviewer probe: hub wrong, web right — must FAIL (previously passed)."""
    problems = _verify(_good(runtime={"mira-hub": OTHER, "mira-web": SHA}))
    assert any("runtime[mira-hub]" in p and OTHER in p for p in problems), problems


def test_every_required_service_must_report_runtime():
    problems = _verify(_good(runtime={"mira-web": SHA}))
    assert any("runtime[mira-hub]: required service not reported" in p for p in problems), problems


def test_null_runtime_value_is_a_mismatch_not_a_skip():
    problems = _verify(_good(runtime={"mira-hub": SHA, "mira-web": None}))
    assert any("runtime[mira-web]" in p for p in problems), problems


@pytest.mark.parametrize("field", ["runtime", "built_images", "running_images", "deployed_at"])
def test_missing_or_empty_core_fields_fail_closed(field):
    """Reviewer probe: missing runtime / images / timestamp — must FAIL (previously passed)."""
    data = _good()
    del data[field]
    problems = _verify(data)
    assert any(field in p for p in problems), (field, problems)
    data = _good(**{field: {} if field != "deployed_at" else ""})
    problems = _verify(data)
    assert any(field in p for p in problems), (field, problems)


def test_image_identity_mismatch_is_named_per_service():
    problems = _verify(_good(running_images={"mira-hub": IMG_WEB, "mira-web": IMG_WEB}))
    assert any("image identity mismatch for mira-hub" in p for p in problems), problems


def test_image_key_sets_must_match():
    problems = _verify(_good(running_images={"mira-hub": IMG_HUB}))
    assert any("image key mismatch" in p for p in problems), problems


def test_image_ids_must_be_sha256_digests():
    problems = _verify(
        _good(
            built_images={"mira-hub": "latest", "mira-web": IMG_WEB},
            running_images={"mira-hub": "latest", "mira-web": IMG_WEB},
        )
    )
    assert any("not a sha256 image id" in p for p in problems), problems


def test_runtime_without_image_identity_is_rejected():
    problems = _verify(_good(runtime={"mira-hub": SHA, "mira-web": SHA, "mira-pipeline": SHA}))
    assert any(
        "runtime[mira-pipeline] reported without a matching image identity" in p for p in problems
    )


def test_future_timestamp_beyond_skew_is_rejected():
    future = (NOW + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    problems = _verify(_good(deployed_at=future))
    assert any("future" in p for p in problems), problems


def test_small_clock_skew_is_tolerated():
    soon = (NOW + timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert _verify(_good(deployed_at=soon)) == []


def test_stale_receipt_is_rejected():
    old = (NOW - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    problems = _verify(_good(deployed_at=old), max_age_hours=1)
    assert any("too old" in p for p in problems), problems


def test_unparseable_timestamp_is_rejected():
    problems = _verify(_good(deployed_at="yesterday"))
    assert any("deployed_at" in p for p in problems), problems


def test_required_services_can_be_narrowed_but_never_widened_silently():
    hub_only = _good(
        runtime={"mira-hub": SHA},
        built_images={"mira-hub": IMG_HUB},
        running_images={"mira-hub": IMG_HUB},
    )
    assert _verify(hub_only) != []  # default requires web too
    assert _verify(hub_only, required_services=("mira-hub",)) == []


def test_run_identity_binding_rejects_a_receipt_from_another_run():
    """Provenance (reviewer P1): the receipt must name the exact run whose artifact
    it was downloaded from; a same-name artifact from another run is refused."""
    assert _verify(_good(), expected_run_id="1", expected_run_url=_good()["run_url"]) == []
    problems = _verify(_good(), expected_run_id="2", expected_run_url=_good()["run_url"])
    assert any("run_id" in p and "run 2" in p or "run '2'" in p for p in problems), problems
    problems = _verify(_good(), expected_run_id="1", expected_run_url="https://elsewhere/9")
    assert any("run_url" in p for p in problems), problems


def test_cli_verify_binds_run_identity(tmp_path):
    out = tmp_path / "receipt.json"
    data = _good(deployed_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    out.write_text(json.dumps(data))
    ok = _cli(
        "verify",
        "--receipt",
        str(out),
        "--approved-rc-sha",
        SHA,
        "--environment",
        "staging",
        "--expect-run-id",
        "1",
        "--expect-run-url",
        data["run_url"],
    )
    assert ok.returncode == 0, ok.stderr
    bad = _cli(
        "verify",
        "--receipt",
        str(out),
        "--approved-rc-sha",
        SHA,
        "--environment",
        "staging",
        "--expect-run-id",
        "999",
        "--expect-run-url",
        data["run_url"],
    )
    assert bad.returncode == 1 and "run_id" in bad.stderr


def test_non_object_receipt_is_rejected():
    assert receipt.verify_receipt(
        ["not", "a", "dict"], approved_rc_sha=SHA, environment="staging", now=NOW, max_age_hours=1
    )


# ── CLI ──────────────────────────────────────────────────────────────────────


def _cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(_MOD_PATH), *args], capture_output=True, text=True, timeout=30
    )


def test_cli_extract_stamps_fields_then_verify_passes(tmp_path):
    data = _good()
    del data["run_url"]
    del data["run_id"]
    data["deployed_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    log = tmp_path / "deploy.out"
    log.write_text(
        "=== Deploy complete ===\nFACTORYLM_DEPLOY_RECEIPT_JSON=" + json.dumps(data) + "\n"
    )
    out = tmp_path / "receipt.json"

    r = _cli(
        "extract",
        "--log",
        str(log),
        "--out",
        str(out),
        "--set",
        "run_url=https://x/1",
        "--set",
        "run_id=1",
    )
    assert r.returncode == 0, r.stderr
    stamped = json.loads(out.read_text())
    assert stamped["run_url"] == "https://x/1" and stamped["run_id"] == "1"

    r = _cli(
        "verify",
        "--receipt",
        str(out),
        "--approved-rc-sha",
        SHA,
        "--environment",
        "staging",
        "--max-age-hours",
        "1",
    )
    assert r.returncode == 0, r.stderr


def test_cli_verify_exits_1_and_names_every_problem(tmp_path):
    out = tmp_path / "receipt.json"
    out.write_text(json.dumps(_good(runtime={"mira-hub": OTHER, "mira-web": SHA}, run_id="")))
    r = _cli(
        "verify",
        "--receipt",
        str(out),
        "--approved-rc-sha",
        SHA,
        "--environment",
        "staging",
        "--max-age-hours",
        "999999",
    )
    assert r.returncode == 1
    assert "runtime[mira-hub]" in r.stderr and "run_id" in r.stderr


def test_cli_extract_exits_1_on_missing_line(tmp_path):
    log = tmp_path / "deploy.out"
    log.write_text("nothing here\n")
    r = _cli("extract", "--log", str(log), "--out", str(tmp_path / "x.json"))
    assert r.returncode == 1 and "FACTORYLM_DEPLOY_RECEIPT_JSON" in r.stderr


@pytest.mark.parametrize(
    "flag",
    [
        "approved_rc_sha=" + OTHER,
        "environment=production",
        "deployed_at=2099-01-01T00:00:00Z",
        "runtime=x",
        "schema=x",
        "run_url=",
    ],
    ids=["sha", "environment", "deployed_at", "runtime", "schema", "empty-value"],
)
def test_cli_extract_set_cannot_overwrite_security_fields(tmp_path, flag):
    """Reviewer point (d): --set is for run identity only; a runner-side flag must
    never be able to rewrite what the deploy transcript proved."""
    log = tmp_path / "deploy.out"
    log.write_text("FACTORYLM_DEPLOY_RECEIPT_JSON=" + json.dumps(_good()) + "\n")
    out = tmp_path / "receipt.json"
    r = _cli("extract", "--log", str(log), "--out", str(out), "--set", flag)
    assert r.returncode == 1, r.stdout + r.stderr
    assert not out.exists()


def test_cli_verify_rejects_unknown_environment(tmp_path):
    out = tmp_path / "receipt.json"
    out.write_text(json.dumps(_good()))
    r = _cli("verify", "--receipt", str(out), "--approved-rc-sha", SHA, "--environment", "prod")
    assert r.returncode != 0
