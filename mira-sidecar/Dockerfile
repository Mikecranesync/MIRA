FROM python:3.12.13-slim

WORKDIR /app

# System deps for pdfplumber (poppler) and chromadb (sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.7.12 /uv /usr/local/bin/uv

# Copy dependency files first (layer caching)
COPY mira-sidecar/pyproject.toml mira-sidecar/uv.lock ./
RUN uv sync --frozen --no-dev

# Copy application code
COPY mira-sidecar/app.py mira-sidecar/config.py mira-sidecar/safety.py ./
COPY mira-sidecar/llm/ llm/
COPY mira-sidecar/rag/ rag/
COPY mira-sidecar/fsm/ fsm/
COPY mira-sidecar/routing/ routing/

# Copy mira-crawler chunker — rag/chunker.py delegates to this via sys.path
# Path must match: dirname(dirname(dirname(__file__))) + "mira-crawler"
# __file__ = /app/rag/chunker.py → resolves to /mira-crawler/ingest/chunker.py
COPY mira-crawler/ingest/__init__.py /mira-crawler/ingest/__init__.py
COPY mira-crawler/ingest/chunker.py /mira-crawler/ingest/chunker.py

# Runtime directories (mounted as volumes in production)
RUN mkdir -p /data/chroma /data/docs

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=15s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/status')"

ENV HOST=0.0.0.0
ENV PORT=5000
ENV CHROMA_PATH=/data/chroma
ENV DOCS_BASE_PATH=/data/docs

CMD ["uv", "run", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000"]
