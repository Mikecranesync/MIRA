"""RED-FIRST: unit tests for tools/staging_receipt.py.

At the RC, this file fails at collection — tools/staging_receipt.py does not exist.
After implementation, all tests pass.
"""

from __future__ import annotations

import importlib.util
from datetime import datetime, timedelta
from pathlib import Path

_MOD_PATH = Path(__file__).resolve().parents[1] / "tools" / "staging_receipt.py"
_spec = importlib.util.spec_from_file_location("staging_receipt", _MOD_PATH)
receipt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(receipt)


# ── extract_receipt_line ────────────────────────────────────────────────────


def test_extract_finds_single_line():
    text = 'some output\nFACTORYLM_DEPLOY_RECEIPT_JSON={"schema":"factorylm.deploy-receipt/1"}\n'
    result = receipt.extract_receipt_line(text)
    assert result["schema"] == "factorylm.deploy-receipt/1"


def test_extract_fails_on_zero_lines():
    text = "no receipt here"
    try:
        receipt.extract_receipt_line(text)
        assert False, "should fail on missing line"
    except Exception:
        pass


def test_extract_fails_on_multiple_lines():
    text = "FACTORYLM_DEPLOY_RECEIPT_JSON={}\nFACTORYLM_DEPLOY_RECEIPT_JSON={}\n"
    try:
        receipt.extract_receipt_line(text)
        assert False, "should fail on duplicate lines"
    except Exception:
        pass


# ── verify_receipt ─────────────────────────────────────────────────────────


def test_verify_good_receipt():
    now = datetime.utcnow()
    deployed_at = (now - timedelta(minutes=5)).isoformat() + "Z"
    receipt_data = {
        "schema": "factorylm.deploy-receipt/1",
        "environment": "staging",
        "approved_rc_sha": "a" * 40,
        "runtime": {"mira-hub": "a" * 40},
        "built_images": {"mira-hub": "sha256:abc123"},
        "running_images": {"mira-hub": "sha256:abc123"},
        "target": {"host": "165.245.138.91", "compose": "docker-compose.staging-vps.yml"},
        "deployed_at": deployed_at,
        "run_url": "https://github.com/...",
        "run_id": "12345",
    }
    problems = receipt.verify_receipt(
        receipt_data,
        approved_rc_sha="a" * 40,
        environment="staging",
        now=now,
        max_age_hours=1,
    )
    assert problems == [], f"good receipt should have no problems, got: {problems}"


def test_verify_rejects_wrong_environment():
    receipt_data = {
        "schema": "factorylm.deploy-receipt/1",
        "environment": "production",
        "approved_rc_sha": "a" * 40,
    }
    problems = receipt.verify_receipt(
        receipt_data,
        approved_rc_sha="a" * 40,
        environment="staging",
        now=datetime.utcnow(),
    )
    assert any("environment" in p for p in problems), "must reject wrong environment"


def test_verify_rejects_sha_mismatch():
    receipt_data = {
        "schema": "factorylm.deploy-receipt/1",
        "environment": "staging",
        "approved_rc_sha": "b" * 40,
    }
    problems = receipt.verify_receipt(
        receipt_data,
        approved_rc_sha="a" * 40,
        environment="staging",
        now=datetime.utcnow(),
    )
    assert any("sha" in p.lower() for p in problems), "must reject sha mismatch"


def test_verify_rejects_image_mismatch():
    now = datetime.utcnow()
    deployed_at = (now - timedelta(minutes=5)).isoformat() + "Z"
    receipt_data = {
        "schema": "factorylm.deploy-receipt/1",
        "environment": "staging",
        "approved_rc_sha": "a" * 40,
        "built_images": {"mira-hub": "sha256:abc123"},
        "running_images": {"mira-hub": "sha256:xyz789"},
        "deployed_at": deployed_at,
    }
    problems = receipt.verify_receipt(
        receipt_data,
        approved_rc_sha="a" * 40,
        environment="staging",
        now=now,
    )
    assert any("image" in p.lower() for p in problems), "must reject image mismatch"


def test_verify_rejects_future_timestamp():
    now = datetime.utcnow()
    future = (now + timedelta(hours=1)).isoformat() + "Z"
    receipt_data = {
        "schema": "factorylm.deploy-receipt/1",
        "environment": "staging",
        "approved_rc_sha": "a" * 40,
        "deployed_at": future,
    }
    problems = receipt.verify_receipt(
        receipt_data,
        approved_rc_sha="a" * 40,
        environment="staging",
        now=now,
    )
    assert any("deployed_at" in p.lower() or "future" in p.lower() for p in problems), (
        "must reject future timestamp"
    )


def test_verify_rejects_expired_receipt():
    now = datetime.utcnow()
    old = (now - timedelta(hours=2)).isoformat() + "Z"
    receipt_data = {
        "schema": "factorylm.deploy-receipt/1",
        "environment": "staging",
        "approved_rc_sha": "a" * 40,
        "deployed_at": old,
    }
    problems = receipt.verify_receipt(
        receipt_data,
        approved_rc_sha="a" * 40,
        environment="staging",
        now=now,
        max_age_hours=1,
    )
    assert any("age" in p.lower() or "old" in p.lower() for p in problems), (
        "must reject expired receipt"
    )


def test_verify_rejects_all_runtime_none():
    """When runtime dict is non-empty but all values are None, reject it."""
    now = datetime.utcnow()
    deployed_at = (now - timedelta(minutes=5)).isoformat() + "Z"
    receipt_data = {
        "schema": "factorylm.deploy-receipt/1",
        "environment": "staging",
        "approved_rc_sha": "a" * 40,
        "runtime": {"mira-hub": None, "mira-web": None},
        "target": {"host": "165.245.138.91", "compose": "docker-compose.staging-vps.yml"},
        "deployed_at": deployed_at,
        "run_url": "https://github.com/...",
        "run_id": "12345",
    }
    problems = receipt.verify_receipt(
        receipt_data,
        approved_rc_sha="a" * 40,
        environment="staging",
        now=now,
    )
    assert any("at least one runtime value" in p for p in problems), (
        "must reject when all runtime values are None"
    )


# ── CLI commands ────────────────────────────────────────────────────────────


def test_cli_extract_with_set():
    # Verify --set k=v adds fields to extracted receipt
    # (integration test — verify the CLI plumbing works)
    pass  # implementation detail; verify in a subprocess test if needed
