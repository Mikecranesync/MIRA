FROM python:3.12.13-slim

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends tesseract-ocr && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY mira-bots/slack/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY mira-bots/shared/ ./shared/
# Ship the same isolated PrintSense print-vision framework as Telegram. It is
# inert unless PRINT_VISION_PROVIDER plus the active provider key are set; when
# unset, the engine falls back to the free OCR/cascade path.
COPY printsense/ ./printsense/
# The pure Materialized Evidence layer (contract/registry/recall resolver). The
# engine's production recall gate (shared/print_recall.py) imports it; without this
# COPY the import fails and recall silently disables (falls back to paying the model
# every print turn). Guarded by mira-bots/tests/test_docker_recall_packaging.py.
COPY materialized_evidence/ ./materialized_evidence/
# Provider registry + typed capability codes (ADR-0031 PR 2): the shared
# provider configuration the PR-3 Together interpreter and PR-4 readiness
# consume. Import-safe (env read at call time, network hard-gated); the
# approved-provider POLICY rides in config/providers/. Guarded by
# mira-bots/tests/test_docker_recall_packaging.py — dropping either COPY
# silently reverts provider hardening.
COPY factorylm_ai/ ./factorylm_ai/
COPY config/providers/ ./config/providers/
COPY mira-bots/prompts/ ./prompts/
COPY mira-bots/slack/bot.py mira-bots/slack/chat_adapter.py mira-bots/slack/pdf_handler.py mira-bots/slack/doctor.py ./
COPY VERSION .

ENV PYTHONUNBUFFERED=1
CMD ["python", "bot.py"]
