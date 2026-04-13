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
COPY mira-pipeline/main.py .
COPY mira-pipeline/memory.py .

ENV PYTHONUNBUFFERED=1
EXPOSE 9099

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=10s \
    CMD curl -f http://localhost:9099/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9099"]
