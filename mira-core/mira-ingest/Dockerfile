FROM python:3.12.13-slim

# Pull Debian security updates at build time (catches HIGH/CRITICAL CVEs
# with upstream fixes — e.g. openssl DoS CVE-2026-28390). Does not affect
# runtime behavior; kept in a single RUN layer to minimize image size.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py crawl_verifier.py route_fallback.py crawl_routes.yaml ./
COPY db/ db/

ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
