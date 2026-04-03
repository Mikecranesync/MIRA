FROM python:3.12.13-slim

WORKDIR /app

# System deps for pdfplumber (poppler) and chromadb (sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.7.12 /uv /usr/local/bin/uv

# Copy dependency files first (layer caching)
COPY pyproject.toml ./
RUN uv sync --frozen --no-dev 2>/dev/null || uv sync --no-dev

# Copy application code
COPY app.py config.py ./
COPY llm/ llm/
COPY rag/ rag/
COPY fsm/ fsm/

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
