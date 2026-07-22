"""PR 4 tests — readiness command + OCR/healthcheck enforcement (ADR-0031).

Hermetic ($0): every probe seam is monkeypatched; no network, no git
dependence, no tesseract requirement on the CI runner. Includes the FR-3
compose-contract suite (both bots, both files) and the boot-parity source
pins (the packaging-guard idiom).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from factorylm_ai import readiness  # noqa: E402
from factorylm_ai.schemas.validate import load_schema, validate_or_raise  # noqa: E402

_ENV_VARS = (
    "PRINT_VISION_PROVIDER",
    "PRINT_VISION_MODEL",
    "TOGETHERAI_API_KEY",
    "GROQ_API_KEY",
    "CEREBRAS_API_KEY",
    "OCR_REQUIRE_TESSERACT",
    "OCR_EXPECT_TESSERACT",
    "FACTORYLM_NETWORK_MODE",
    "INFERENCE_BACKEND",
    "FACTORYLM_AI_ALLOW_NETWORK",
    "IMAGE_DIGEST",
)


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch):
    for var in _ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(readiness, "_git_info", lambda: ("f" * 40, False))
    monkeypatch.setattr(readiness, "_tesseract_versions", lambda: ("5.3.0", "0.3.13"))
    yield


def _ready_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TOGETHERAI_API_KEY", "unit-test-not-real")
    monkeypatch.setenv("FACTORYLM_NETWORK_MODE", "enabled")
    monkeypatch.setenv("OCR_REQUIRE_TESSERACT", "1")


def test_ready_report_validates_and_exits_zero(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    _ready_env(monkeypatch)
    code = readiness.main(["--profile", "printsense", "--environment", "staging"])
    assert code == 0
    report = json.loads(capsys.readouterr().out)
    validate_or_raise(report, load_schema("runtime_capabilities"))
    assert report["verdict"] == "ready"
    assert report["provider"]["requested"] == "together"
    assert report["provider"]["model"] == "google/gemma-3n-E4B-it"  # env default
    assert report["provider"]["text_probe"] == "skipped"  # no --live in CI, ever
    assert report["ocr"]["tesseract_version"] == "5.3.0"
    assert report["errors"] == []


def test_missing_key_is_not_ready_exit_one(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    monkeypatch.setenv("FACTORYLM_NETWORK_MODE", "enabled")
    monkeypatch.setenv("OCR_REQUIRE_TESSERACT", "1")
    code = readiness.main(["--profile", "printsense"])
    assert code == 1
    report = json.loads(capsys.readouterr().out)
    assert report["verdict"] == "not_ready"
    assert "PROVIDER_KEY_MISSING" in report["errors"]


def test_missing_tesseract_when_required_is_not_ready(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    _ready_env(monkeypatch)
    monkeypatch.setattr(readiness, "_tesseract_versions", lambda: (None, None))
    code = readiness.main(["--profile", "printsense"])
    assert code == 1
    report = json.loads(capsys.readouterr().out)
    assert "TESSERACT_MISSING" in report["errors"]
    assert report["ocr"]["available"] is False


def test_missing_tesseract_optional_is_degraded_dev_verdict(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    monkeypatch.setenv("TOGETHERAI_API_KEY", "unit-test-not-real")
    monkeypatch.setenv("FACTORYLM_NETWORK_MODE", "enabled")
    monkeypatch.setattr(readiness, "_tesseract_versions", lambda: (None, None))
    code = readiness.main(["--profile", "printsense"])
    assert code == 0  # degraded dev mode is allowed, but labeled
    report = json.loads(capsys.readouterr().out)
    assert report["verdict"] == "degraded"


def test_conflicting_network_flags_exit_invalid_config(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    monkeypatch.setenv("FACTORYLM_AI_ALLOW_NETWORK", "false")
    code = readiness.main(["--profile", "printsense"])
    assert code == 2
    assert json.loads(capsys.readouterr().out)["error"] == "INVALID_CONFIGURATION"


def test_probe_infrastructure_failure_exits_three(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    monkeypatch.setattr(
        readiness, "collect", lambda *a, **k: (_ for _ in ()).throw(OSError("boom"))
    )
    code = readiness.main(["--profile", "printsense"])
    assert code == 3


def test_report_never_contains_key_values(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    monkeypatch.setenv("TOGETHERAI_API_KEY", "tgp_v1_SUPERSECRETVALUE")
    monkeypatch.setenv("FACTORYLM_NETWORK_MODE", "enabled")
    readiness.main(["--profile", "printsense"])
    assert "SUPERSECRETVALUE" not in capsys.readouterr().out


def test_out_file_written(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _ready_env(monkeypatch)
    out = tmp_path / "capability-report.json"
    assert readiness.main(["--profile", "printsense", "--out", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["schema"] == (
        "factorylm.runtime-capabilities.v1"
    )


# ── FR-3: compose contract (both bots, both files) ─────────────────────────


def _bot_services() -> list[tuple[str, str, dict]]:
    out = []
    for fname, services in (
        ("docker-compose.saas.yml", ("mira-bot-telegram", "mira-bot-slack")),
        ("docker-compose.staging-vps.yml", ("mira-bot-telegram",)),
    ):
        doc = yaml.safe_load((REPO / fname).read_text(encoding="utf-8"))
        for svc in services:
            out.append((fname, svc, doc["services"][svc]))
    return out


def test_compose_passes_canonical_ocr_require() -> None:
    for fname, svc, block in _bot_services():
        env = block.get("environment") or []
        assert any("OCR_REQUIRE_TESSERACT=${OCR_REQUIRE_TESSERACT" in e for e in env), (
            f"{fname}:{svc} must pass OCR_REQUIRE_TESSERACT through"
        )
        assert any("OCR_EXPECT_TESSERACT" in e for e in env), (
            f"{fname}:{svc} legacy OCR_EXPECT_TESSERACT must remain during migration"
        )


def test_compose_healthchecks_enforce_the_ocr_verdict() -> None:
    """FR-3: Telegram and Slack share the SAME OCR health contract — every bot
    healthcheck asserts ocr_lane_report()['verdict'] == 'ok' (tesseract ships
    in the images, so healthy today; a dead floor flips the container
    unhealthy instead of degrading silently)."""
    for fname, svc, block in _bot_services():
        test_cmd = " ".join(block["healthcheck"]["test"])
        assert "ocr_lane_report" in test_cmd and "verdict" in test_cmd, (
            f"{fname}:{svc} healthcheck must enforce the OCR verdict"
        )
        if svc == "mira-bot-telegram":
            assert "bot.py" in test_cmd, "telegram keeps the process-alive check too"


# ── Boot parity source pins (packaging-guard idiom) ────────────────────────


def test_both_bots_boot_log_ocr_lanes() -> None:
    for bot in ("telegram", "slack"):
        text = (REPO / "mira-bots" / bot / "bot.py").read_text(encoding="utf-8")
        assert "ocr_lane_report" in text and "OCR_LANES" in text, (
            f"{bot} bot must boot-log the OCR lane report (FR-3 parity)"
        )


def test_vision_worker_honors_canonical_require_knob() -> None:
    sys.path.insert(0, str(REPO / "mira-bots"))
    from shared.workers import vision_worker

    src = (REPO / "mira-bots" / "shared" / "workers" / "vision_worker.py").read_text(
        encoding="utf-8"
    )
    assert "OCR_REQUIRE_TESSERACT" in src
    assert hasattr(vision_worker, "ocr_lane_report")
