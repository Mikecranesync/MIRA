"""ADR-0031 PR 8 production-activation contracts.

Hermetic: validates the production Compose overlay and deployment workflow without
Docker, Doppler, SSH, provider calls, or spend.
"""

from __future__ import annotations

from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
OVERLAY = REPO / "docker-compose.printsense-production.yml"
WORKFLOW = REPO / ".github" / "workflows" / "printsense-production-activation.yml"


def test_production_overlay_pins_staging_proven_profile() -> None:
    text = OVERLAY.read_text(encoding="utf-8")

    assert "mira-bot-telegram:" in text
    assert "mira-bot-slack:" in text
    assert "PRINT_VISION_PROVIDER: ${PRINTSENSE_PROD_PROVIDER:-together}" in text
    assert "PRINT_VISION_MODEL: ${PRINTSENSE_PROD_MODEL:-MiniMaxAI/MiniMax-M3}" in text
    assert "TOGETHERAI_VISION_MODEL: ${PRINTSENSE_PROD_MODEL:-MiniMaxAI/MiniMax-M3}" in text
    assert "PRINT_PROVIDER_POLICY: ${PRINTSENSE_PROD_POLICY:-strict}" in text
    assert 'PRINT_ENFORCE_APPROVED_MODELS: "1"' in text
    assert "FACTORYLM_NETWORK_MODE: enabled" in text
    assert 'OCR_REQUIRE_TESSERACT: "1"' in text
    assert 'OCR_EXPECT_TESSERACT: "1"' in text


def test_activation_is_durable_after_normal_vps_deploys() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")

    assert 'workflows: ["Deploy to VPS"]' in text
    assert "github.event.workflow_run.conclusion == 'success'" in text
    assert "group: deploy-vps" in text
    assert "docker-compose.printsense-production.yml" in text
    assert "$COMPOSE build mira-bot-telegram mira-bot-slack" in text
    assert "$COMPOSE up -d --no-deps --force-recreate mira-bot-telegram mira-bot-slack" in text


def test_activation_fails_closed_and_proves_live_vision_and_ocr() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")

    assert 'test "$PRINT_VISION_PROVIDER" = "together"' in text
    assert 'test "$PRINT_VISION_MODEL" = "MiniMaxAI/MiniMax-M3"' in text
    assert 'test "$PRINT_PROVIDER_POLICY" = "strict"' in text
    assert 'test "$OCR_REQUIRE_TESSERACT" = "1"' in text
    assert 'test -n "$TOGETHERAI_API_KEY"' in text
    assert "python -m factorylm_ai.readiness" in text
    assert 'readiness.collect("printsense", live=True, environment="production")' in text
    assert 'report["provider"]["vision_probe"] == "ok"' in text
    assert 'report["ocr"]["available"] is True' in text


def test_activation_keeps_an_explicit_approved_rollback_control() -> None:
    overlay = OVERLAY.read_text(encoding="utf-8")
    workflow = WORKFLOW.read_text(encoding="utf-8")

    assert "PRINTSENSE_PROD_PROVIDER" in overlay
    assert "PRINTSENSE_PROD_MODEL" in overlay
    assert "Rollback without code removal" in workflow


def test_no_secret_value_is_committed() -> None:
    combined = OVERLAY.read_text(encoding="utf-8") + WORKFLOW.read_text(encoding="utf-8")

    assert "sk-" not in combined
    assert "Bearer " not in combined
    assert "TOGETHERAI_API_KEY=" not in combined
