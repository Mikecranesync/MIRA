FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for weasyprint (libpango, libcairo, libgdk-pixbuf) and lxml (libxml2, libxslt)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libcairo2 \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    shared-mime-info \
    libxml2 \
    libxslt1.1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy pyproject.toml and install dependencies
COPY mira-seo/pyproject.toml .
RUN pip install --no-cache-dir -e .

# Copy source code
COPY mira-seo .

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:9100/health || exit 1

CMD ["uvicorn", "mira_seo.api.server:app", "--host", "0.0.0.0", "--port", "9100"]
