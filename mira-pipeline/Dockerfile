FROM python:3.12.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY mira-pipeline/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy GSD engine shared code from mira-bots/ (build context is repo root)
COPY mira-bots/shared/ ./shared/
COPY mira-bots/prompts/ ./prompts/
# Copy all pipeline source modules (main + memory/feedback_sync/eval_api/qr_bridge/
# ignition_chat/ignition_audit + any future module). Per-file COPY caused two prod
# deploy failures when the Ignition cutover added modules the Dockerfile didn't list
# (ModuleNotFoundError: ignition_chat, then ignition_audit). Tests live in
# mira-pipeline/tests/ (a subdir, not matched by *.py), so this stays source-only.
COPY mira-pipeline/*.py .
COPY VERSION .

RUN addgroup --system --gid 1001 mira && \
    adduser --system --uid 1001 --ingroup mira mira

USER mira

ENV PYTHONUNBUFFERED=1
EXPOSE 9099

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=10s \
    CMD curl -f http://localhost:9099/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9099", "--log-level", "info"]
